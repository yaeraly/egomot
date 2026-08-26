import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicDecimal } from '../common/decimal.util';
import { dec, roundMoney } from '../purchases/purchase-calc';
import { ClientCategoryService } from './client-category.service';
import {
  buildPriceBreakdown,
  findMatrixMarkup,
  roundMarkup,
} from './pricing-calc';

export interface PriceCalculationResult {
  productId: string;
  clientId: string;
  costPriceKgs: string;
  baseMarkupPercent: string;
  clientMarkupPercent: string;
  finalMarkupPercent: string;
  finalPriceKgs: string;
  clientType: string;
  clientCategory: string;
  paidPurchaseAmount90DaysKgs: string;
  nextCategory: string | null;
  amountRemainingToNextCategoryKgs: string | null;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientCategory: ClientCategoryService,
  ) {}

  async resolveProductCostPrice(productId: string): Promise<Prisma.Decimal> {
    const inventory = await this.prisma.inventory.findUnique({
      where: { productId },
    });
    if (inventory && inventory.averageUnitCostKgs.gt(0)) {
      return inventory.averageUnitCostKgs;
    }
    throw new BadRequestException(
      'Себестоимость товара не определена. Требуется остаток на складе с рассчитанной средней себестоимостью.',
    );
  }

  async calculatePrice(
    productId: string,
    clientId: string,
  ): Promise<PriceCalculationResult> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Товар не найден');

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException('Клиент не найден');

    const costPrice = await this.resolveProductCostPrice(productId);
    const baseMarkup = product.baseMarkupPercent ?? dec(0);

    const snapshot = await this.clientCategory.getClientPricingSnapshot(
      clientId,
      client.clientType,
    );

    const matrix = await this.prisma.clientTypeCategoryMarkup.findMany();
    const clientMarkup = findMatrixMarkup(
      matrix.map((row) => ({
        clientType: row.clientType,
        category: row.category,
        markupPercent: row.markupPercent,
      })),
      client.clientType,
      snapshot.clientCategory,
    );

    const breakdown = buildPriceBreakdown({
      costPriceKgs: costPrice,
      baseMarkupPercent: baseMarkup,
      clientMarkupPercent: clientMarkup,
      clientType: client.clientType,
      clientCategory: snapshot.clientCategory,
    });

    return {
      productId,
      clientId,
      costPriceKgs: publicDecimal(breakdown.costPriceKgs),
      baseMarkupPercent: publicDecimal(breakdown.baseMarkupPercent),
      clientMarkupPercent: publicDecimal(breakdown.clientMarkupPercent),
      finalMarkupPercent: publicDecimal(breakdown.finalMarkupPercent),
      finalPriceKgs: publicDecimal(breakdown.finalPriceKgs),
      clientType: breakdown.clientType,
      clientCategory: breakdown.clientCategory,
      paidPurchaseAmount90DaysKgs: snapshot.paidPurchaseAmount90DaysKgs,
      nextCategory: snapshot.nextCategory,
      amountRemainingToNextCategoryKgs:
        snapshot.amountRemainingToNextCategoryKgs,
    };
  }

  parseBaseMarkup(value?: string | null): Prisma.Decimal | null {
    if (value === undefined || value === null || value === '') return null;
    const n = dec(value);
    if (n.lt(0)) {
      throw new BadRequestException(
        'Базовая наценка не может быть отрицательной',
      );
    }
    return roundMarkup(n);
  }
}
