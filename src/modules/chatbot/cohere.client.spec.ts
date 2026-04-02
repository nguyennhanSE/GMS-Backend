import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { config } from '../../libs/config';
import { CHATBOT_INTENTS } from './chatbot.constants';
import { CohereClient } from './cohere.client';

describe('CohereClient', () => {
  let client: CohereClient;
  let httpService: { post: jest.Mock };
  let originalEnabled: boolean;
  let originalApiKey: string;

  beforeEach(() => {
    httpService = {
      post: jest.fn(),
    };
    client = new CohereClient(httpService as unknown as HttpService);
    originalEnabled = config.CHATBOT_COHERE_ENABLED;
    originalApiKey = config.COHERE_API_KEY;
  });

  afterEach(() => {
    config.CHATBOT_COHERE_ENABLED = originalEnabled;
    config.COHERE_API_KEY = originalApiKey;
    jest.clearAllMocks();
  });

  it('does not call Cohere when the provider is disabled', async () => {
    config.CHATBOT_COHERE_ENABLED = false;
    config.COHERE_API_KEY = '';

    const result = await client.classifyMessage(
      'Where is the gym?',
      [],
      { [CHATBOT_INTENTS.faqLocation]: 'location help' },
    );

    expect(result).toBeNull();
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('sends only the recent conversation window to Cohere and parses JSON', async () => {
    config.CHATBOT_COHERE_ENABLED = true;
    config.COHERE_API_KEY = 'cohere-test-key';

    httpService.post.mockReturnValue(
      of({
        data: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  intentKey: CHATBOT_INTENTS.faqLocation,
                  answer: 'The gym is on test street.',
                }),
              },
            ],
          },
        },
      }),
    );

    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? ('USER' as const) : ('ASSISTANT' as const),
      content: `message-${`${index}`.padStart(2, '0')}`,
    }));

    const result = await client.classifyMessage(
      'Where is the gym?',
      history,
      { [CHATBOT_INTENTS.faqLocation]: 'location help' },
    );

    expect(result).toEqual({
      intentKey: CHATBOT_INTENTS.faqLocation,
      answer: 'The gym is on test street.',
    });

    const payload = httpService.post.mock.calls[0][1];
    const prompt = payload.messages[1].content as string;

    expect(prompt).not.toContain('message-00');
    expect(prompt).not.toContain('message-01');
    expect(prompt).toContain('message-02');
    expect(prompt).toContain('message-11');
  });

  it('parses fenced JSON responses from Cohere', async () => {
    config.CHATBOT_COHERE_ENABLED = true;
    config.COHERE_API_KEY = 'cohere-test-key';

    httpService.post.mockReturnValue(
      of({
        data: {
          message: {
            content: [
              {
                text: `\`\`\`json
{"intentKey":"${CHATBOT_INTENTS.faqLocation}","answer":"The gym is on test street."}
\`\`\``,
              },
            ],
          },
        },
      }),
    );

    const result = await client.classifyMessage(
      'Where is the gym?',
      [],
      { [CHATBOT_INTENTS.faqLocation]: 'location help' },
    );

    expect(result).toEqual({
      intentKey: CHATBOT_INTENTS.faqLocation,
      answer: 'The gym is on test street.',
    });
  });

  it('returns null when Cohere responds with invalid data', async () => {
    config.CHATBOT_COHERE_ENABLED = true;
    config.COHERE_API_KEY = 'cohere-test-key';

    httpService.post.mockReturnValue(throwError(() => new Error('boom')));

    const result = await client.classifyMessage(
      'Need help',
      [],
      { [CHATBOT_INTENTS.supportHuman]: 'support help' },
    );

    expect(result).toBeNull();
  });
});
