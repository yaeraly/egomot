import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AccountingSourceType,
  Currency,
  JournalStatus,
  LogisticsType,
  PayableStatus,
  Prisma,
  PurchaseReceiptStatus,
} from '@prisma/client';
import { publicDecimal } from '../common/decimal.util';
import { formatBusinessDate, parseBusinessDate } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  allocateByWeight,
  amountStr,
  calculatePurchase,
  dec,
  Decimal,
  logisticsAmountKgs,
  moneyStr,
  PurchaseValidationError,
  roundMoney,
  roundOriginalAmount,
  roundQty,
  roundWeight,
} from '../purchases/purchase-calc';
import { AccountingService, type AccountingClient } from './accounting.service';
import { PayableSyncService } from './payable-sync.service';
import { DEFAULT_PAYABLE_LIST_FILTER, filterPayables } from './payable-sync.logic';
import { ACCOUNT_CODE, type AccountCode } from './accounting-codes';
import {
  payableStatusFromAmounts,
  remainingPayableAmount,
} from './accounting-journal.logic';
import {
  MISSING_PRODUCT_WEIGHT_MESSAGE,
  PURCHASE_LOGISTICS_TYPES,
  buildLogisticsApPaymentLines,
  buildLogisticsCostLines,
  logisticsPaymentSourceType,
  logisticsRecognitionSourceType,
  payableAccountCodeForLogisticsType,
  resolveLogisticsSettlement,
  type LogisticsSettlementMode,
} from './logistics-cost.logic';
import {
  PayPurchaseLogisticsDto,
  UpsertPurchaseLogisticsDto,
} from '../purchases/dto/logistics.dto';

const LOGISTICS_AUDIT = {
  CREATED: 'LOGISTICS_COST_CREATED',
  EDITED: 'LOGISTICS_COST_EDITED',
  PAID: 'LOGISTICS_COST_PAID',
  PAYMENT_CANCELLED: 'LOGISTICS_COST_PAYMENT_CANCELLED',
  REVERSED: 'LOGISTICS_COST_REVERSED',
} as const;

