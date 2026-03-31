import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClassBookingModule } from '../class-booking/class-booking.module';
import { ClassScheduleModule } from '../class-schedule/class-schedule.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ChatbotController } from './chatbot.controller';
import { ChatbotMemberDataFacade } from './chatbot-member-data.facade';
import { ChatbotService } from './chatbot.service';
import { CohereClient } from './cohere.client';
import { FaqCatalogService } from './faq-catalog.service';
import { IntentRouterService } from './intent-router.service';

@Module({
  imports: [
    HttpModule,
    ClassScheduleModule,
    ClassBookingModule,
    MembershipsModule,
  ],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    ChatbotMemberDataFacade,
    IntentRouterService,
    FaqCatalogService,
    CohereClient,
    PrismaService,
  ],
})
export class ChatbotModule {}
