import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AccountingSourceType,
  Currency,
  PayableStatus,
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
  payableStatusFromAmounts,
  remainingPayableAmount,
} from './accounting-journal.logic';
import { AccountingService } from './accounting.service';
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
  ) {}

  async listSupplierPayables() {
    const rows = await this.prisma.supplierPayable.findMany({
      include: {
        supplier: true,
        purchase: { select: { id: true, number: true, payableStatus: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      supplierId: row.supplierId,
      supplierName: row.supplier.name,
      purchaseId: row.purchaseId,
      purchaseNumber: row.purchase.number,
      invoiceRef: row.invoiceRef,
      amountKgs: publicDecimal(row.amountKgs),
      paidAmountKgs: publicDecimal(row.paidAmountKgs),
      remainingAmountKgs: publicDecimal(row.remainingAmountKgs),
      dueDate: row.dueDate,
      status: row.status,
    }));
  }

  async listCargoPayables() {
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
    const amount = roundMoney(dto.amountKgs);
    if (!amount.gt(0)) {
      throw new BadRequestException('Payment amount must be greater than zero');
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
          'No supplier payable exists for this purchase. Historical purchases are not backfilled.',
        );
      }
      if (amount.gt(dec(payable.remainingAmountKgs))) {
        throw new BadRequestException('Payment exceeds remaining supplier payable');
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

  async recordCargoPayment(userId: string, cargoPayableId: string, dto: CreateCargoPaymentDto) {
    const amount = roundMoney(dto.amountKgs);
    if (!amount.gt(0)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    return this.prisma.$transaction(async (tx) => {
      const payable = await tx.cargoPayable.findUnique({
        where: { id: cargoPayableId },
      });
      if (!payable) throw new NotFoundException('Cargo payable not found');
      if (amount.gt(dec(payable.remainingAmountKgs))) {
        throw new BadRequestException('Payment exceeds remaining cargo payable');
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

  async listOpenCustomerDebt() {
    const sales = await this.prisma.sale.findMany({
      where: { debtAmountKgs: { gt: 0 } },
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
        debtAmountKgs: publicDecimal(row.debtAmountKgs),
        saleDate: row.saleDate.toISOString(),
      })),
    };
  }
}
