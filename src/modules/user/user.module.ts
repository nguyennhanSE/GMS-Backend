import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UserRepository } from './repositories/user.repository';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RolesModule } from '../roles/roles.module';
import { LoggerModule } from '../../libs/logger/logger.module';
import { StorageModule } from '../storage/storage.module';
import { EmailModule } from '../email/email.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    PrismaModule,
    RolesModule,
    LoggerModule,
    StorageModule,
    EmailModule,
    JwtModule,
  ],
  controllers: [UserController],
  providers: [UserService, UserRepository],
  exports: [UserService],
})
export class UserModule {}
