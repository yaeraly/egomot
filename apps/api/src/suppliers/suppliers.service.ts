import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(search?: string, active?: string) {
    const where: Prisma.SupplierWhereInput = {};
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { wechat: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.supplier.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async get(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Поставщик не найден');
    return supplier;
  }

  async create(dto: CreateSupplierDto) {
    return this.prisma.supplier.create({
      data: {
        name: dto.name.trim(),
        companyName: dto.companyName?.trim() || null,
        phone: dto.phone.trim(),
        wechat: dto.wechat?.trim() || null,
        address: dto.address?.trim() || null,
        city: dto.city?.trim() || null,
        notes: dto.notes?.trim() || null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateSupplierDto) {
    await this.get(id);
    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.companyName !== undefined ? { companyName: dto.companyName?.trim() || null } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
        ...(dto.wechat !== undefined ? { wechat: dto.wechat?.trim() || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
        ...(dto.city !== undefined ? { city: dto.city?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }
}
