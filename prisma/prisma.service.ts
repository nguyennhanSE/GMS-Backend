
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../src/libs/config';
// Import from source generated folder - will be copied as-is to dist
import { PrismaClient } from '@prisma/client';

function resolveConnectionString() {
  return process.env.PLAYWRIGHT_DATABASE_URL?.trim() || config.DATABASE_URL;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const connectionString = resolveConnectionString();
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
