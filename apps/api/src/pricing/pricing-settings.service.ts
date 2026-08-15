import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ClientPricingCategory,
  ClientType,
  Prisma,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicDecimal } from '../common/decimal.util';
import { dec, roundMoney } from '../purchases/purchase-calc';
import {
  CategoryThresholdInput,
  PricingValidationError,
  roundMarkup,
  validateCategoryThresholds,
} from './pricing-calc';
import {
  UpdateCategoryThresholdDto,
  UpdateMarkupMatrixDto,
} from './dto/pricing-settings.dto';

const PRICING_AUDIT = {
  THRESHOLD_UPDATED: 'PRICING_THRESHOLD_UPDATED',
  MARKUP_UPDATED: 'PRICING_MARKUP_UPDATED',
} as const;

const ALL_CLIENT_TYPES: ClientType[] = [
  ClientType.RETAIL,
  ClientType.MASTER,
  ClientType.WHOLESALE,
];

const ALL_CATEGORIES: ClientPricingCategory[] = [
  ClientPricingCategory.STANDARD,
  ClientPricingCategory.SILVER,
  ClientPricingCategory.GOLD,
  ClientPricingCategory.VIP,
];

@Injectable()
export class PricingSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private serializeThreshold(row: {
    id: string;
    category: ClientPricingCategory;
    minPaidAmountKgs: Prisma.Decimal;
    maxPaidAmountKgs: Prisma.Decimal | null;
    priority: number;
    isActive: boolean;
  }) {
    return {
      ...row,
      minPaidAmountKgs: publicDecimal(row.minPaidAmountKgs),
      maxPaidAmountKgs: row.maxPaidAmountKgs
        ? publicDecimal(row.maxPaidAmountKgs)
        : null,
    };
  }

  private serializeMarkup(row: {
    id: string;
    clientType: ClientType;
    category: ClientPricingCategory;
    markupPercent: Prisma.Decimal;
  }) {
    return {
      ...row,
      markupPercent: publicDecimal(row.markupPercent),
    };
  }

  async getSettings() {
    const [thresholds, matrix] = await Promise.all([
      this.prisma.clientCategoryThreshold.findMany({
        orderBy: [{ priority: 'asc' }, { minPaidAmountKgs: 'asc' }],
      }),
      this.prisma.clientTypeCategoryMarkup.findMany({
        orderBy: [{ clientType: 'asc' }, { category: 'asc' }],
      }),
    ]);

    return {
      thresholds: thresholds.map((row) => this.serializeThreshold(row)),
      markupMatrix: matrix.map((row) => this.serializeMarkup(row)),
    };
  }

  async updateThresholds(user: User, items: UpdateCategoryThresholdDto[]) {
    if (!items.length) {
      throw new BadRequestException('Не переданы пороги категорий');
    }

    const existing = await this.prisma.clientCategoryThreshold.findMany();
    const merged = existing.map((row) => {
      const patch = items.find((item) => item.category === row.category);
      if (!patch) {
        return {
          category: row.category,
          minPaidAmountKgs: row.minPaidAmountKgs,
          maxPaidAmountKgs: row.maxPaidAmountKgs,
          priority: row.priority,
          isActive: row.isActive,
        } satisfies CategoryThresholdInput;
      }
      return {
        category: row.category,
        minPaidAmountKgs:
          patch.minPaidAmountKgs !== undefined
            ? roundMoney(patch.minPaidAmountKgs)
            : row.minPaidAmountKgs,
        maxPaidAmountKgs:
          patch.maxPaidAmountKgs !== undefined
            ? patch.maxPaidAmountKgs === null || patch.maxPaidAmountKgs === ''
              ? null
              : roundMoney(patch.maxPaidAmountKgs)
            : row.maxPaidAmountKgs,
        priority: patch.priority ?? row.priority,
        isActive: patch.isActive ?? row.isActive,
      } satisfies CategoryThresholdInput;
    });

    try {
      validateCategoryThresholds(merged);
    } catch (error) {
      if (error instanceof PricingValidationError) {
        throw new BadRequestException(error.messages.join('; '));
      }
      throw error;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = [];
      for (const patch of items) {
        const before = existing.find((row) => row.category === patch.category);
        if (!before) continue;

        const data: Prisma.ClientCategoryThresholdUpdateInput = {};
        if (patch.minPaidAmountKgs !== undefined) {
          data.minPaidAmountKgs = roundMoney(patch.minPaidAmountKgs);
        }
        if (patch.maxPaidAmountKgs !== undefined) {
          data.maxPaidAmountKgs =
            patch.maxPaidAmountKgs === null || patch.maxPaidAmountKgs === ''
              ? null
              : roundMoney(patch.maxPaidAmountKgs);
        }
        if (patch.priority !== undefined) data.priority = patch.priority;
        if (patch.isActive !== undefined) data.isActive = patch.isActive;

        const row = await tx.clientCategoryThreshold.update({
          where: { category: patch.category },
          data,
        });
        updated.push(row);

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: PRICING_AUDIT.THRESHOLD_UPDATED,
            entityType: 'ClientCategoryThreshold',
            entityId: row.id,
            oldValue: {
              category: before.category,
              minPaidAmountKgs: publicDecimal(before.minPaidAmountKgs),
              maxPaidAmountKgs: before.maxPaidAmountKgs
                ? publicDecimal(before.maxPaidAmountKgs)
                : null,
              priority: before.priority,
              isActive: before.isActive,
            },
            newValue: {
              category: row.category,
              minPaidAmountKgs: publicDecimal(row.minPaidAmountKgs),
              maxPaidAmountKgs: row.maxPaidAmountKgs
                ? publicDecimal(row.maxPaidAmountKgs)
                : null,
              priority: row.priority,
              isActive: row.isActive,
            },
          },
        });
      }
      return updated.map((row) => this.serializeThreshold(row));
    });
  }

  async updateMarkupMatrix(user: User, items: UpdateMarkupMatrixDto[]) {
    if (!items.length) {
      throw new BadRequestException('Не передана матрица наценок');
    }

    for (const item of items) {
      if (!ALL_CLIENT_TYPES.includes(item.clientType)) {
        throw new BadRequestException(
          `Недопустимый тип клиента: ${item.clientType}`,
        );
      }
      if (!ALL_CATEGORIES.includes(item.category)) {
        throw new BadRequestException(
          `Недопустимая категория клиента: ${item.category}`,
        );
      }
      const markup = dec(item.markupPercent);
      if (markup.lt(0)) {
        throw new BadRequestException('Наценка не может быть отрицательной');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = [];
      for (const item of items) {
        const before = await tx.clientTypeCategoryMarkup.findUnique({
          where: {
            clientType_category: {
              clientType: item.clientType,
              category: item.category,
            },
          },
        });
        if (!before) continue;

        const row = await tx.clientTypeCategoryMarkup.update({
          where: {
            clientType_category: {
              clientType: item.clientType,
              category: item.category,
            },
          },
          data: { markupPercent: roundMarkup(item.markupPercent) },
        });
        updated.push(row);

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: PRICING_AUDIT.MARKUP_UPDATED,
            entityType: 'ClientTypeCategoryMarkup',
            entityId: row.id,
            oldValue: {
              clientType: before.clientType,
              category: before.category,
              markupPercent: publicDecimal(before.markupPercent),
            },
            newValue: {
              clientType: row.clientType,
              category: row.category,
              markupPercent: publicDecimal(row.markupPercent),
            },
          },
        });
      }
      return updated.map((row) => this.serializeMarkup(row));
    });
  }

  async auditLogs(limit = 50) {
    return this.prisma.auditLog.findMany({
      where: {
        action: {
          in: [PRICING_AUDIT.THRESHOLD_UPDATED, PRICING_AUDIT.MARKUP_UPDATED],
        },
      },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
