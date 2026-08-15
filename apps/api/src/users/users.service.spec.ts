import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceSettingsService } from '../finance/finance-balance.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const prisma = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };
  const financeSettings = { ensureUserAccounts: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: FinanceSettingsService, useValue: financeSettings },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('creates sales user and provisions payment accounts', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'u1',
      email: 'sales@test.local',
      name: 'Master',
      role: UserRole.SALES,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const user = await service.create({
      email: 'sales@test.local',
      name: 'Master',
      password: 'Secret123',
      role: UserRole.SALES,
    });

    expect(user.role).toBe(UserRole.SALES);
    expect(financeSettings.ensureUserAccounts).toHaveBeenCalledWith('u1', 'Master');
  });

  it('rejects deactivating the last owner', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'owner-1',
      email: 'owner@test.local',
      name: 'Owner',
      role: UserRole.OWNER,
      isActive: true,
    });
    prisma.user.count.mockResolvedValue(0);

    await expect(
      service.update(
        { id: 'actor', role: UserRole.OWNER } as never,
        'owner-1',
        { isActive: false },
      ),
    ).rejects.toThrow('последнего владельца');
  });
});
