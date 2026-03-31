import { config } from '../../libs/config';

export const CHATBOT_SESSION_TTL_HOURS = config.CHATBOT_SESSION_TTL_HOURS;
export const CHATBOT_CONTEXT_PAIRS = config.CHATBOT_CONTEXT_PAIRS;
export const CHATBOT_SESSION_TTL_MS = CHATBOT_SESSION_TTL_HOURS * 60 * 60 * 1000;

export const CHATBOT_LINKED_ACTIONS = {
  booking: 'open_booking_page',
  membership: 'open_membership_page',
  support: 'open_support_feedback',
} as const;

export const CHATBOT_SUPPORTED_TOPICS = [
  'Class schedules',
  'My bookings',
  'My membership',
  'Workout tips',
  'Diet tips',
  'Support',
] as const;

export const CHATBOT_INTENTS = {
  faqHours: 'faq.hours',
  faqLocation: 'faq.location',
  faqMembershipPolicy: 'faq.membership_policy',
  scheduleLookup: 'schedule.class_lookup',
  bookingUpcoming: 'booking.my_upcoming',
  membershipActive: 'membership.my_active',
  workoutTips: 'tips.workout_generic',
  dietTips: 'tips.diet_generic',
  supportHuman: 'support.human',
  unsupportedTransactional: 'unsupported.transactional',
} as const;

export type ChatbotIntentKey =
  (typeof CHATBOT_INTENTS)[keyof typeof CHATBOT_INTENTS];
