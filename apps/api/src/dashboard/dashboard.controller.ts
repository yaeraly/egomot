import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('dashboard')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER)
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  async summary() {
    const [products, suppliers, purchases, recent, byStatus] = await Promise.all([
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.supplier.count({ where: { isActive: true } }),
      this.prisma.purchase.count(),
      this.prisma.purchase.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: { supplier: true },
      }),
      this.prisma.purchase.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    return {
      products,
      suppliers,
      purchases,
      statusCounts: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      recentPurchases: recent.map((p) => ({
        id: p.id,
        number: p.number,
        status: p.status,
        supplierName: p.supplier.name,
        totalPurchaseCny: p.totalPurchaseCny.toFixed(2),
        estimatedTotalLandedCostKgs: p.estimatedTotalLandedCostKgs.toFixed(2),
        createdAt: p.createdAt,
      })),
    };
  }
}
