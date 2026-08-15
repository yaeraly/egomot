import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { publicDecimal } from '../common/decimal.util';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private serializeInventory(row: Record<string, unknown>) {
    return {
      ...row,
      quantity: publicDecimal(row.quantity as Prisma.Decimal),
      averageUnitCostKgs: publicDecimal(row.averageUnitCostKgs as Prisma.Decimal),
      totalValueKgs: publicDecimal(row.totalValueKgs as Prisma.Decimal),
    };
  }

  private serializeMovement(row: Record<string, unknown>) {
    return {
      ...row,
      quantity: publicDecimal(row.quantity as Prisma.Decimal),
      previousQuantity: publicDecimal(row.previousQuantity as Prisma.Decimal),
      newQuantity: publicDecimal(row.newQuantity as Prisma.Decimal),
      unitCost: publicDecimal(row.unitCost as Prisma.Decimal),
      totalCost: publicDecimal(row.totalCost as Prisma.Decimal),
    };
  }

  async listStock(search?: string) {
    const where: Prisma.InventoryWhereInput = {};
    if (search?.trim()) {
      const q = search.trim();
      where.product = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const rows = await this.prisma.inventory.findMany({
      where,
      include: { product: { include: { category: true } } },
      orderBy: { product: { name: 'asc' } },
    });

    return rows.map((row) => this.serializeInventory(row as unknown as Record<string, unknown>));
  }

  async listMovements(productId?: string, referenceId?: string) {
    const where: Prisma.InventoryMovementWhereInput = {};
    if (productId) where.productId = productId;
    if (referenceId) where.referenceId = referenceId;

    const rows = await this.prisma.inventoryMovement.findMany({
      where,
      include: {
        product: { include: { category: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return rows.map((row) => this.serializeMovement(row as unknown as Record<string, unknown>));
  }
}
