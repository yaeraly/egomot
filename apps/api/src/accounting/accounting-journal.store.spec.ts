import { AccountingSourceType, JournalStatus } from '@prisma/client';
import { OPENING_INVESTOR_CAPITAL_SOURCE_ID } from './accounting-codes';
import { buildOpeningInvestorCapitalLines } from './accounting-journal.logic';
import { persistPostedJournal } from './accounting-journal.store';

describe('persistPostedJournal opening capital idempotency', () => {
  const existing = {
    id: 'journal-opening-1',
    number: 'J-2026-0001',
    status: JournalStatus.POSTED,
    sourceType: 'OPENING_BALANCE',
    sourceId: OPENING_INVESTOR_CAPITAL_SOURCE_ID,
    lines: [],
  };

  it('returns the existing POSTED opening journal and does not insert a second one', async () => {
    const db = {
      journal: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
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
});
