import { UserRole } from '@prisma/client';
import { SALES_OPERATOR_ROLES, USER_ROLE_LABELS } from './sales-access';

describe('sales-access', () => {
  it('allows OWNER and SALES as sale operators', () => {
    expect(SALES_OPERATOR_ROLES).toEqual([UserRole.OWNER, UserRole.SALES]);
    expect(SALES_OPERATOR_ROLES).not.toContain(UserRole.WAREHOUSE);
  });

  it('labels operator roles for receipts', () => {
    expect(USER_ROLE_LABELS[UserRole.OWNER]).toBe('OWNER');
    expect(USER_ROLE_LABELS[UserRole.SALES]).toBe('Master');
  });
});