@Injectable()
export class LogisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly payableSync: PayableSyncService,
  ) {}

  async create(userId: string, purchaseId: string, dto: UpsertPurchaseLogisticsDto) {
    return this.prisma.$transaction(async (tx) => {
      const purchase = await this.requirePurchase(tx, purchaseId);
      await this.assertPurchaseWeights(tx, purchaseId);
      const created = await this.persistAndPost(tx, {
        userId,
        purchase,
        dto,
        existing: null,
      });
      return this.serializeExpense(created);
    });
  }

  async update(
    userId: string,
    purchaseId: string,
    expenseId: string,
    dto: UpsertPurchaseLogisticsDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const purchase = await this.requirePurchase(tx, purchaseId);
      const existing = await this.requireExpense(tx, purchaseId, expenseId);
      await this.assertPurchaseWeights(tx, purchaseId);

      if (!existing.journalId) {
        const updated = await this.persistUnposted(tx, {
          userId,
          purchase,
          dto,
          existingId: existing.id,
        });
        await this.recalcPurchaseAllocations(tx, purchaseId);
        return this.serializeExpense(updated);
      }

      const previous = this.auditSnapshot(existing);
      await this.reversePostedExpense(tx, userId, existing);
      const created = await this.persistAndPost(tx, {
        userId,
        purchase,
        dto,
        existing: { id: existing.id },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: LOGISTICS_AUDIT.EDITED,
          entityType: 'PurchaseLogisticsExpense',
          entityId: created.id,
          oldValue: previous as Prisma.InputJsonValue,
          newValue: this.auditSnapshot(created) as Prisma.InputJsonValue,
        },
      });
      return this.serializeExpense(created);
    });
  }

  async payByExpenseId(userId: string, expenseId: string, dto: PayPurchaseLogisticsDto) {
    const expense = await this.prisma.purchaseLogisticsExpense.findUnique({
      where: { id: expenseId },
    });
    if (!expense) throw new NotFoundException('Расход логистики не найден');
    return this.pay(userId, expense.purchaseId, expenseId, dto);
  }

  async pay(userId: string, purchaseId: string, expenseId: string, dto: PayPurchaseLogisticsDto) {
    const amount = roundMoney(dto.amountKgs);
    if (!amount.gt(0)) {
      throw new BadRequestException('Сумма оплаты должна быть больше 0');
    }

    return this.prisma.$transaction(async (tx) => {
      const expense = await this.requireExpense(tx, purchaseId, expenseId);
      if (!expense.journalId) {
        throw new BadRequestException(
          'Сначала сохраните расход логистики, чтобы признать его в учёте',
        );
      }
      if (amount.gt(dec(expense.remainingAmountKgs))) {
        throw new BadRequestException('Сумма оплаты превышает остаток долга');
      }

      const account = await this.accounting.requireCompanyPaymentAccount(
        dto.paymentAccountId,
        tx,
      );
      const cashAccountCode = this.accounting.cashAccountCodeForCompanyAccount(account);
      const payableCode = payableAccountCodeForLogisticsType(expense.type);
      const paidAt = dto.paidAt
        ? parseBusinessDate(dto.paidAt, 'Дата оплаты')
        : new Date();
      const paymentId = randomUUID();
      const inventoryBefore = await this.inventoryBalance(tx);

      const journal = await this.accounting.postJournal(
        {
          sourceType: logisticsPaymentSourceType(expense.type) as AccountingSourceType,
          sourceId: paymentId,
          memo: dto.note?.trim() || `Logistics payment ${expense.type}`,
          lines: buildLogisticsApPaymentLines({
            amountKgs: amount,
            payableAccountCode: payableCode,
            cashAccountCode,
          }).map((row) =>
            row.accountCode === cashAccountCode
              ? { ...row, paymentAccountId: account.id }
              : row,
          ),
          createdByUserId: userId,
          postedAt: paidAt,
        },
        tx,
      );

      await tx.logisticsPayment.create({
        data: {
          id: paymentId,
          logisticsExpenseId: expense.id,
          amountKgs: moneyStr(amount),
          paidAt,
          paymentAccountId: account.id,
          journalId: journal.id,
          createdByUserId: userId,
          note: dto.note?.trim() || null,
          isRecognition: false,
        },
      });

      const newPaid = roundMoney(dec(expense.paidAmountKgs).plus(amount));
      const remaining = remainingPayableAmount(expense.amountKgs, newPaid);
      const status = payableStatusFromAmounts(expense.amountKgs, newPaid) as PayableStatus;

      await tx.purchaseLogisticsExpense.update({
        where: { id: expense.id },
        data: {
          paidAmountKgs: moneyStr(newPaid),
          remainingAmountKgs: moneyStr(remaining),
          status,
          paymentAccountId: account.id,
          paidAt,
        },
      });

      if (expense.cargoPayableId) {
        await this.syncCargoPayable(tx, expense.cargoPayableId, expense.amountKgs, newPaid);
      }
      if (expense.transportPayableId) {
        await this.syncTransportPayable(
          tx,
          expense.transportPayableId,
          expense.amountKgs,
          newPaid,
        );
      }

      await this.accounting.syncPurchaseSettlement(tx, purchaseId);
      const inventoryAfter = await this.inventoryBalance(tx);
      if (!roundMoney(inventoryBefore).eq(roundMoney(inventoryAfter))) {
        throw new BadRequestException('Оплата долга не должна менять себестоимость запасов');
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: LOGISTICS_AUDIT.PAID,
          entityType: 'PurchaseLogisticsExpense',
          entityId: expense.id,
          oldValue: {
            paidAmountKgs: publicDecimal(expense.paidAmountKgs),
            remainingAmountKgs: publicDecimal(expense.remainingAmountKgs),
            status: expense.status,
          },
          newValue: {
            paidAmountKgs: moneyStr(newPaid),
            remainingAmountKgs: moneyStr(remaining),
            status,
            paymentDate: formatBusinessDate(paidAt),
            paymentAccountId: account.id,
            amountKgs: moneyStr(amount),
            originalAmount: publicDecimal(expense.amount),
            currency: expense.currency,
            exchangeRate: expense.exchangeRate ? publicDecimal(expense.exchangeRate) : null,
          },
        },
      });

      const updated = await this.requireExpense(tx, purchaseId, expense.id);
      return this.serializeExpense(updated);
    });
  }

  async cancelPayment(userId: string, purchaseId: string, paymentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.logisticsPayment.findUnique({
        where: { id: paymentId },
        include: { journal: true, logisticsExpense: true },
      });
      if (!payment || payment.logisticsExpense.purchaseId !== purchaseId) {
        throw new NotFoundException('Оплата логистики не найдена');
      }
      if (payment.isRecognition) {
        throw new BadRequestException(
          'Нельзя отменить оплату, входящую в проводку признания. Измените расход через сторно.',
        );
      }
      if (payment.journal.status === JournalStatus.VOIDED) {
        throw new BadRequestException('Оплата уже сторнирована');
      }

      await this.accounting.voidAndReverse(payment.journalId, userId, tx);
      const expense = payment.logisticsExpense;
      const newPaid = remainingPayableAmount(expense.paidAmountKgs, payment.amountKgs);
      const remaining = remainingPayableAmount(expense.amountKgs, newPaid);
      const status = payableStatusFromAmounts(expense.amountKgs, newPaid) as PayableStatus;

      await tx.purchaseLogisticsExpense.update({
        where: { id: expense.id },
        data: {
          paidAmountKgs: moneyStr(newPaid),
          remainingAmountKgs: moneyStr(remaining),
          status,
        },
      });
      if (expense.cargoPayableId) {
        await this.syncCargoPayable(tx, expense.cargoPayableId, expense.amountKgs, newPaid);
      }
      if (expense.transportPayableId) {
        await this.syncTransportPayable(tx, expense.transportPayableId, expense.amountKgs, newPaid);
      }
      await this.accounting.syncPurchaseSettlement(tx, purchaseId);
      await tx.auditLog.create({
        data: {
          userId,
          action: LOGISTICS_AUDIT.PAYMENT_CANCELLED,
          entityType: 'LogisticsPayment',
          entityId: payment.id,
          oldValue: {
            amountKgs: publicDecimal(payment.amountKgs),
            paidAt: payment.paidAt.toISOString(),
            paymentAccountId: payment.paymentAccountId,
          },
          newValue: { reversed: true, remainingAmountKgs: moneyStr(remaining), status },
        },
      });
      return this.serializeExpense(await this.requireExpense(tx, purchaseId, expense.id));
    });
  }

  async autoPostUnposted(tx: AccountingClient, userId: string, purchaseId: string) {
    const purchase = await this.requirePurchase(tx, purchaseId);
    const unposted = await tx.purchaseLogisticsExpense.findMany({
      where: { purchaseId, journalId: null },
      orderBy: { createdAt: 'asc' },
    });
    for (const row of unposted) {
      if (!roundMoney(row.amountKgs).gt(0)) continue;
      await this.persistAndPost(tx, {
        userId,
        purchase,
        dto: {
          type: row.type,
          expenseDate: formatBusinessDate(row.expenseDate) ?? new Date().toISOString().slice(0, 10),
          payeeName: row.payeeName,
          amount: String(row.amount),
          currency: row.currency,
          exchangeRate: row.exchangeRate ? String(row.exchangeRate) : null,
          comment: row.comment,
          settlement: 'UNPAID' as const,
          paidAmountKgs: '0',
          paymentAccountId: null,
          paidAt: null,
        },
        existing: { id: row.id },
        skipInventoryIncrement: true,
      });
    }
  }

  async listDebts(filter = DEFAULT_PAYABLE_LIST_FILTER) {
    await this.payableSync.syncFromLedger();
    const gl = await this.payableSync.glBalances();
    const [cargo, transport] = await Promise.all([
      this.prisma.cargoPayable.findMany({
        include: {
          cargoVendor: true,
          purchase: { select: { id: true, number: true, purchaseDate: true } },
          logisticsExpense: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.transportPayable.findMany({
        include: {
          purchase: { select: { id: true, number: true, purchaseDate: true } },
          logisticsExpense: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const cargoRows = cargo.map((row) => ({
      id: row.logisticsExpense?.id ?? row.id,
      payableId: row.id,
      kind: 'CARGO' as const,
      type: 'CARGO',
      payeeName: row.cargoVendor?.name ?? row.logisticsExpense?.payeeName ?? null,
      purchaseId: row.purchaseId,
      purchaseNumber: row.purchase.number,
      purchaseDate: row.purchase.purchaseDate
        ? formatBusinessDate(row.purchase.purchaseDate)
        : null,
      expenseDate: row.logisticsExpense
        ? formatBusinessDate(row.logisticsExpense.expenseDate)
        : row.purchase.purchaseDate
          ? formatBusinessDate(row.purchase.purchaseDate)
          : null,
      currency: row.logisticsExpense?.currency ?? row.currency,
      originalAmount: row.logisticsExpense
        ? publicDecimal(row.logisticsExpense.amount)
        : publicDecimal(row.amountKgs),
      amountKgs: publicDecimal(row.amountKgs),
      paidAmountKgs: publicDecimal(row.paidAmountKgs),
      remainingAmountKgs: publicDecimal(row.remainingAmountKgs),
      status: row.status,
      canPay: roundMoney(row.remainingAmountKgs).gt(0),
      payPath: row.logisticsExpense?.id ? ('LOGISTICS' as const) : ('CARGO_PAYABLE' as const),
    }));

    const transportRows = transport.map((row) => ({
      id: row.logisticsExpense?.id ?? row.id,
      payableId: row.id,
      kind: 'TRANSPORT' as const,
      type: row.type,
      payeeName: row.payeeName ?? row.logisticsExpense?.payeeName ?? null,
      purchaseId: row.purchaseId,
      purchaseNumber: row.purchase.number,
      purchaseDate: row.purchase.purchaseDate
        ? formatBusinessDate(row.purchase.purchaseDate)
        : null,
      expenseDate: row.logisticsExpense
        ? formatBusinessDate(row.logisticsExpense.expenseDate)
        : row.purchase.purchaseDate
          ? formatBusinessDate(row.purchase.purchaseDate)
          : null,
      currency: row.logisticsExpense?.currency ?? row.currency,
      originalAmount: row.logisticsExpense
        ? publicDecimal(row.logisticsExpense.amount)
        : publicDecimal(row.originalAmount),
      amountKgs: publicDecimal(row.amountKgs),
      paidAmountKgs: publicDecimal(row.paidAmountKgs),
      remainingAmountKgs: publicDecimal(row.remainingAmountKgs),
      status: row.status,
      canPay: roundMoney(row.remainingAmountKgs).gt(0),
      payPath: row.logisticsExpense?.id
        ? ('LOGISTICS' as const)
        : ('TRANSPORT_PAYABLE' as const),
    }));

    const all = [...cargoRows, ...transportRows];
    const visible = filterPayables(all, filter);
    const cargoRemainingKgs = moneyStr(
      cargoRows.reduce(
        (sum, row) =>
          roundMoney(row.remainingAmountKgs).gt(0)
            ? sum.plus(dec(row.remainingAmountKgs))
            : sum,
        dec(0),
      ),
    );
    const transportRemainingKgs = moneyStr(
      transportRows.reduce(
        (sum, row) =>
          roundMoney(row.remainingAmountKgs).gt(0)
            ? sum.plus(dec(row.remainingAmountKgs))
            : sum,
        dec(0),
      ),
    );
    return {
      cargoRemainingKgs,
      transportRemainingKgs,
      remainingKgs: moneyStr(dec(cargoRemainingKgs).plus(dec(transportRemainingKgs))),
      glCargoRemainingKgs: gl.cargoApKgs,
      glTransportRemainingKgs: gl.transportApKgs,
      cargoDifferenceKgs: moneyStr(dec(cargoRemainingKgs).minus(dec(gl.cargoApKgs))),
      transportDifferenceKgs: moneyStr(dec(transportRemainingKgs).minus(dec(gl.transportApKgs))),
      filter,
      rows: visible,
    };
  }

  private async persistAndPost(
    tx: AccountingClient,
    params: {
      userId: string;
      purchase: { id: string; number: string };
      dto: UpsertPurchaseLogisticsDto;
      existing: { id: string } | null;
      skipInventoryIncrement?: boolean;
    },
  ) {
    this.assertLogisticsType(params.dto.type);
    const computed = this.computeAmounts(params.dto);
    if (computed.paidAmountKgs.gt(0) && !params.dto.paymentAccountId) {
      throw new BadRequestException('Укажите счёт оплаты: Наличные или Банк');
    }

    let cashAccountCode: AccountCode = ACCOUNT_CODE.CASH;
    let paymentAccountId: string | null = null;
    if (computed.paidAmountKgs.gt(0) && params.dto.paymentAccountId) {
      const account = await this.accounting.requireCompanyPaymentAccount(
        params.dto.paymentAccountId,
        tx,
      );
      cashAccountCode = this.accounting.cashAccountCodeForCompanyAccount(account);
      paymentAccountId = account.id;
    }

    const expenseDate = parseBusinessDate(params.dto.expenseDate, 'Дата расхода');
    const paidAt = computed.paidAmountKgs.gt(0)
      ? params.dto.paidAt
        ? parseBusinessDate(params.dto.paidAt, 'Дата оплаты')
        : expenseDate
      : null;
    const payableCode = payableAccountCodeForLogisticsType(params.dto.type);
    const sourceType = logisticsRecognitionSourceType(
      params.dto.type,
    ) as AccountingSourceType;
    const expenseId = params.existing?.id ?? randomUUID();

    const journal = await this.accounting.postJournal(
      {
        sourceType,
        sourceId: expenseId,
        memo: `${params.dto.type} ${params.purchase.number}`,
        lines: buildLogisticsCostLines({
          amountKgs: computed.amountKgs,
          paidKgs: computed.paidAmountKgs,
          payableAccountCode: payableCode,
          cashAccountCode,
        }).map((row) =>
          row.accountCode === cashAccountCode && paymentAccountId
            ? { ...row, paymentAccountId }
            : row,
        ),
        createdByUserId: params.userId,
        postedAt: expenseDate,
      },
      tx,
    );

    const data = {
      purchaseId: params.purchase.id,
      type: params.dto.type,
      expenseDate,
      payeeName: params.dto.payeeName?.trim() || null,
      amount: amountStr(computed.originalAmount),
      currency: params.dto.currency,
      exchangeRate: computed.exchangeRate,
      amountKgs: moneyStr(computed.amountKgs),
      paidAmountKgs: moneyStr(computed.paidAmountKgs),
      remainingAmountKgs: moneyStr(computed.remainingAmountKgs),
      status: computed.status as PayableStatus,
      paymentAccountId,
      paidAt,
      comment: params.dto.comment?.trim() || null,
      journalId: journal.id,
      createdByUserId: params.userId,
    };

    const expense = params.existing
      ? await tx.purchaseLogisticsExpense.update({
          where: { id: expenseId },
          data,
        })
      : await tx.purchaseLogisticsExpense.create({
          data: { id: expenseId, ...data },
        });

    if (computed.paidAmountKgs.gt(0) && paymentAccountId && paidAt) {
      await tx.logisticsPayment.create({
        data: {
          logisticsExpenseId: expense.id,
          amountKgs: moneyStr(computed.paidAmountKgs),
          paidAt,
          paymentAccountId,
          journalId: journal.id,
          createdByUserId: params.userId,
          isRecognition: true,
        },
      });
    }

    if (computed.remainingAmountKgs.gt(0)) {
      await this.ensurePayable(tx, expense, computed, journal.id);
    } else {
      await tx.purchaseLogisticsExpense.update({
        where: { id: expense.id },
        data: { cargoPayableId: null, transportPayableId: null },
      });
    }

    await this.recalcPurchaseAllocations(tx, params.purchase.id);
    if (!params.skipInventoryIncrement) {
      await this.applyLogisticsToReceivedInventory(
        tx,
        params.purchase.id,
        expense.id,
        computed.amountKgs,
        1,
      );
    }
    await this.accounting.syncPurchaseSettlement(tx, params.purchase.id);

    if (!params.existing) {
      await tx.auditLog.create({
        data: {
          userId: params.userId,
          action: LOGISTICS_AUDIT.CREATED,
          entityType: 'PurchaseLogisticsExpense',
          entityId: expense.id,
          oldValue: Prisma.JsonNull,
          newValue: this.auditSnapshot(await this.requireExpense(tx, params.purchase.id, expense.id)) as Prisma.InputJsonValue,
        },
      });
    }

    return this.requireExpense(tx, params.purchase.id, expense.id);
  }

  private async persistUnposted(
    tx: AccountingClient,
    params: {
      userId: string;
      purchase: { id: string };
      dto: UpsertPurchaseLogisticsDto;
      existingId: string;
    },
  ) {
    this.assertLogisticsType(params.dto.type);
    const computed = this.computeAmounts(params.dto);
    const expenseDate = parseBusinessDate(params.dto.expenseDate, 'Дата расхода');
    return tx.purchaseLogisticsExpense.update({
      where: { id: params.existingId },
      data: {
        type: params.dto.type,
        expenseDate,
        payeeName: params.dto.payeeName?.trim() || null,
        amount: amountStr(computed.originalAmount),
        currency: params.dto.currency,
        exchangeRate: computed.exchangeRate,
        amountKgs: moneyStr(computed.amountKgs),
        paidAmountKgs: moneyStr(computed.paidAmountKgs),
        remainingAmountKgs: moneyStr(computed.remainingAmountKgs),
        status: computed.status as PayableStatus,
        comment: params.dto.comment?.trim() || null,
      },
      include: this.expenseInclude(),
    });
  }

  private async reversePostedExpense(
    tx: AccountingClient,
    userId: string,
    existing: {
      id: string;
      purchaseId: string;
      amountKgs: Prisma.Decimal;
      journalId: string | null;
      cargoPayableId: string | null;
      transportPayableId: string | null;
      payments: Array<{ id: string; journalId: string; isRecognition: boolean; journal: { status: JournalStatus } }>;
    },
  ) {
    for (const payment of existing.payments) {
      if (payment.isRecognition) continue;
      if (payment.journal.status === JournalStatus.POSTED) {
        await this.accounting.voidAndReverse(payment.journalId, userId, tx);
      }
    }
    if (existing.journalId) {
      const journal = await tx.journal.findUnique({ where: { id: existing.journalId } });
      if (journal && journal.status === JournalStatus.POSTED) {
        await this.accounting.voidAndReverse(existing.journalId, userId, tx);
      }
    }
    await this.applyLogisticsToReceivedInventory(
      tx,
      existing.purchaseId,
      existing.id,
      existing.amountKgs,
      -1,
    );
    await tx.purchaseLogisticsExpense.update({
      where: { id: existing.id },
      data: {
        journalId: null,
        cargoPayableId: null,
        transportPayableId: null,
        paymentAccountId: null,
        paidAt: null,
        paidAmountKgs: '0.00',
        remainingAmountKgs: moneyStr(existing.amountKgs),
        status: PayableStatus.UNPAID,
      },
    });
    await tx.logisticsPayment.deleteMany({ where: { logisticsExpenseId: existing.id } });
    if (existing.cargoPayableId) {
      await tx.cargoPayable.delete({ where: { id: existing.cargoPayableId } }).catch(() => undefined);
    }
    if (existing.transportPayableId) {
      await tx.transportPayable.delete({ where: { id: existing.transportPayableId } }).catch(() => undefined);
    }
    await tx.auditLog.create({
      data: {
        userId,
        action: LOGISTICS_AUDIT.REVERSED,
        entityType: 'PurchaseLogisticsExpense',
        entityId: existing.id,
        oldValue: { journalId: existing.journalId },
        newValue: { reversed: true },
      },
    });
  }

  private async ensurePayable(
    tx: AccountingClient,
    expense: { id: string; purchaseId: string; type: LogisticsType; payeeName: string | null; currency: Currency; amount: Prisma.Decimal },
    computed: { amountKgs: ReturnType<typeof roundMoney>; remainingAmountKgs: ReturnType<typeof roundMoney>; paidAmountKgs: ReturnType<typeof roundMoney>; originalAmount: ReturnType<typeof roundOriginalAmount> },
    journalId: string,
  ) {
    if (isCargo(expense.type)) {
      const payable = await tx.cargoPayable.create({
        data: {
          purchaseId: expense.purchaseId,
          billRef: expense.payeeName,
          amountKgs: moneyStr(computed.amountKgs),
          currency: expense.currency,
          paidAmountKgs: moneyStr(computed.paidAmountKgs),
          remainingAmountKgs: moneyStr(computed.remainingAmountKgs),
          status: payableStatusFromAmounts(computed.amountKgs, computed.paidAmountKgs) as PayableStatus,
          journalId,
        },
      });
      await tx.purchaseLogisticsExpense.update({
        where: { id: expense.id },
        data: { cargoPayableId: payable.id, transportPayableId: null },
      });
      return;
    }

    const payable = await tx.transportPayable.create({
      data: {
        purchaseId: expense.purchaseId,
        type: expense.type,
        payeeName: expense.payeeName,
        amountKgs: moneyStr(computed.amountKgs),
        currency: expense.currency,
        originalAmount: amountStr(computed.originalAmount),
        paidAmountKgs: moneyStr(computed.paidAmountKgs),
        remainingAmountKgs: moneyStr(computed.remainingAmountKgs),
        status: payableStatusFromAmounts(computed.amountKgs, computed.paidAmountKgs) as PayableStatus,
        journalId,
      },
    });
    await tx.purchaseLogisticsExpense.update({
      where: { id: expense.id },
      data: { transportPayableId: payable.id, cargoPayableId: null },
    });
  }

  private async syncCargoPayable(
    tx: AccountingClient,
    payableId: string,
    amountKgs: Prisma.Decimal | string,
    paid: ReturnType<typeof roundMoney>,
  ) {
    await tx.cargoPayable.update({
      where: { id: payableId },
      data: {
        paidAmountKgs: moneyStr(paid),
        remainingAmountKgs: moneyStr(remainingPayableAmount(amountKgs, paid)),
        status: payableStatusFromAmounts(amountKgs, paid) as PayableStatus,
      },
    });
  }

  private async syncTransportPayable(
    tx: AccountingClient,
    payableId: string,
    amountKgs: Prisma.Decimal | string,
    paid: ReturnType<typeof roundMoney>,
  ) {
    await tx.transportPayable.update({
      where: { id: payableId },
      data: {
        paidAmountKgs: moneyStr(paid),
        remainingAmountKgs: moneyStr(remainingPayableAmount(amountKgs, paid)),
        status: payableStatusFromAmounts(amountKgs, paid) as PayableStatus,
      },
    });
  }

  async recalcPurchaseAllocations(tx: AccountingClient, purchaseId: string) {
    const purchase = await tx.purchase.findUnique({
      where: { id: purchaseId },
      include: { items: true, logistics: true },
    });
    if (!purchase) return;
    try {
      const calc = calculatePurchase({
        exchangeRateCnyToKgs: purchase.exchangeRateCnyToKgs,
        items: purchase.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPriceCny: item.unitPriceCny,
          unitWeightKg: item.unitWeightKg,
        })),
        logistics: purchase.logistics.map((row) => ({
          type: row.type,
          amount: row.amount,
          currency: row.currency,
          exchangeRate: row.exchangeRate,
          comment: row.comment,
        })),
      });
      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          totalChinaTransportKgs: calc.totals.totalChinaTransportKgs.toFixed(2),
          totalCargoKgs: calc.totals.totalCargoKgs.toFixed(2),
          totalKgInternalTransportKgs: calc.totals.totalKgInternalTransportKgs.toFixed(2),
          totalOtherLogisticsKgs: calc.totals.totalOtherLogisticsKgs.toFixed(2),
          totalLogisticsKgs: calc.totals.totalLogisticsKgs.toFixed(2),
          estimatedTotalLandedCostKgs: calc.totals.estimatedTotalLandedCostKgs.toFixed(2),
          averageLogisticsCostPerKg: calc.totals.averageLogisticsCostPerKg.toFixed(4),
        },
      });
      for (const item of calc.items) {
        await tx.purchaseItem.updateMany({
          where: { purchaseId, productId: item.productId },
          data: {
            allocatedChinaTransportKgs: item.allocatedChinaTransportKgs.toFixed(2),
            allocatedCargoKgs: item.allocatedCargoKgs.toFixed(2),
            allocatedKgInternalTransportKgs: item.allocatedKgInternalTransportKgs.toFixed(2),
            allocatedOtherLogisticsKgs: item.allocatedOtherLogisticsKgs.toFixed(2),
            totalAllocatedLogisticsKgs: item.totalAllocatedLogisticsKgs.toFixed(2),
            estimatedLandedCostKgs: item.estimatedLandedCostKgs.toFixed(2),
            estimatedUnitLandedCostKgs: item.estimatedUnitLandedCostKgs.toFixed(4),
          },
        });
      }
    } catch (error) {
      if (error instanceof PurchaseValidationError) {
        throw new BadRequestException({ message: error.messages, errors: error.messages });
      }
      throw error;
    }
  }

  private async applyLogisticsToReceivedInventory(
    tx: AccountingClient,
    purchaseId: string,
    _expenseId: string,
    amountKgs: Prisma.Decimal | string,
    sign: 1 | -1,
  ) {
    const amount = roundMoney(amountKgs);
    if (!amount.gt(0)) return;
    const receipts = await tx.purchaseReceipt.findMany({
      where: { purchaseId, status: PurchaseReceiptStatus.COMPLETED },
      include: { items: true },
    });
    if (receipts.length === 0) return;

    const items = await tx.purchaseItem.findMany({ where: { purchaseId } });
    const weights = items.map((item) => roundWeight(item.totalWeightKg));
    const allocated = allocateByWeight(weights, amount);
    const receivedByProduct = new Map<string, ReturnType<typeof roundQty>>();
    for (const receipt of receipts) {
      for (const row of receipt.items) {
        const current = receivedByProduct.get(row.productId) ?? roundQty(0);
        receivedByProduct.set(row.productId, roundQty(current.plus(row.receivedQuantity)));
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const received = receivedByProduct.get(item.productId) ?? roundQty(0);
      if (!received.gt(0) || !item.quantity || !dec(item.quantity).gt(0)) continue;
      const ratio = Decimal.min(1, received.div(dec(item.quantity)));
      const addValue = roundMoney(allocated[i].times(ratio).times(sign));
      if (addValue.eq(0)) continue;
      const inventory = await tx.inventory.findUnique({ where: { productId: item.productId } });
      if (!inventory) continue;
      const newValue = roundMoney(dec(inventory.totalValueKgs).plus(addValue));
      const qty = roundQty(inventory.quantity);
      const avg = qty.gt(0) ? newValue.div(qty) : dec(0);
      await tx.inventory.update({
        where: { productId: item.productId },
        data: {
          totalValueKgs: moneyStr(newValue),
          averageUnitCostKgs: avg.toFixed(4),
        },
      });
    }
  }

  async assertPurchaseWeights(tx: AccountingClient, purchaseId: string) {
    const items = await tx.purchaseItem.findMany({
      where: { purchaseId },
      include: { product: true },
    });
    for (const item of items) {
      if (
        roundWeight(item.unitWeightKg).lte(0) ||
        roundWeight(item.product.unitWeightKg).lte(0) ||
        roundWeight(item.totalWeightKg).lte(0)
      ) {
        throw new BadRequestException(MISSING_PRODUCT_WEIGHT_MESSAGE);
      }
    }
  }

  private computeAmounts(dto: UpsertPurchaseLogisticsDto) {
    const originalAmount = roundOriginalAmount(dto.amount);
    const exchangeRate =
      dto.currency === Currency.KGS
        ? dto.exchangeRate
          ? dto.exchangeRate
          : null
        : dto.exchangeRate ?? null;
    const amountKgs = logisticsAmountKgs(originalAmount, dto.currency, exchangeRate);
    const settlement = resolveLogisticsSettlement({
      amountKgs,
      settlement: dto.settlement as LogisticsSettlementMode,
      paidAmountKgs: dto.paidAmountKgs,
    });
    return {
      originalAmount,
      exchangeRate,
      ...settlement,
    };
  }

  private assertLogisticsType(type: LogisticsType) {
    if (
      type !== LogisticsType.OTHER &&
      !PURCHASE_LOGISTICS_TYPES.includes(type as (typeof PURCHASE_LOGISTICS_TYPES)[number])
    ) {
      throw new BadRequestException('Неизвестный тип расхода логистики');
    }
  }

  private async requirePurchase(tx: AccountingClient, purchaseId: string) {
    const purchase = await tx.purchase.findUnique({ where: { id: purchaseId } });
    if (!purchase) throw new NotFoundException('Закупка не найдена');
    return purchase;
  }

  private expenseInclude() {
    return {
      paymentAccount: { include: { paymentMethod: true } },
      payments: {
        include: {
          paymentAccount: { include: { paymentMethod: true } },
          createdBy: { select: { id: true, name: true } },
          journal: true,
        },
        orderBy: { paidAt: 'asc' as const },
      },
      createdBy: { select: { id: true, name: true } },
    };
  }

  private async requireExpense(tx: AccountingClient, purchaseId: string, expenseId: string) {
    const expense = await tx.purchaseLogisticsExpense.findFirst({
      where: { id: expenseId, purchaseId },
      include: this.expenseInclude(),
    });
    if (!expense) throw new NotFoundException('Расход логистики не найден');
    return expense;
  }

  private async inventoryBalance(tx: AccountingClient) {
    const lines = await tx.journalLine.findMany({
      where: {
        journal: { status: JournalStatus.POSTED },
        account: { code: ACCOUNT_CODE.INVENTORY },
      },
    });
    return lines.reduce(
      (sum, row) => sum.plus(dec(row.debitKgs)).minus(dec(row.creditKgs)),
      dec(0),
    );
  }

  serializeExpense(row: Record<string, unknown>) {
    const paymentAccount = row.paymentAccount as
      | { id: string; name: string; paymentMethod?: { code: string } }
      | null
      | undefined;
    return {
      ...row,
      expenseDate: formatBusinessDate(row.expenseDate as Date),
      paidAt: row.paidAt ? (row.paidAt as Date).toISOString() : null,
      amount: publicDecimal(row.amount as Prisma.Decimal),
      exchangeRate: row.exchangeRate
        ? publicDecimal(row.exchangeRate as Prisma.Decimal)
        : null,
      amountKgs: publicDecimal(row.amountKgs as Prisma.Decimal),
      paidAmountKgs: publicDecimal(row.paidAmountKgs as Prisma.Decimal),
      remainingAmountKgs: publicDecimal(row.remainingAmountKgs as Prisma.Decimal),
      paymentAccount: paymentAccount
        ? {
            id: paymentAccount.id,
            name: paymentAccount.name,
            paymentMethodCode: paymentAccount.paymentMethod?.code ?? null,
          }
        : null,
    };
  }

  private auditSnapshot(row: {
    type: string;
    expenseDate: Date;
    payeeName: string | null;
    amount: Prisma.Decimal;
    currency: string;
    exchangeRate: Prisma.Decimal | null;
    amountKgs: Prisma.Decimal;
    paidAmountKgs: Prisma.Decimal;
    remainingAmountKgs: Prisma.Decimal;
    status: string;
    paymentAccountId: string | null;
    comment: string | null;
  }) {
    return {
      type: row.type,
      expenseDate: formatBusinessDate(row.expenseDate),
      payeeName: row.payeeName,
      originalAmount: publicDecimal(row.amount),
      currency: row.currency,
      exchangeRate: row.exchangeRate ? publicDecimal(row.exchangeRate) : null,
      amountKgs: publicDecimal(row.amountKgs),
      paidAmountKgs: publicDecimal(row.paidAmountKgs),
      remainingAmountKgs: publicDecimal(row.remainingAmountKgs),
      status: row.status,
      paymentAccountId: row.paymentAccountId,
      comment: row.comment,
    };
  }
}

function isCargo(type: LogisticsType) {
  return type === LogisticsType.CARGO;
}
