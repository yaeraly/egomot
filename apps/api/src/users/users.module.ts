import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [FinanceModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
