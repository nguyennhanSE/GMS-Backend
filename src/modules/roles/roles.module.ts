import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { RolesRepository } from './repositories/roles.repository';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LoggerModule } from '../../libs/logger/logger.module';

@Module({
  imports: [PrismaModule, LoggerModule],
  controllers: [RolesController],
  providers: [RolesService, RolesRepository],
  exports: [RolesService, RolesRepository],
})
export class RolesModule {}
