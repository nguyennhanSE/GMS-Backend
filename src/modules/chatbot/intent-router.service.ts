import { Injectable } from '@nestjs/common';
import { DayOfWeek } from '@prisma/client';
import {
  CHATBOT_INTENTS,
  CHATBOT_SUPPORTED_TOPICS,
  ChatbotIntentKey,
} from './chatbot.constants';

export interface IntentMatch {
  intentKey: ChatbotIntentKey;
  scheduleFilter?: {
    dayOfWeek?: DayOfWeek;
    date?: string;
    query?: string;
  };
}

@Injectable()
export class IntentRouterService {
  private readonly dayPatterns: Record<DayOfWeek, RegExp> = {
    MON: /\b(monday|mon)\b/i,
    TUE: /\b(tuesday|tue|tues)\b/i,
    WED: /\b(wednesday|wed)\b/i,
    THU: /\b(thursday|thu|thurs)\b/i,
    FRI: /\b(friday|fri)\b/i,
    SAT: /\b(saturday|sat)\b/i,
    SUN: /\b(sunday|sun)\b/i,
  };

  match(message: string): IntentMatch | null {
    const text = message.trim();

    if (!text) {
      return null;
    }

    if (this.isTransactional(text)) {
      return { intentKey: CHATBOT_INTENTS.unsupportedTransactional };
    }

    if (/\b(my bookings|upcoming bookings|my classes|booked classes)\b/i.test(text)) {
      return { intentKey: CHATBOT_INTENTS.bookingUpcoming };
    }

    if (/\b(my membership|current plan|current membership|active membership)\b/i.test(text)) {
      return { intentKey: CHATBOT_INTENTS.membershipActive };
    }

    if (/\b(workout tips?|exercise tips?|workout advice|exercise advice)\b/i.test(text)) {
      return { intentKey: CHATBOT_INTENTS.workoutTips };
    }

    if (/\b(diet tips?|nutrition tips?|diet advice|nutrition advice)\b/i.test(text)) {
      return { intentKey: CHATBOT_INTENTS.dietTips };
    }

    if (/\b(opening hours?|closing hours?|business hours?|what time.*open|what time.*close)\b/i.test(text)) {
      return { intentKey: CHATBOT_INTENTS.faqHours };
    }

    if (/\b(location|address|where.*gym|where are you)\b/i.test(text)) {
      return { intentKey: CHATBOT_INTENTS.faqLocation };
    }

    if (/\b(membership policy|membership rules|renew membership|change plan)\b/i.test(text)) {
      return { intentKey: CHATBOT_INTENTS.faqMembershipPolicy };
    }

    if (/\b(contact support|support team|human support|talk to staff|need help from staff)\b/i.test(text)) {
      return { intentKey: CHATBOT_INTENTS.supportHuman };
    }

    if (this.isScheduleMessage(text)) {
      return {
        intentKey: CHATBOT_INTENTS.scheduleLookup,
        scheduleFilter: {
          dayOfWeek: this.detectDayOfWeek(text),
          date: this.detectRelativeDate(text),
          query: this.extractScheduleQuery(text),
        },
      };
    }

    return null;
  }

  getSupportedTopics(): string[] {
    return [...CHATBOT_SUPPORTED_TOPICS];
  }

  private isTransactional(message: string): boolean {
    return /\b(book|reserve|cancel|checkout|pay|purchase|buy|renew|switch plan)\b/i.test(
      message,
    );
  }

  private isScheduleMessage(message: string): boolean {
    return /\b(schedule|class|classes|session|sessions|today|tomorrow|yoga|pilates|boxing|hiit|zumba|spin)\b/i.test(
      message,
    );
  }

  private detectDayOfWeek(message: string): DayOfWeek | undefined {
    return (Object.entries(this.dayPatterns).find(([, pattern]) =>
      pattern.test(message),
    )?.[0] as DayOfWeek | undefined);
  }

  private detectRelativeDate(message: string): string | undefined {
    const today = new Date();
    const target = new Date(today);

    if (/\btoday\b/i.test(message)) {
      return this.formatDate(target);
    }

    if (/\btomorrow\b/i.test(message)) {
      target.setDate(target.getDate() + 1);
      return this.formatDate(target);
    }

    return undefined;
  }

  private extractScheduleQuery(message: string): string | undefined {
    const cleaned = message
      .replace(/\b(what|when|is|the|class|classes|schedule|for|on|today|tomorrow|time|do|you|have|at)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned || undefined;
  }

  private formatDate(value: Date): string {
    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    const day = `${value.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
