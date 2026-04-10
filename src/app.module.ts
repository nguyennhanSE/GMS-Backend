import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { GuardModule } from './guard/guard.module';
import { LoggerModule } from './libs/logger/logger.module';
import { RolesModule } from './modules/roles/roles.module';
import { RolesGuard } from './guard/role.guard';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { AuthGuard } from './guard/auth.guard';
import { EmailModule } from './modules/email/email.module';
import { AllExceptionsFilter } from './libs/filter/exception.filter';
import { ClassScheduleModule } from './modules/class-schedule/class-schedule.module';
import { ClassBookingModule } from './modules/class-booking/class-booking.module';
import { TrainerModule } from './modules/trainer/trainer.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { PaymentModule } from './modules/payment/payment.module';
import { SupportModule } from './modules/support/support.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { NotificationModule } from './modules/notification/notification.module';
import { WorkoutModule } from './modules/workout/workout.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { DietModule } from './modules/diet/diet.module';
import { AppCacheModule } from './libs/cache/cache.module';
import { TrainerBookingModule } from './modules/trainer-booking/trainer-booking.module';
import { TrainerMessagingModule } from './modules/trainer-messaging/trainer-messaging.module';

@Module({
  imports: [
    AppCacheModule,
    ScheduleModule.forRoot(), // Enable scheduled tasks (cron jobs)
    EventEmitterModule.forRoot(), // Enable cross-module event communication
    UserModule,
    AuthModule,
    GuardModule,
    LoggerModule,
    RolesModule,
    EmailModule,
    ClassScheduleModule,
    ClassBookingModule,
    TrainerModule,
    MembershipsModule,
    PaymentModule,
    SupportModule,
    ReportingModule,
    NotificationModule,
    WorkoutModule,
    ChatbotModule,
    DietModule,
    TrainerBookingModule,
    TrainerMessagingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
