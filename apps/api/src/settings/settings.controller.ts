import { BadRequestException, Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import type { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/settings.dto';

@Controller('settings')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER)
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  me(@CurrentUser() user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  @Patch()
  async update(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    const data: { name?: string; passwordHash?: string } = {};
    if (dto.name?.trim()) data.name = dto.name.trim();
    if (dto.newPassword) {
      if (!dto.currentPassword) {
        throw new BadRequestException('Укажите текущий пароль');
      }
      const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!ok) throw new BadRequestException('Неверный текущий пароль');
      data.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data,
    });
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
    };
  }
}
