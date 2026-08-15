import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceSettingsService } from '../finance/finance-balance.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const MANAGED_ROLES: UserRole[] = [UserRole.SALES, UserRole.WAREHOUSE];

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeSettings: FinanceSettingsService,
  ) {}

  private serialize(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async list(search?: string, active?: string) {
    const where: {
      OR?: Array<Record<string, unknown>>;
      isActive?: boolean;
    } = {};
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.serialize(row));
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return this.serialize(user);
  }

  async create(dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Пользователь с таким email уже существует');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash,
        role: dto.role,
        isActive: dto.isActive ?? true,
      },
    });

    if (user.isActive && MANAGED_ROLES.includes(user.role)) {
      await this.financeSettings.ensureUserAccounts(user.id, user.name);
    }

    return this.serialize(user);
  }

  async update(actor: User, id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Пользователь не найден');

    if (user.role === UserRole.OWNER && dto.role !== undefined) {
      throw new BadRequestException('Роль владельца нельзя изменить');
    }

    if (dto.isActive === false) {
      if (user.id === actor.id) {
        throw new BadRequestException('Нельзя деактивировать свой аккаунт');
      }
      if (user.role === UserRole.OWNER) {
        const activeOwners = await this.prisma.user.count({
          where: { role: UserRole.OWNER, isActive: true, NOT: { id } },
        });
        if (activeOwners === 0) {
          throw new BadRequestException('Нельзя деактивировать последнего владельца');
        }
      }
    }

    const data: {
      email?: string;
      name?: string;
      passwordHash?: string;
      role?: UserRole;
      isActive?: boolean;
    } = {};

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== user.email) {
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) {
          throw new ConflictException('Пользователь с таким email уже существует');
        }
      }
      data.email = email;
    }
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    if (dto.role !== undefined && user.role !== UserRole.OWNER) {
      data.role = dto.role;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.user.update({ where: { id }, data });

    if (updated.isActive && MANAGED_ROLES.includes(updated.role)) {
      await this.financeSettings.ensureUserAccounts(updated.id, updated.name);
    }

    return this.serialize(updated);
  }
}
