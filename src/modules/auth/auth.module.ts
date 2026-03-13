import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from 'prisma/prisma.module';
import { LoggerModule } from 'src/libs/logger/logger.module';
import { UserModule } from '../user/user.module';
import { RolesModule } from '../roles/roles.module';
import { AuthRepository } from './repositories/auth.repository';
import { UserBannedListener } from './listeners/user-banned.listener';

@Module({
  imports: [JwtModule, PrismaModule, LoggerModule, UserModule, RolesModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, UserBannedListener],
})
export class AuthModule {}
