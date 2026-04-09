import { Injectable } from '@nestjs/common';
import { DayOfWeek } from '@prisma/client';
import { ClassBookingService } from '../class-booking/class-booking.service';
import { ClassScheduleService } from '../class-schedule/class-schedule.service';
import { getDaysOfWeek } from '../class-schedule/entities/class-schedule.entity';
import { MembershipsService } from '../memberships/memberships.service';
import {
  CHATBOT_LINKED_ACTIONS,
  CHATBOT_SUPPORTED_TOPICS,
} from './chatbot.constants';

interface ChatbotAnswer {
  text: string;
  linkedActions?: string[];
  handoffSuggested?: boolean;
  suggestedTopics?: string[];
}

@Injectable()
export class ChatbotMemberDataFacade {
  constructor(
    private readonly classScheduleService: ClassScheduleService,
    private readonly classBookingService: ClassBookingService,
    private readonly membershipsService: MembershipsService,
  ) {}

  async getScheduleAnswer(
    filter: { dayOfWeek?: DayOfWeek; date?: string; query?: string } | undefined,
  ): Promise<ChatbotAnswer> {
    const schedules = await this.classScheduleService.findAll(
      {
        page: 1,
        limit: 5,
        sort: 'asc',
        sortBy: 'createdAt',
      },
      {
        q: filter?.query,
        searchField: filter?.query ? 'className' : undefined,
        dayOfWeek: filter?.dayOfWeek,
        isActive: true,
      },
      { counted: true },
      filter?.date ? new Date(`${filter.date}T12:00:00Z`) : undefined,
    );

    if (schedules.docs.length === 0) {
      return {
        text: 'I could not find any matching active class schedules right now.',
        linkedActions: [CHATBOT_LINKED_ACTIONS.booking, CHATBOT_LINKED_ACTIONS.support],
        handoffSuggested: true,
        suggestedTopics: [...CHATBOT_SUPPORTED_TOPICS],
      };
    }

    const lines = schedules.docs.slice(0, 5).map((schedule) => {
      const className = schedule.gymClass?.className ?? 'Class';
      const days = getDaysOfWeek(schedule).join(', ') || 'Schedule unavailable';
      const occurrence = schedule.occurrence;
      const startTime = (
        occurrence?.effectiveStartTime ?? schedule.startTime
      ).toISOString().slice(11, 16);
      const endTime = (
        occurrence?.effectiveEndTime ?? schedule.endTime
      ).toISOString().slice(11, 16);
      const location = schedule.location ? ` at ${schedule.location}` : '';
      const occurrenceDate = occurrence?.date.toISOString().split('T')[0];
      const occurrenceLabel =
        occurrence?.status === 'cancelled'
          ? ` [cancelled on ${occurrenceDate}]`
          : occurrence?.status === 'rescheduled'
            ? ` [rescheduled on ${occurrenceDate}]`
            : '';
      return `- ${className}: ${days}, ${startTime}-${endTime}${location}${occurrenceLabel}`;
    });

    return {
      text: `Here are the matching class schedules:\n${lines.join('\n')}`,
      linkedActions: [CHATBOT_LINKED_ACTIONS.booking],
      suggestedTopics: [...CHATBOT_SUPPORTED_TOPICS],
    };
  }

  async getBookingsAnswer(memberId: string): Promise<ChatbotAnswer> {
    const bookings = await this.classBookingService.findByUserId(memberId);

    if (bookings.length === 0) {
      return {
        text: 'You do not have any bookings yet.',
        linkedActions: [CHATBOT_LINKED_ACTIONS.booking],
        suggestedTopics: [...CHATBOT_SUPPORTED_TOPICS],
      };
    }

    const lines = bookings.slice(0, 5).map((booking) => {
      const className = booking.classSchedule?.gymClass?.className ?? 'Class';
      const startDate = booking.bookingStartDate.toISOString().split('T')[0];
      return `- ${className} on ${startDate} (${booking.status})`;
    });

    return {
      text: `Here are your upcoming bookings:\n${lines.join('\n')}`,
      linkedActions: [CHATBOT_LINKED_ACTIONS.booking],
      suggestedTopics: [...CHATBOT_SUPPORTED_TOPICS],
    };
  }

  async getMembershipAnswer(memberId: string): Promise<ChatbotAnswer> {
    const membership = await this.membershipsService.findMyMembership(memberId);

    if (!membership) {
      return {
        text: 'You do not have an active membership right now.',
        linkedActions: [
          CHATBOT_LINKED_ACTIONS.membership,
          CHATBOT_LINKED_ACTIONS.support,
        ],
        handoffSuggested: true,
        suggestedTopics: [...CHATBOT_SUPPORTED_TOPICS],
      };
    }

    const endDate = membership.endDate.toISOString().split('T')[0];

    return {
      text:
        `Your active membership is ${membership.membershipName} ` +
        `(level: ${membership.level}) and it is valid until ${endDate}.`,
      linkedActions: [CHATBOT_LINKED_ACTIONS.membership],
      suggestedTopics: [...CHATBOT_SUPPORTED_TOPICS],
    };
  }
}
