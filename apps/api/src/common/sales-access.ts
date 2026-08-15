import { UserRole } from '@prisma/client';

/** Roles allowed to create/confirm sales and receive payments. */
export const SALES_OPERATOR_ROLES: UserRole[] = [UserRole.OWNER, UserRole.SALES];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.OWNER]: 'OWNER',
  [UserRole.SALES]: 'Master',
  [UserRole.WAREHOUSE]: 'Warehouse',
};
