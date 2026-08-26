import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingSourceType,
  JournalStatus,
  PayableStatus,
  Prisma,
} from '@prisma/client';
import { publicDecimal } from '../common/decimal.util';
import { PrismaService } from '../prisma/prisma.service';
import { dec, moneyStr, roundMoney } from '../purchases/purchase-calc';
import {
  ACCOUNT_CODE,
  glCashAccountCodeForPaymentMethod,
  type AccountCode,
} from './accounting-codes';
import {
  InvalidJournalLineError,
  UnbalancedJournalError,
  buildDebtCollectionLines,
  buildPurchaseReceiptLines,
  buildSaleLines,
  payableStatusFromAmounts,
  remainingPayableAmount,
  reverseJournalLines,
  saleCogsFromItems,
  type JournalLineDraft,
} from './accounting-journal.logic';
import {
  persistOpeningInvestorCapital,
  persistPostedJournal,
  type PersistJournalInput,
} from './accounting-journal.store';

export type AccountingClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  async listCompanyPaymentAccounts() {
    const rows = await this.prisma.paymentAccount.findMany({
      where: { isCompanyAccount: true, isActive: true },
      include: { paymentMethod: true, chartAccount: true },
      orderBy: [{ paymentMethod: { sortOrder: 'asc' } }],
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      paymentMethodCode: row.paymentMethod.code,
      paymentMethodName: row.paymentMethod.name,
      chartAccountCode: row.chartAccount?.code ?? null,
      chartAccountName: row.chartAccount?.name ?? null,
    }));
  }

  async listAccounts() {
    const rows = await this.prisma.chartAccount.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    }));
  }

  async listJournals() {
    const rows = await this.prisma.journal.findMany({
      include: {
        lines: { include: { account: true }, orderBy: { sortOrder: 'asc' } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ postedAt: 'desc' }, { number: 'desc' }],
      take: 200,
    });
    return rows.map((row) => this.serializeJournal(row));
  }

  async getJournal(id: string) {
    const row = await this.prisma.journal.findUnique({
      where: { id },
      include: {
        lines: { include: { account: true }, orderBy: { sortOrder: 'asc' } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!row) throw new NotFoundException('Journal not found');
    return this.serializeJournal(row);
  }

  async postJournal(input: PersistJournalInput, db: AccountingClient = this.prisma) {
    try {
      return await persistPostedJournal(db, input);
    } catch (error) {
      this.rethrowJournalError(error);
    }
  }

  async ensureOpeningInvestorCapital(
    createdByUserId: string,
    db: AccountingClient = this.prisma,
  ) {
    return persistOpeningInvestorCapital(db, createdByUserId);
  }

  async voidAndReverse(
    journalId: string,
    createdByUserId: string,
    db: AccountingClient = this.prisma,
  ) {
    const run = async (tx: AccountingClient) => {
      const original = await tx.journal.findUnique({
        where: { id: journalId },
        include: { lines: { include: { account: true }, orderBy: { sortOrder: 'asc' } } },
      });
      if (!original) throw new NotFoundException('Journal not found');
      if (original.status === JournalStatus.VOIDED) {
        throw new BadRequestException('Journal is already voided');
      }

      const drafts: JournalLineDraft[] = original.lines.map((row) => ({
        accountCode: row.account.code,
        debitKgs: moneyStr(row.debitKgs),
        creditKgs: moneyStr(row.creditKgs),
        memo: row.memo ?? undefined,
        paymentAccountId: row.paymentAccountId,
      }));

      const reversal = await this.postJournal(
        {
          sourceType: AccountingSourceType.REVERSAL,
          sourceId: original.id,
          memo: `Reversal of ${original.number}`,
          lines: reverseJournalLines(drafts),
          createdByUserId,
          reversesJournalId: original.id,
        },
        tx,
      );
      await tx.journal.update({
        where: { id: original.id },
        data: { status: JournalStatus.VOIDED },
      });
      return reversal;
    };

    if (db === this.prisma) {
      return this.prisma.$transaction(async (tx) => run(tx));
    }
    return run(db);
  }

  async postConfirmedSale(
    db: AccountingClient,
    params: {
      saleId: string;
      revenueKgs: Prisma.Decimal | string;
      paidSplits: Array<{ paymentMethodCode: string; amountKgs: Prisma.Decimal | string }>;
      items: Array<{ quantity: Prisma.Decimal | string; unitCostKgs: Prisma.Decimal | string }>;
      createdByUserId: string;
      postedAt?: Date;
    },
  ) {
    const cashByAccountCode: Record<string, string> = {};
    for (const split of params.paidSplits) {
      const code = glCashAccountCodeForPaymentMethod(split.paymentMethodCode);
      const current = roundMoney(cashByAccountCode[code] ?? 0);
      cashByAccountCode[code] = moneyStr(current.plus(roundMoney(split.amountKgs)));
    }

    const cogsKgs = saleCogsFromItems(params.items);
    const lines = await this.tagCompanyCashLines(
      db,
      buildSaleLines({
        revenueKgs: params.revenueKgs,
        cogsKgs,
        cashByAccountCode,
      }),
    );

    return this.postJournal(
      {
        sourceType: AccountingSourceType.SALE,
        sourceId: params.saleId,
        memo: 'Confirmed sale',
        lines,
        createdByUserId: params.createdByUserId,
        postedAt: params.postedAt,
      },
      db,
    );
  }

  async postDebtCollection(
    db: AccountingClient,
    params: {
      paymentId: string;
      amountKgs: Prisma.Decimal | string;
      paymentMethodCode: string;
      createdByUserId: string;
      postedAt?: Date;
    },
  ) {
    const cashAccountCode = glCashAccountCodeForPaymentMethod(params.paymentMethodCode);
    const lines = await this.tagCompanyCashLines(
      db,
      buildDebtCollectionLines({
        amountKgs: params.amountKgs,
        cashAccountCode,
      }),
    );
    return this.postJournal(
      {
        sourceType: AccountingSourceType.SALE_DEBT_PAYMENT,
        sourceId: params.paymentId,
        memo: 'Customer debt collection',
        lines,
        createdByUserId: params.createdByUserId,
        postedAt: params.postedAt,
      },
      db,
    );
  }

  async postPurchaseReceipt(
    db: AccountingClient,
    params: {
      receiptId: string;
      purchaseId: string;
      supplierId: string;
      inventoryKgs: Prisma.Decimal | string;
      cargoKgs: Prisma.Decimal | string;
      createdByUserId: string;
      postedAt?: Date;
      cargoVendorId?: string | null;
      paidSupplierKgs?: Prisma.Decimal | string;
      cashAccountCode?: string;
    },
  ) {
    const inventory = roundMoney(params.inventoryKgs);
    if (!inventory.gt(0)) {
      return null;
    }

    const alreadyPosted = await db.journal.findFirst({
      where: {
        sourceType: AccountingSourceType.PURCHASE_RECEIPT,
        sourceId: params.receiptId,
        status: JournalStatus.POSTED,
      },
    });

    const cargo = roundMoney(params.cargoKgs);
    const paidSupplier = roundMoney(params.paidSupplierKgs ?? 0);
    const supplierPortion = remainingPayableAmount(inventory, cargo);
    const unpaidSupplier = remainingPayableAmount(supplierPortion, paidSupplier);
    const lines = await this.tagCompanyCashLines(
      db,
      buildPurchaseReceiptLines({
        inventoryKgs: inventory,
        cargoKgs: cargo,
        paidSupplierKgs: paidSupplier,
        cashAccountCode: (params.cashAccountCode as AccountCode | undefined) ?? ACCOUNT_CODE.CASH,
      }),
    );

    const journal = await this.postJournal(
      {
        sourceType: AccountingSourceType.PURCHASE_RECEIPT,
        sourceId: params.receiptId,
        memo: 'Purchase receipt landed cost',
        lines,
        createdByUserId: params.createdByUserId,
        postedAt: params.postedAt,
      },
      db,
    );

    if (alreadyPosted) {
      return journal;
    }

    if (supplierPortion.gt(0)) {
      const existing = await db.supplierPayable.findUnique({
        where: { purchaseId: params.purchaseId },
      });
      if (existing) {
        const amount = roundMoney(dec(existing.amountKgs).plus(supplierPortion));
        const paid = roundMoney(dec(existing.paidAmountKgs).plus(paidSupplier));
        const remaining = remainingPayableAmount(amount, paid);
        await db.supplierPayable.update({
          where: { id: existing.id },
          data: {
            amountKgs: moneyStr(amount),
            paidAmountKgs: moneyStr(paid),
            remainingAmountKgs: moneyStr(remaining),
            status: payableStatusFromAmounts(amount, paid) as PayableStatus,
          },
        });
      } else {
        await db.supplierPayable.create({
          data: {
            supplierId: params.supplierId,
            purchaseId: params.purchaseId,
            amountKgs: moneyStr(supplierPortion),
            paidAmountKgs: moneyStr(paidSupplier),
            remainingAmountKgs: moneyStr(unpaidSupplier),
            status: payableStatusFromAmounts(supplierPortion, paidSupplier) as PayableStatus,
            journalId: journal.id,
          },
        });
      }
    }

    if (cargo.gt(0)) {
      const existingCargo = await db.cargoPayable.findFirst({
        where: { purchaseId: params.purchaseId },
        orderBy: { createdAt: 'asc' },
      });
      if (existingCargo) {
        const amount = roundMoney(dec(existingCargo.amountKgs).plus(cargo));
        const remaining = remainingPayableAmount(amount, existingCargo.paidAmountKgs);
        await db.cargoPayable.update({
          where: { id: existingCargo.id },
          data: {
            amountKgs: moneyStr(amount),
            remainingAmountKgs: moneyStr(remaining),
            status: payableStatusFromAmounts(amount, existingCargo.paidAmountKgs) as PayableStatus,
          },
        });
      } else {
        await db.cargoPayable.create({
          data: {
            cargoVendorId: params.cargoVendorId ?? null,
            purchaseId: params.purchaseId,
            amountKgs: moneyStr(cargo),
            paidAmountKgs: '0.00',
            remainingAmountKgs: moneyStr(cargo),
            status: PayableStatus.UNPAID,
            journalId: journal.id,
          },
        });
      }
    }

    await this.syncPurchaseSettlement(db, params.purchaseId);
    return journal;
  }

  async syncPurchaseSettlement(db: AccountingClient, purchaseId: string) {
    const supplier = await db.supplierPayable.findUnique({
      where: { purchaseId },
    });
    const cargoRows = await db.cargoPayable.findMany({
      where: { purchaseId },
    });
    if (!supplier && cargoRows.length === 0) {
      return;
    }

    const paid = roundMoney(
      (supplier ? dec(supplier.paidAmountKgs) : dec(0)).plus(
        cargoRows.reduce((sum, row) => sum.plus(dec(row.paidAmountKgs)), dec(0)),
      ),
    );
    const remaining = roundMoney(
      (supplier ? dec(supplier.remainingAmountKgs) : dec(0)).plus(
        cargoRows.reduce((sum, row) => sum.plus(dec(row.remainingAmountKgs)), dec(0)),
      ),
    );
    const total = roundMoney(paid.plus(remaining));
    await db.purchase.update({
      where: { id: purchaseId },
      data: {
        paidAmountKgs: moneyStr(paid),
        unpaidAmountKgs: moneyStr(remaining),
        payableStatus: payableStatusFromAmounts(total, paid) as PayableStatus,
      },
    });
  }

  async findCompanyPaymentAccountByChartCode(db: AccountingClient, accountCode: string) {
    const account = await db.chartAccount.findUnique({ where: { code: accountCode } });
    if (!account) return null;
    return db.paymentAccount.findFirst({
      where: {
        isCompanyAccount: true,
        isActive: true,
        chartAccountId: account.id,
      },
      include: { paymentMethod: true, chartAccount: true },
    });
  }

  async requireCompanyPaymentAccount(paymentAccountId: string, db: AccountingClient = this.prisma) {
    const account = await db.paymentAccount.findUnique({
      where: { id: paymentAccountId },
      include: { paymentMethod: true, chartAccount: true },
    });
    if (!account || !account.isActive) {
      throw new NotFoundException('Payment account not found');
    }
    if (!account.isCompanyAccount) {
      throw new BadRequestException(
        'Use a company Cash or Bank account for accounting payments. Employee wallets are custody accounts, not company cash.',
      );
    }
    return account;
  }

  cashAccountCodeForCompanyAccount(account: {
    chartAccount?: { code: string } | null;
    paymentMethod: { code: string };
  }) {
    if (account.chartAccount?.code === ACCOUNT_CODE.BANK) {
      return ACCOUNT_CODE.BANK;
    }
    if (account.chartAccount?.code === ACCOUNT_CODE.CASH) {
      return ACCOUNT_CODE.CASH;
    }
    return glCashAccountCodeForPaymentMethod(account.paymentMethod.code);
  }

  private async tagCompanyCashLines(db: AccountingClient, lines: JournalLineDraft[]) {
    const tagged: JournalLineDraft[] = [];
    for (const row of lines) {
      if (row.accountCode === ACCOUNT_CODE.CASH || row.accountCode === ACCOUNT_CODE.BANK) {
        const company = await this.findCompanyPaymentAccountByChartCode(db, row.accountCode);
        tagged.push({
          ...row,
          paymentAccountId: company?.id ?? row.paymentAccountId ?? null,
        });
      } else {
        tagged.push(row);
      }
    }
    return tagged;
  }

  serializeJournal(row: {
    id: string;
    number: string;
    status: JournalStatus;
    sourceType: AccountingSourceType;
    sourceId: string;
    memo: string | null;
    postedAt: Date;
    createdAt: Date;
    createdByUserId: string;
    reversesJournalId: string | null;
    createdBy?: { id: string; name: string; email: string };
    lines: Array<{
      id: string;
      debitKgs: Prisma.Decimal;
      creditKgs: Prisma.Decimal;
      memo: string | null;
      sortOrder: number;
      paymentAccountId: string | null;
      account: { code: string; name: string; type: string };
    }>;
  }) {
    const debit = row.lines.reduce((sum, line) => sum.plus(dec(line.debitKgs)), dec(0));
    const credit = row.lines.reduce((sum, line) => sum.plus(dec(line.creditKgs)), dec(0));
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      memo: row.memo,
      postedAt: row.postedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      createdByUserId: row.createdByUserId,
      createdBy: row.createdBy ?? null,
      reversesJournalId: row.reversesJournalId,
      debitTotalKgs: moneyStr(debit),
      creditTotalKgs: moneyStr(credit),
      lines: row.lines.map((line) => ({
        id: line.id,
        accountCode: line.account.code,
        accountName: line.account.name,
        accountType: line.account.type,
        debitKgs: publicDecimal(line.debitKgs),
        creditKgs: publicDecimal(line.creditKgs),
        memo: line.memo,
        paymentAccountId: line.paymentAccountId,
        sortOrder: line.sortOrder,
      })),
    };
  }

  rethrowJournalError(error: unknown): never {
    if (error instanceof UnbalancedJournalError || error instanceof InvalidJournalLineError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
