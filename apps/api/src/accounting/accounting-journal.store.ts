import {
  AccountingSourceType,
  JournalStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  OPENING_INVESTOR_CAPITAL_KGS,
  OPENING_INVESTOR_CAPITAL_SOURCE_ID,
  openingInvestorCapitalPostedAt,
} from './accounting-codes';
import {
  InvalidJournalLineError,
  buildOpeningInvestorCapitalLines,
  formatJournalNumber,
  validateJournalLines,
  type JournalLineDraft,
} from './accounting-journal.logic';

export type AccountingDb = PrismaClient | Prisma.TransactionClient;

export class JournalIdempotentReplayError extends Error {
  constructor(readonly journalId: string) {
    super(`Posted journal already exists for this source (${journalId})`);
    this.name = 'JournalIdempotentReplayError';
  }
}

export type PersistJournalInput = {
  sourceType: AccountingSourceType;
  sourceId: string;
  memo?: string | null;
  lines: JournalLineDraft[];
  createdByUserId: string;
  postedAt?: Date;
  reversesJournalId?: string | null;
};

export async function persistPostedJournal(db: AccountingDb, input: PersistJournalInput) {
  const balanced = validateJournalLines(input.lines);

  const existing = await db.journal.findFirst({
    where: {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: JournalStatus.POSTED,
    },
    include: { lines: { include: { account: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (existing) {
    return existing;
  }

  const codes = [...new Set(input.lines.map((row) => row.accountCode))];
  const accounts = await db.chartAccount.findMany({
    where: { code: { in: codes }, isActive: true },
  });
  const byCode = new Map(accounts.map((row) => [row.code, row]));
  for (const code of codes) {
    if (!byCode.has(code)) {
      throw new InvalidJournalLineError(`Chart account ${code} is missing or inactive`);
    }
  }

  const postedAt = input.postedAt ?? new Date();
  const period = await db.accountingPeriod.findFirst({
    where: { status: 'OPEN' },
    orderBy: { startsOn: 'desc' },
  });

  const number = await nextJournalNumber(db, postedAt);

  return db.journal.create({
    data: {
      number,
      status: JournalStatus.POSTED,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      memo: input.memo ?? null,
      periodId: period?.id ?? null,
      createdByUserId: input.createdByUserId,
      postedAt,
      reversesJournalId: input.reversesJournalId ?? null,
      lines: {
        create: input.lines.map((row, index) => ({
          accountId: byCode.get(row.accountCode)!.id,
          debitKgs: row.debitKgs,
          creditKgs: row.creditKgs,
          memo: row.memo ?? null,
          paymentAccountId: row.paymentAccountId ?? null,
          sortOrder: index,
        })),
      },
    },
    include: { lines: { include: { account: true }, orderBy: { sortOrder: 'asc' } } },
  });
}

const openingJournalInclude = {
  lines: { include: { account: true }, orderBy: { sortOrder: 'asc' as const } },
};

export async function persistOpeningInvestorCapital(db: AccountingDb, createdByUserId: string) {
  const postedAt = openingInvestorCapitalPostedAt();
  const journal = await persistPostedJournal(db, {
    sourceType: AccountingSourceType.OPENING_BALANCE,
    sourceId: OPENING_INVESTOR_CAPITAL_SOURCE_ID,
    memo: 'Opening investor capital',
    lines: buildOpeningInvestorCapitalLines(OPENING_INVESTOR_CAPITAL_KGS),
    createdByUserId,
    postedAt,
  });
  const currentPostedAt =
    journal.postedAt instanceof Date ? journal.postedAt : new Date(journal.postedAt);
  if (currentPostedAt.getTime() === postedAt.getTime()) {
    return journal;
  }
  return db.journal.update({
    where: { id: journal.id },
    data: { postedAt },
    include: openingJournalInclude,
  });
}

export async function nextJournalNumber(db: AccountingDb, postedAt = new Date()): Promise<string> {
  const year = postedAt.getUTCFullYear();
  const prefix = `J-${year}-`;
  const last = await db.journal.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
  });
  const match = last?.number.match(/J-\d{4}-(\d+)$/);
  const current = match ? Number(match[1]) : 0;
  return formatJournalNumber(year, current + 1);
}

export { UnbalancedJournalError, InvalidJournalLineError } from './accounting-journal.logic';
