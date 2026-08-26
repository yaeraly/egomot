import {
  AccountingPeriodStatus,
  ChartAccountType,
  type PrismaClient,
} from '@prisma/client';
import {
  ACCOUNT_CODE,
  COMPANY_PAYMENT_METHOD_CODE,
  DEFAULT_CHART_ACCOUNTS,
  UNSPECIFIED_CARGO_VENDOR_NAME,
} from './accounting-codes';
import { persistOpeningInvestorCapital } from './accounting-journal.store';

export async function ensureDefaultChartAccounts(prisma: PrismaClient) {
  for (const account of DEFAULT_CHART_ACCOUNTS) {
    await prisma.chartAccount.upsert({
      where: { code: account.code },
      update: {
        type: account.type as ChartAccountType,
        isActive: true,
        sortOrder: account.sortOrder,
      },
      create: {
        code: account.code,
        name: account.name,
        type: account.type as ChartAccountType,
        isActive: true,
        sortOrder: account.sortOrder,
      },
    });
  }
}

export async function ensureOpenAccountingPeriod(prisma: PrismaClient) {
  const existing = await prisma.accountingPeriod.findFirst({
    where: { status: AccountingPeriodStatus.OPEN },
  });
  if (existing) return existing;
  return prisma.accountingPeriod.create({
    data: {
      name: 'Open ledger',
      startsOn: new Date(Date.UTC(2000, 0, 1)),
      endsOn: new Date(Date.UTC(2099, 11, 31)),
      status: AccountingPeriodStatus.OPEN,
    },
  });
}

export async function ensureUnspecifiedCargoVendor(prisma: PrismaClient) {
  const existing = await prisma.cargoVendor.findFirst({
    where: { name: UNSPECIFIED_CARGO_VENDOR_NAME },
  });
  if (existing) return existing;
  return prisma.cargoVendor.create({
    data: { name: UNSPECIFIED_CARGO_VENDOR_NAME, isActive: true },
  });
}

export async function ensureCompanyPaymentAccounts(prisma: PrismaClient) {
  const owner = await prisma.user.findFirst({
    where: { role: 'OWNER', isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) return;

  const cashChart = await prisma.chartAccount.findUnique({
    where: { code: ACCOUNT_CODE.CASH },
  });
  const bankChart = await prisma.chartAccount.findUnique({
    where: { code: ACCOUNT_CODE.BANK },
  });
  if (!cashChart || !bankChart) return;

  const cashMethod = await prisma.paymentMethod.upsert({
    where: { code: COMPANY_PAYMENT_METHOD_CODE.CASH },
    update: { name: 'Company Cash', isActive: true },
    create: {
      code: COMPANY_PAYMENT_METHOD_CODE.CASH,
      name: 'Company Cash',
      isActive: true,
      sortOrder: 90,
    },
  });
  const bankMethod = await prisma.paymentMethod.upsert({
    where: { code: COMPANY_PAYMENT_METHOD_CODE.BANK },
    update: { name: 'Company Bank', isActive: true },
    create: {
      code: COMPANY_PAYMENT_METHOD_CODE.BANK,
      name: 'Company Bank',
      isActive: true,
      sortOrder: 91,
    },
  });

  await prisma.paymentAccount.upsert({
    where: {
      userId_paymentMethodId: {
        userId: owner.id,
        paymentMethodId: cashMethod.id,
      },
    },
    update: {
      isCompanyAccount: true,
      chartAccountId: cashChart.id,
      isActive: true,
      name: 'Company Cash',
    },
    create: {
      userId: owner.id,
      paymentMethodId: cashMethod.id,
      name: 'Company Cash',
      isActive: true,
      isCompanyAccount: true,
      chartAccountId: cashChart.id,
    },
  });

  await prisma.paymentAccount.upsert({
    where: {
      userId_paymentMethodId: {
        userId: owner.id,
        paymentMethodId: bankMethod.id,
      },
    },
    update: {
      isCompanyAccount: true,
      chartAccountId: bankChart.id,
      isActive: true,
      name: 'Company Bank',
    },
    create: {
      userId: owner.id,
      paymentMethodId: bankMethod.id,
      name: 'Company Bank',
      isActive: true,
      isCompanyAccount: true,
      chartAccountId: bankChart.id,
    },
  });
}

export async function ensureOpeningInvestorCapital(prisma: PrismaClient) {
  const owner = await prisma.user.findFirst({
    where: { role: 'OWNER', isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) {
    throw new Error('Opening investor capital requires an OWNER user');
  }
  return persistOpeningInvestorCapital(prisma, owner.id);
}

export async function bootstrapAccountingLedger(prisma: PrismaClient) {
  await ensureDefaultChartAccounts(prisma);
  await ensureOpenAccountingPeriod(prisma);
  await ensureUnspecifiedCargoVendor(prisma);
  await ensureCompanyPaymentAccounts(prisma);
  await ensureOpeningInvestorCapital(prisma);
}
