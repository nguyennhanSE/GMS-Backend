import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from 'prisma/prisma.module';
import { LoggerModule } from 'src/libs/logger/logger.module';
import { UserModule } from '../user/user.module';
import { RolesModule } from '../roles/roles.module';
import { AuthRepository } from './repositories/auth.repository';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [JwtModule, PrismaModule, LoggerModule, UserModule, RolesModule, HttpModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
})
export class AuthModule {}
