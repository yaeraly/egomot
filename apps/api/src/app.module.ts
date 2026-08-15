import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { InventoryModule } from './inventory/inventory.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { PurchaseReceiptsModule } from './purchase-receipts/purchase-receipts.module';
import { PurchasesModule } from './purchases/purchases.module';
import { SettingsModule } from './settings/settings.module';
import { SuppliersModule } from './suppliers/suppliers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    SuppliersModule,
    PurchasesModule,
    PurchaseReceiptsModule,
    InventoryModule,
    DashboardModule,
    SettingsModule,
  ],
})
export class AppModule {}
