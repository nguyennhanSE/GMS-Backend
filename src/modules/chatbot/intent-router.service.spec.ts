import { CHATBOT_INTENTS } from './chatbot.constants';
import { IntentRouterService } from './intent-router.service';

describe('IntentRouterService', () => {
  let service: IntentRouterService;

  beforeEach(() => {
    service = new IntentRouterService();
  });

  it('matches transactional requests as unsupported chatbot actions', () => {
    const result = service.match('Can you cancel my booking for tomorrow?');

    expect(result).toEqual({
      intentKey: CHATBOT_INTENTS.unsupportedTransactional,
    });
  });

  it('matches schedule questions and extracts day and class query', () => {
    const result = service.match('Do you have API Integration Test classes on monday?');

    expect(result).toEqual({
      intentKey: CHATBOT_INTENTS.scheduleLookup,
      scheduleFilter: {
        dayOfWeek: 'MON',
        date: undefined,
        query: 'API Integration Test monday?',
      },
    });
  });

  it('matches explicit support requests', () => {
    const result = service.match('I need help from staff');

    expect(result).toEqual({
      intentKey: CHATBOT_INTENTS.supportHuman,
    });
  });
});
