import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { config } from '../../libs/config';
import { CHATBOT_CONTEXT_PAIRS, ChatbotIntentKey } from './chatbot.constants';

interface ChatbotConversationMessage {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

interface CohereClassification {
  intentKey: ChatbotIntentKey;
  answer?: string;
}

@Injectable()
export class CohereClient {
  private readonly logger = new Logger(CohereClient.name);

  constructor(private readonly httpService: HttpService) {}

  isEnabled(): boolean {
    return config.CHATBOT_COHERE_ENABLED && Boolean(config.COHERE_API_KEY);
  }

  async classifyMessage(
    message: string,
    history: ChatbotConversationMessage[],
    intentCatalog: Record<string, string>,
  ): Promise<CohereClassification | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const recentHistory = history.slice(-CHATBOT_CONTEXT_PAIRS * 2);
    const catalogLines = Object.entries(intentCatalog)
      .map(([key, description]) => `- ${key}: ${description}`)
      .join('\n');

    const prompt = [
      'You are a strict intent classifier for a gym management chatbot.',
      'Reply with JSON only.',
      'Allowed intents:',
      catalogLines,
      'If the message is unsupported or transactional, return unsupported.transactional.',
      `Current member message: ${message}`,
      `Recent conversation: ${JSON.stringify(recentHistory)}`,
      'JSON shape: {"intentKey":"...", "answer":"optional short FAQ answer only when safe"}',
    ].join('\n');

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          config.COHERE_API_URL,
          {
            model: config.COHERE_MODEL,
            messages: [
              { role: 'system', content: 'Return valid JSON only.' },
              { role: 'user', content: prompt },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${config.COHERE_API_KEY}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const rawText = this.extractText(response.data);

      if (!rawText) {
        return null;
      }

      const parsed = this.parseClassification(rawText);

      if (!parsed.intentKey || !(parsed.intentKey in intentCatalog)) {
        return null;
      }

      return {
        intentKey: parsed.intentKey,
        answer: parsed.answer,
      };
    } catch (error) {
      this.logger.warn('Cohere classification failed', error as Error);
      return null;
    }
  }

  private parseClassification(rawText: string): Partial<CohereClassification> {
    try {
      return JSON.parse(rawText) as Partial<CohereClassification>;
    } catch {
      const normalized = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      return JSON.parse(normalized) as Partial<CohereClassification>;
    }
  }

  private extractText(payload: any): string | null {
    if (typeof payload?.text === 'string') {
      return payload.text;
    }

    const content = payload?.message?.content;

    if (Array.isArray(content)) {
      const textPart = content.find((item: any) => typeof item?.text === 'string');
      return textPart?.text ?? null;
    }

    return null;
  }
}
