import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DB_AUTH_HELP } from './db-auth-help';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    try {
      await this.$connect();
    } catch (error) {
      const code = (error as { errorCode?: string }).errorCode;
      const message = error instanceof Error ? error.message : String(error);
      if (
        code === 'P1000' ||
        code === 'P1001' ||
        /Authentication failed against database server/i.test(message) ||
        /Can't reach database server/i.test(message)
      ) {
        // eslint-disable-next-line no-console
        console.error(DB_AUTH_HELP);
      }
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
