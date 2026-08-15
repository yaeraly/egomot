import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClientCategoryService } from '../pricing/client-category.service';
import { ClientDebtService } from '../sales/client-debt.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  RETAIL: 'Розничный',
  MASTER: 'Мастер',
  WHOLESALE: 'Оптовый',
};

const CATEGORY_LABELS = {
  STANDARD: 'Standard',
  SILVER: 'Silver',
  GOLD: 'Gold',
  VIP: 'VIP',
} as const;

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientCategory: ClientCategoryService,
    private readonly clientDebt: ClientDebtService,
  ) {}

  async list(search?: string, active?: string) {
    const where: Prisma.ClientWhereInput = {};
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.client.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async get(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Клиент не найден');
    return client;
  }

  async getCard(id: string) {
    const client = await this.get(id);
    const pricing = await this.clientCategory.getClientPricingSnapshot(
      client.id,
      client.clientType,
    );
    const debt = await this.clientDebt.getDebtSummary(client.id);

    return {
      client,
      pricing: {
        ...pricing,
        clientTypeLabel: CLIENT_TYPE_LABELS[client.clientType],
        clientCategoryLabel: CATEGORY_LABELS[pricing.clientCategory],
        nextCategoryLabel: pricing.nextCategory
          ? CATEGORY_LABELS[pricing.nextCategory]
          : null,
      },
      debt,
    };
  }

  async getDebt(id: string) {
    await this.get(id);
    return this.clientDebt.getDebtSummary(id);
  }

  private validateClientType(clientType?: ClientType) {
    if (clientType && !Object.values(ClientType).includes(clientType)) {
      throw new BadRequestException('Недопустимый тип клиента');
    }
  }

  async create(dto: CreateClientDto) {
    this.validateClientType(dto.clientType);
    return this.prisma.client.create({
      data: {
        name: dto.name.trim(),
        companyName: dto.companyName?.trim() || null,
        phone: dto.phone.trim(),
        email: dto.email?.trim() || null,
        address: dto.address?.trim() || null,
        city: dto.city?.trim() || null,
        notes: dto.notes?.trim() || null,
        clientType: dto.clientType ?? ClientType.RETAIL,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateClientDto) {
    await this.get(id);
    this.validateClientType(dto.clientType);
    return this.prisma.client.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.companyName !== undefined
          ? { companyName: dto.companyName?.trim() || null }
          : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
        ...(dto.email !== undefined
          ? { email: dto.email?.trim() || null }
          : {}),
        ...(dto.address !== undefined
          ? { address: dto.address?.trim() || null }
          : {}),
        ...(dto.city !== undefined ? { city: dto.city?.trim() || null } : {}),
        ...(dto.notes !== undefined
          ? { notes: dto.notes?.trim() || null }
          : {}),
        ...(dto.clientType !== undefined ? { clientType: dto.clientType } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }
}
