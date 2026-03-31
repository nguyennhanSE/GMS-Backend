import { Injectable } from '@nestjs/common';
import {
  CHATBOT_INTENTS,
  CHATBOT_LINKED_ACTIONS,
  CHATBOT_SUPPORTED_TOPICS,
  ChatbotIntentKey,
} from './chatbot.constants';

interface FaqAnswer {
  text: string;
  linkedActions?: string[];
  handoffSuggested?: boolean;
}

@Injectable()
export class FaqCatalogService {
  getAnswer(intentKey: ChatbotIntentKey): FaqAnswer | null {
    switch (intentKey) {
      case CHATBOT_INTENTS.faqHours:
        return {
          text:
            'Gym operating hours are not configured in this environment. Please contact support or the front desk for the latest hours.',
          linkedActions: [CHATBOT_LINKED_ACTIONS.support],
          handoffSuggested: true,
        };
      case CHATBOT_INTENTS.faqLocation:
        return {
          text:
            'Gym location details are not configured in this environment. Please contact support for the latest branch information.',
          linkedActions: [CHATBOT_LINKED_ACTIONS.support],
          handoffSuggested: true,
        };
      case CHATBOT_INTENTS.faqMembershipPolicy:
        return {
          text:
            'For plan changes, renewals, or cancellations, please use the membership page or contact support. I can also show your current membership details.',
          linkedActions: [
            CHATBOT_LINKED_ACTIONS.membership,
            CHATBOT_LINKED_ACTIONS.support,
          ],
          handoffSuggested: true,
        };
      case CHATBOT_INTENTS.workoutTips:
        return {
          text:
            'A simple workout starter: focus on consistent full-body sessions, progressive overload, and rest between training days. If you are unsure about technique, ask a trainer before increasing weight.',
        };
      case CHATBOT_INTENTS.dietTips:
        return {
          text:
            'A simple nutrition starter: keep protein intake consistent, prioritize whole foods, and match calories to your goal. For medical or strict dietary needs, please consult a qualified professional.',
        };
      case CHATBOT_INTENTS.supportHuman:
        return {
          text:
            'I can hand this off to support. Please use the support form if you need help from staff.',
          linkedActions: [CHATBOT_LINKED_ACTIONS.support],
          handoffSuggested: true,
        };
      case CHATBOT_INTENTS.unsupportedTransactional:
        return {
          text:
            'I can explain the next step, but I cannot perform bookings, cancellations, or purchases in chat. Please use the relevant page in the app.',
          linkedActions: [
            CHATBOT_LINKED_ACTIONS.booking,
            CHATBOT_LINKED_ACTIONS.membership,
            CHATBOT_LINKED_ACTIONS.support,
          ],
          handoffSuggested: true,
        };
      default:
        return null;
    }
  }

  getSupportedTopics(): string[] {
    return [...CHATBOT_SUPPORTED_TOPICS];
  }

  getIntentCatalog(): Record<string, string> {
    return {
      [CHATBOT_INTENTS.faqHours]:
        'Use only when the user asks about opening hours or closing hours.',
      [CHATBOT_INTENTS.faqLocation]:
        'Use only when the user asks where the gym is located or asks for the address.',
      [CHATBOT_INTENTS.faqMembershipPolicy]:
        'Use only when the user asks about membership policy, renewals, plan changes, or cancellations in a policy sense.',
      [CHATBOT_INTENTS.scheduleLookup]:
        'Use when the user asks about class schedules, times, dates, or specific classes.',
      [CHATBOT_INTENTS.bookingUpcoming]:
        'Use when the user asks about their own bookings or upcoming booked classes.',
      [CHATBOT_INTENTS.membershipActive]:
        'Use when the user asks about their current or active membership.',
      [CHATBOT_INTENTS.workoutTips]:
        'Use when the user asks for generic workout advice.',
      [CHATBOT_INTENTS.dietTips]:
        'Use when the user asks for generic diet or nutrition advice.',
      [CHATBOT_INTENTS.supportHuman]:
        'Use when the user explicitly wants staff or human support.',
      [CHATBOT_INTENTS.unsupportedTransactional]:
        'Use when the user asks the chatbot to execute a booking, cancellation, or purchase action.',
    };
  }
}
