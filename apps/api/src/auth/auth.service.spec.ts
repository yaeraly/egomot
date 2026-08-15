import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };
  const jwt = {
    signAsync: jest.fn(),
  };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);
  });

  it('normalizes email before lookup', () => {
    expect(service.normalizeEmail('  Owner@Egomot.Local ')).toBe('owner@egomot.local');
  });

  it('returns JWT for valid credentials', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'owner@egomot.local',
      name: 'Владелец',
      role: 'OWNER',
      isActive: true,
      passwordHash: await bcrypt.hash('Owner123!', 10),
    });
    jwt.signAsync.mockResolvedValue('token-123');

    const result = await service.login({
      email: 'owner@egomot.local',
      password: 'Owner123!',
    });

    expect(result.accessToken).toBe('token-123');
    expect(result.user.role).toBe('OWNER');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'owner@egomot.local' },
    });
  });

  it('rejects invalid password with 401 message', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'owner@egomot.local',
      name: 'Владелец',
      role: 'OWNER',
      isActive: true,
      passwordHash: await bcrypt.hash('Owner123!', 10),
    });

    await expect(
      service.login({ email: 'owner@egomot.local', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects deactivated account', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'master@egomot.local',
      name: 'Master',
      role: 'SALES',
      isActive: false,
      passwordHash: await bcrypt.hash('Owner123!', 10),
    });

    await expect(
      service.login({ email: 'master@egomot.local', password: 'Owner123!' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects unknown email with 401 message', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({ email: 'owner@egomot.local', password: 'Owner123!' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
