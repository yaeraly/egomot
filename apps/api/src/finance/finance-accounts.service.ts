import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SALES_OPERATOR_ROLES } from '../common/sales-access';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from './dto/payment-method.dto';
import { FinanceSettingsService } from './finance-balance.service';

@Injectable()
export class FinanceAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeSettings: FinanceSettingsService,
  ) {}

  private serialize(method: {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    _count?: { accounts: number; payments: number };
  }) {
    return {
      id: method.id,
      code: method.code,
      name: method.name,
      isActive: method.isActive,
      sortOrder: method.sortOrder,
      accountCount: method._count?.accounts ?? 0,
      paymentCount: method._count?.payments ?? 0,
      createdAt: method.createdAt.toISOString(),
      updatedAt: method.updatedAt.toISOString(),
    };
  }

  async list(active?: string) {
    const where: Prisma.PaymentMethodWhereInput = {};
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;

    const rows = await this.prisma.paymentMethod.findMany({
      where,
      include: {
        _count: { select: { accounts: true, payments: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.serialize(row));
  }

  async get(id: string) {
    const method = await this.prisma.paymentMethod.findUnique({
      where: { id },
      include: {
        _count: { select: { accounts: true, payments: true } },
        accounts: {
          include: {
            user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
          },
          orderBy: [{ user: { name: 'asc' } }],
        },
      },
    });
    if (!method) throw new NotFoundException('Счёт не найден');

    return {
      ...this.serialize(method),
      accounts: method.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        isActive: account.isActive,
        user: account.user,
      })),
    };
  }

  async create(dto: CreatePaymentMethodDto) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.paymentMethod.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException('Счёт с таким кодом уже существует');
    }

    const maxSort = await this.prisma.paymentMethod.aggregate({
      _max: { sortOrder: true },
    });

    const method = await this.prisma.paymentMethod.create({
      data: {
        code,
        name: dto.name.trim(),
        sortOrder: dto.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        isActive: dto.isActive ?? true,
      },
      include: { _count: { select: { accounts: true, payments: true } } },
    });

    if (method.isActive) {
      await this.provisionAccountsForMethod(method.id, method.name);
    }

    return this.serialize(method);
  }

  async update(id: string, dto: UpdatePaymentMethodDto) {
    const method = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundException('Счёт не найден');

    const updated = await this.prisma.paymentMethod.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { _count: { select: { accounts: true, payments: true } } },
    });

    if (dto.isActive === false) {
      await this.prisma.paymentAccount.updateMany({
        where: { paymentMethodId: id },
        data: { isActive: false },
      });
    }

    if (dto.isActive === true) {
      await this.provisionAccountsForMethod(updated.id, updated.name);
      await this.prisma.paymentAccount.updateMany({
        where: { paymentMethodId: id },
        data: { isActive: true },
      });
    }

    if (dto.name !== undefined && dto.name.trim() !== method.name) {
      await this.syncAccountNames(updated.id, updated.name);
    }

    return this.serialize(updated);
  }

  private async provisionAccountsForMethod(paymentMethodId: string, methodName: string) {
    const operators = await this.prisma.user.findMany({
      where: { role: { in: SALES_OPERATOR_ROLES }, isActive: true },
    });
    for (const user of operators) {
      await this.prisma.paymentAccount.upsert({
        where: {
          userId_paymentMethodId: { userId: user.id, paymentMethodId },
        },
        update: { isActive: true },
        create: {
          userId: user.id,
          paymentMethodId,
          name: `${user.name} — ${methodName}`,
          isActive: true,
        },
      });
    }
  }

  private async syncAccountNames(paymentMethodId: string, methodName: string) {
    const accounts = await this.prisma.paymentAccount.findMany({
      where: { paymentMethodId },
      include: { user: { select: { name: true } } },
    });
    for (const account of accounts) {
      await this.prisma.paymentAccount.update({
        where: { id: account.id },
        data: { name: `${account.user.name} — ${methodName}` },
      });
    }
  }
}
