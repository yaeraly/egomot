import { AccountingSourceType, JournalStatus } from '@prisma/client';
import {
  OPENING_INVESTOR_CAPITAL_SOURCE_ID,
  openingInvestorCapitalPostedAt,
} from './accounting-codes';
import { buildOpeningInvestorCapitalLines } from './accounting-journal.logic';
import {
  persistOpeningInvestorCapital,
  persistPostedJournal,
} from './accounting-journal.store';

describe('persistPostedJournal opening capital idempotency', () => {
  const existing = {
    id: 'journal-opening-1',
    number: 'J-2026-0001',
    status: JournalStatus.POSTED,
    sourceType: 'OPENING_BALANCE',
    sourceId: OPENING_INVESTOR_CAPITAL_SOURCE_ID,
    postedAt: new Date('2026-08-26T08:52:14.438Z'),
    lines: [],
  };

  it('returns the existing POSTED opening journal and does not insert a second one', async () => {
    const db = {
      journal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
        update: jest.fn(),
      },
      chartAccount: { findMany: jest.fn() },
      accountingPeriod: { findFirst: jest.fn() },
    };

    const result = await persistPostedJournal(db as never, {
      sourceType: AccountingSourceType.OPENING_BALANCE,
      sourceId: OPENING_INVESTOR_CAPITAL_SOURCE_ID,
      memo: 'Opening investor capital',
      lines: buildOpeningInvestorCapitalLines(),
      createdByUserId: 'owner-1',
    });

    expect(result).toBe(existing);
    expect(db.journal.create).not.toHaveBeenCalled();
    expect(db.journal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sourceType: 'OPENING_BALANCE',
          sourceId: OPENING_INVESTOR_CAPITAL_SOURCE_ID,
          status: JournalStatus.POSTED,
        },
      }),
    );
  });

  it('corrects the existing opening journal date to 2026-05-01 without inserting another', async () => {
    const postedAt = openingInvestorCapitalPostedAt();
    const updated = { ...existing, postedAt };
    const db = {
      journal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(updated),
      },
      chartAccount: { findMany: jest.fn() },
      accountingPeriod: { findFirst: jest.fn() },
    };

    const result = await persistOpeningInvestorCapital(db as never, 'owner-1');

    expect(db.journal.create).not.toHaveBeenCalled();
    expect(db.journal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: existing.id },
        data: { postedAt },
      }),
    );
    expect(result.postedAt).toEqual(postedAt);
    expect(postedAt.toISOString().startsWith('2026-05-01')).toBe(true);
  });

  it('leaves the opening journal unchanged when the date is already 2026-05-01', async () => {
    const postedAt = openingInvestorCapitalPostedAt();
    const current = { ...existing, postedAt };
    const db = {
      journal: {
        findFirst: jest.fn().mockResolvedValue(current),
        create: jest.fn(),
        update: jest.fn(),
      },
      chartAccount: { findMany: jest.fn() },
      accountingPeriod: { findFirst: jest.fn() },
    };

    const result = await persistOpeningInvestorCapital(db as never, 'owner-1');
    expect(result).toBe(current);
    expect(db.journal.create).not.toHaveBeenCalled();
    expect(db.journal.update).not.toHaveBeenCalled();
  });
});
