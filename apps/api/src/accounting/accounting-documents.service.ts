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
  PayableStatus,
  SaleStatus,
} from '@prisma/client';
import { publicDecimal } from '../common/decimal.util';
import { parseBusinessDate } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { dec, moneyStr, roundMoney } from '../purchases/purchase-calc';
import { EXPENSE_CATEGORY_ACCOUNT_CODE } from './accounting-codes';
import {
  buildCargoPaymentLines,
  buildOperatingExpenseLines,
  buildOwnerWithdrawalLines,
  buildSupplierApPaymentLines,
  buildTransportPaymentLines,
  payableStatusFromAmounts,
  remainingPayableAmount,
} from './accounting-journal.logic';
import { AccountingService } from './accounting.service';
import { PayableSyncService } from './payable-sync.service';
import { DEFAULT_PAYABLE_LIST_FILTER, filterPayables } from './payable-sync.logic';
import {
  CreateCargoPaymentDto,
  CreateCargoVendorDto,
  CreateOperatingExpenseDto,
  CreateOwnerWithdrawalDto,
  CreatePurchasePaymentDto,
} from './dto/accounting.dto';

@Injectable()
export class AccountingDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly payableSync: PayableSyncService,
  ) {}

  async listSupplierPayables(filter = DEFAULT_PAYABLE_LIST_FILTER) {
    await this.payableSync.syncFromLedger();
    const gl = await this.payableSync.glBalances();
    const rows = await this.prisma.supplierPayable.findMany({
      include: {
        supplier: true,
        purchase: { select: { id: true, number: true, purchaseDate: true, payableStatus: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const mapped = rows.map((row) => ({
      id: row.id,
      supplierId: row.supplierId,
      supplierName: row.supplier.name,
      purchaseId: row.purchaseId,
      purchaseNumber: row.purchase.number,
      purchaseDate: row.purchase.purchaseDate,
      invoiceRef: row.invoiceRef,
      amountKgs: publicDecimal(row.amountKgs),
      paidAmountKgs: publicDecimal(row.paidAmountKgs),
      remainingAmountKgs: publicDecimal(row.remainingAmountKgs),
      dueDate: row.dueDate,
      status: row.status,
    }));
    const visible = filterPayables(mapped, filter);
    const remainingKgs = moneyStr(
      mapped.reduce(
        (sum, row) =>
          Number(row.remainingAmountKgs) > 0 ? sum.plus(dec(row.remainingAmountKgs)) : sum,
        dec(0),
      ),
    );
    return {
      glRemainingKgs: gl.supplierApKgs,
      remainingKgs,
      differenceKgs: moneyStr(dec(remainingKgs).minus(dec(gl.supplierApKgs))),
      filter,
      rows: visible,
    };
  }

  async listCargoPayables() {
    await this.payableSync.syncFromLedger();
    const rows = await this.prisma.cargoPayable.findMany({
      include: {
        cargoVendor: true,
        purchase: { select: { id: true, number: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      cargoVendorId: row.cargoVendorId,
      cargoVendorName: row.cargoVendor?.name ?? null,
      purchaseId: row.purchaseId,
      purchaseNumber: row.purchase.number,
      billRef: row.billRef,
      amountKgs: publicDecimal(row.amountKgs),
      currency: row.currency,
      paidAmountKgs: publicDecimal(row.paidAmountKgs),
      remainingAmountKgs: publicDecimal(row.remainingAmountKgs),
      dueDate: row.dueDate,
      status: row.status,
    }));
  }

  async listCargoVendors() {
    return this.prisma.cargoVendor.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createCargoVendor(dto: CreateCargoVendorDto) {
    return this.prisma.cargoVendor.create({
      data: {
        name: dto.name.trim(),
        phone: dto.phone?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
    });
  }

  async recordPurchasePayment(userId: string, purchaseId: string, dto: CreatePurchasePaymentDto) {
    await this.payableSync.syncFromLedger();
    const amount = roundMoney(dto.amountKgs);
    if (!amount.gt(0)) {
      throw new BadRequestException('Сумма оплаты должна быть больше 0');
    }

    return this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({
        where: { id: purchaseId },
        include: { supplierPayables: true },
      });
      if (!purchase) throw new NotFoundException('Purchase not found');

      const payable = purchase.supplierPayables[0];
      if (!payable) {
        throw new BadRequestException(
          'Нет долга поставщику по этой закупке. Обновите страницу «Долги».',
        );
      }
      if (amount.gt(dec(payable.remainingAmountKgs))) {
        throw new BadRequestException('Сумма оплаты не может превышать остаток долга');
      }

      const account = await this.accounting.requireCompanyPaymentAccount(
        dto.paymentAccountId,
        tx,
      );
      const cashAccountCode = this.accounting.cashAccountCodeForCompanyAccount(account);
      const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

      const paymentId = randomUUID();
      const journal = await this.accounting.postJournal(
        {
          sourceType: AccountingSourceType.PURCHASE_PAYMENT,
          sourceId: paymentId,
          memo: dto.note?.trim() || `Supplier payment ${purchase.number}`,
          lines: buildSupplierApPaymentLines({ amountKgs: amount, cashAccountCode }).map(
            (line) =>
              line.accountCode === cashAccountCode
                ? { ...line, paymentAccountId: account.id }
                : line,
          ),
          createdByUserId: userId,
          postedAt: paidAt,
        },
        tx,
      );

      const payment = await tx.purchasePayment.create({
        data: {
          id: paymentId,
          purchaseId,
          amountKgs: moneyStr(amount),
          paidAt,
          paymentAccountId: account.id,
          journalId: journal.id,
          createdByUserId: userId,
          note: dto.note?.trim() || null,
        },
      });

      const newPaid = roundMoney(dec(payable.paidAmountKgs).plus(amount));
      const remaining = remainingPayableAmount(payable.amountKgs, newPaid);
      await tx.supplierPayable.update({
        where: { id: payable.id },
        data: {
          paidAmountKgs: moneyStr(newPaid),
          remainingAmountKgs: moneyStr(remaining),
          status: payableStatusFromAmounts(payable.amountKgs, newPaid) as PayableStatus,
        },
      });

      await this.accounting.syncPurchaseSettlement(tx, purchaseId);
      return tx.purchasePayment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { journal: { include: { lines: { include: { account: true } } } } },
      });
    });
  }

  async cancelPurchasePayment(userId: string, paymentId: string) {
    const payment = await this.prisma.purchasePayment.findUnique({
      where: { id: paymentId },
      include: { journal: true, purchase: { include: { supplierPayables: true } } },
    });
    if (!payment) throw new NotFoundException('Purchase payment not found');
    if (payment.journal.status === JournalStatus.VOIDED) {
      throw new BadRequestException('Purchase payment is already reversed');
    }

    return this.prisma.$transaction(async (tx) => {
      const reversal = await this.accounting.voidAndReverse(payment.journalId, userId, tx);
      const payable = payment.purchase.supplierPayables[0];
      if (payable) {
        const newPaid = remainingPayableAmount(payable.paidAmountKgs, payment.amountKgs);
        const remaining = remainingPayableAmount(payable.amountKgs, newPaid);
        await tx.supplierPayable.update({
          where: { id: payable.id },
          data: {
            paidAmountKgs: moneyStr(newPaid),
            remainingAmountKgs: moneyStr(remaining),
            status: payableStatusFromAmounts(payable.amountKgs, newPaid) as PayableStatus,
          },
        });
        await this.accounting.syncPurchaseSettlement(tx, payment.purchaseId);
      }
      return reversal;
    });
  }

  async recordCargoPayment(userId: string, cargoPayableId: string, dto: CreateCargoPaymentDto) {
    await this.payableSync.syncFromLedger();
    const amount = roundMoney(dto.amountKgs);
    if (!amount.gt(0)) {
      throw new BadRequestException('Сумма оплаты должна быть больше 0');
    }

    return this.prisma.$transaction(async (tx) => {
      const payable = await tx.cargoPayable.findUnique({
        where: { id: cargoPayableId },
      });
      if (!payable) throw new NotFoundException('Долг за карго не найден');
      if (amount.gt(dec(payable.remainingAmountKgs))) {
        throw new BadRequestException('Сумма оплаты не может превышать остаток долга');
      }

      const account = await this.accounting.requireCompanyPaymentAccount(
        dto.paymentAccountId,
        tx,
      );
      const cashAccountCode = this.accounting.cashAccountCodeForCompanyAccount(account);
      const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

      const paymentId = randomUUID();
      const journal = await this.accounting.postJournal(
        {
          sourceType: AccountingSourceType.CARGO_PAYMENT,
          sourceId: paymentId,
          memo: dto.note?.trim() || 'Cargo payment',
          lines: buildCargoPaymentLines({ amountKgs: amount, cashAccountCode }).map((line) =>
            line.accountCode === cashAccountCode
              ? { ...line, paymentAccountId: account.id }
              : line,
          ),
          createdByUserId: userId,
          postedAt: paidAt,
        },
        tx,
      );

      const payment = await tx.cargoPayment.create({
        data: {
          id: paymentId,
          cargoPayableId,
          amountKgs: moneyStr(amount),
          paidAt,
          paymentAccountId: account.id,
          journalId: journal.id,
          createdByUserId: userId,
          note: dto.note?.trim() || null,
        },
      });

      const newPaid = roundMoney(dec(payable.paidAmountKgs).plus(amount));
      const remaining = remainingPayableAmount(payable.amountKgs, newPaid);
      await tx.cargoPayable.update({
        where: { id: cargoPayableId },
        data: {
          paidAmountKgs: moneyStr(newPaid),
          remainingAmountKgs: moneyStr(remaining),
          status: payableStatusFromAmounts(payable.amountKgs, newPaid) as PayableStatus,
        },
      });

      await this.accounting.syncPurchaseSettlement(tx, payable.purchaseId);
      return tx.cargoPayment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { journal: { include: { lines: { include: { account: true } } } } },
      });
    });
  }

  async recordTransportPayment(
    userId: string,
    transportPayableId: string,
    dto: CreateCargoPaymentDto,
  ) {
    await this.payableSync.syncFromLedger();
    const amount = roundMoney(dto.amountKgs);
    if (!amount.gt(0)) {
      throw new BadRequestException('Сумма оплаты должна быть больше 0');
    }

    return this.prisma.$transaction(async (tx) => {
      const payable = await tx.transportPayable.findUnique({
        where: { id: transportPayableId },
      });
      if (!payable) throw new NotFoundException('Долг за транспорт не найден');
      if (amount.gt(dec(payable.remainingAmountKgs))) {
        throw new BadRequestException('Сумма оплаты не может превышать остаток долга');
      }

      const account = await this.accounting.requireCompanyPaymentAccount(
        dto.paymentAccountId,
        tx,
      );
      const cashAccountCode = this.accounting.cashAccountCodeForCompanyAccount(account);
      const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
      const paymentId = randomUUID();
      const sourceType =
        payable.type === 'CHINA_INTERNAL_TRANSPORT'
          ? AccountingSourceType.LOGISTICS_CHINA_PAYMENT
          : AccountingSourceType.LOGISTICS_KYRGYZSTAN_PAYMENT;

      await this.accounting.postJournal(
        {
          sourceType,
          sourceId: paymentId,
          memo: dto.note?.trim() || `Transport payment ${payable.type}`,
          lines: buildTransportPaymentLines({ amountKgs: amount, cashAccountCode }).map((line) =>
            line.accountCode === cashAccountCode
              ? { ...line, paymentAccountId: account.id }
              : line,
          ),
          createdByUserId: userId,
          postedAt: paidAt,
        },
        tx,
      );

      const newPaid = roundMoney(dec(payable.paidAmountKgs).plus(amount));
      const remaining = remainingPayableAmount(payable.amountKgs, newPaid);
      const updated = await tx.transportPayable.update({
        where: { id: transportPayableId },
        data: {
          paidAmountKgs: moneyStr(newPaid),
          remainingAmountKgs: moneyStr(remaining),
          status: payableStatusFromAmounts(payable.amountKgs, newPaid) as PayableStatus,
        },
      });
      await this.accounting.syncPurchaseSettlement(tx, payable.purchaseId);
      return updated;
    });
  }

  async cancelCargoPayment(userId: string, paymentId: string) {
    const payment = await this.prisma.cargoPayment.findUnique({
      where: { id: paymentId },
      include: { journal: true, cargoPayable: true },
    });
    if (!payment) throw new NotFoundException('Cargo payment not found');
    if (payment.journal.status === JournalStatus.VOIDED) {
      throw new BadRequestException('Cargo payment is already reversed');
    }

    return this.prisma.$transaction(async (tx) => {
      const reversal = await this.accounting.voidAndReverse(payment.journalId, userId, tx);
      const payable = payment.cargoPayable;
      const newPaid = remainingPayableAmount(payable.paidAmountKgs, payment.amountKgs);
      const remaining = remainingPayableAmount(payable.amountKgs, newPaid);
      await tx.cargoPayable.update({
        where: { id: payable.id },
        data: {
          paidAmountKgs: moneyStr(newPaid),
          remainingAmountKgs: moneyStr(remaining),
          status: payableStatusFromAmounts(payable.amountKgs, newPaid) as PayableStatus,
        },
      });
      await this.accounting.syncPurchaseSettlement(tx, payable.purchaseId);
      return reversal;
    });
  }

  async recordOperatingExpense(userId: string, dto: CreateOperatingExpenseDto) {
    const amount = roundMoney(dto.amountKgs);
    if (!amount.gt(0)) {
      throw new BadRequestException('Expense amount must be greater than zero');
    }
    if (dto.currency && dto.currency !== Currency.KGS) {
      throw new BadRequestException('Phase 1 operating expenses must be recorded in KGS');
    }

    const expenseDate = parseBusinessDate(dto.expenseDate, 'Expense date');
    const category = dto.category;
    const accountCode = EXPENSE_CATEGORY_ACCOUNT_CODE[category];

    return this.prisma.$transaction(async (tx) => {
      const paymentAccount = await this.accounting.requireCompanyPaymentAccount(
        dto.paymentAccountId,
        tx,
      );
      const cashAccountCode =
        this.accounting.cashAccountCodeForCompanyAccount(paymentAccount);
      const expenseAccount = await tx.chartAccount.findUnique({
        where: { code: accountCode },
      });
      if (!expenseAccount) {
        throw new BadRequestException(`Chart account ${accountCode} is missing`);
      }

      const expenseId = randomUUID();
      const journal = await this.accounting.postJournal(
        {
          sourceType: AccountingSourceType.OPERATING_EXPENSE,
          sourceId: expenseId,
          memo: dto.description.trim(),
          lines: buildOperatingExpenseLines({
            category,
            amountKgs: amount,
            cashAccountCode,
          }).map((line) =>
            line.accountCode === cashAccountCode
              ? { ...line, paymentAccountId: paymentAccount.id }
              : line,
          ),
          createdByUserId: userId,
          postedAt: expenseDate,
        },
        tx,
      );

      const expense = await tx.operatingExpense.create({
        data: {
          id: expenseId,
          expenseDate,
          category,
          amountKgs: moneyStr(amount),
          currency: Currency.KGS,
          accountId: expenseAccount.id,
          paymentAccountId: paymentAccount.id,
          description: dto.description.trim(),
          reference: dto.reference?.trim() || null,
          journalId: journal.id,
          createdByUserId: userId,
        },
      });

      return tx.operatingExpense.findUniqueOrThrow({
        where: { id: expense.id },
        include: {
          account: true,
          paymentAccount: { include: { paymentMethod: true } },
          journal: { include: { lines: { include: { account: true } } } },
        },
      });
    });
  }

  async listOperatingExpenses() {
    const rows = await this.prisma.operatingExpense.findMany({
      where: { journal: { status: JournalStatus.POSTED } },
      include: {
        account: true,
        paymentAccount: { include: { paymentMethod: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { expenseDate: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      expenseDate: row.expenseDate,
      category: row.category,
      amountKgs: publicDecimal(row.amountKgs),
      currency: row.currency,
      accountCode: row.account.code,
      accountName: row.account.name,
      paymentAccountId: row.paymentAccountId,
      description: row.description,
      reference: row.reference,
      journalId: row.journalId,
      createdBy: row.createdBy,
    }));
  }

  async recordOwnerWithdrawal(userId: string, dto: CreateOwnerWithdrawalDto) {
    const amount = roundMoney(dto.amountKgs);
    if (!amount.gt(0)) {
      throw new BadRequestException('Withdrawal amount must be greater than zero');
    }
    const withdrawnAt = parseBusinessDate(dto.withdrawnAt, 'Withdrawal date');

    return this.prisma.$transaction(async (tx) => {
      const paymentAccount = await this.accounting.requireCompanyPaymentAccount(
        dto.paymentAccountId,
        tx,
      );
      const cashAccountCode =
        this.accounting.cashAccountCodeForCompanyAccount(paymentAccount);

      const withdrawalId = randomUUID();
      const journal = await this.accounting.postJournal(
        {
          sourceType: AccountingSourceType.OWNER_WITHDRAWAL,
          sourceId: withdrawalId,
          memo: dto.description?.trim() || 'Owner withdrawal',
          lines: buildOwnerWithdrawalLines({
            amountKgs: amount,
            cashAccountCode,
          }).map((line) =>
            line.accountCode === cashAccountCode
              ? { ...line, paymentAccountId: paymentAccount.id }
              : line,
          ),
          createdByUserId: userId,
          postedAt: withdrawnAt,
        },
        tx,
      );

      const withdrawal = await tx.ownerWithdrawal.create({
        data: {
          id: withdrawalId,
          withdrawnAt,
          amountKgs: moneyStr(amount),
          paymentAccountId: paymentAccount.id,
          description: dto.description?.trim() || null,
          journalId: journal.id,
          createdByUserId: userId,
        },
      });

      return tx.ownerWithdrawal.findUniqueOrThrow({
        where: { id: withdrawal.id },
        include: {
          paymentAccount: { include: { paymentMethod: true } },
          journal: { include: { lines: { include: { account: true } } } },
        },
      });
    });
  }

  async listOwnerWithdrawals() {
    const rows = await this.prisma.ownerWithdrawal.findMany({
      where: { journal: { status: JournalStatus.POSTED } },
      include: {
        paymentAccount: { include: { paymentMethod: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { withdrawnAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      withdrawnAt: row.withdrawnAt,
      amountKgs: publicDecimal(row.amountKgs),
      paymentAccountId: row.paymentAccountId,
      description: row.description,
      journalId: row.journalId,
      createdBy: row.createdBy,
    }));
  }

  async cancelOperatingExpense(userId: string, id: string) {
    const expense = await this.prisma.operatingExpense.findUnique({
      where: { id },
      include: { journal: true },
    });
    if (!expense) throw new NotFoundException('Operating expense not found');
    return this.accounting.voidAndReverse(expense.journalId, userId);
  }

  async cancelOwnerWithdrawal(userId: string, id: string) {
    const withdrawal = await this.prisma.ownerWithdrawal.findUnique({
      where: { id },
      include: { journal: true },
    });
    if (!withdrawal) throw new NotFoundException('Owner withdrawal not found');
    return this.accounting.voidAndReverse(withdrawal.journalId, userId);
  }

  async listOpenCustomerDebt() {
    const sales = await this.prisma.sale.findMany({
      where: {
        debtAmountKgs: { gt: 0 },
        status: { in: [SaleStatus.CONFIRMED, SaleStatus.COMPLETED] },
      },
      include: { client: true },
      orderBy: { saleDate: 'desc' },
    });
    const total = sales.reduce((sum, row) => sum.plus(dec(row.debtAmountKgs)), dec(0));
    return {
      totalOpenDebtKgs: moneyStr(total),
      sales: sales.map((row) => ({
        saleId: row.id,
        saleNumber: row.number,
        clientId: row.clientId,
        clientName: row.client.name,
        originalAmountKgs: publicDecimal(row.totalAmountKgs),
        paidAmountKgs: publicDecimal(row.paidAmountKgs),
        remainingKgs: publicDecimal(row.debtAmountKgs),
        debtAmountKgs: publicDecimal(row.debtAmountKgs),
        saleDate: row.saleDate.toISOString(),
      })),
    };
  }
}
