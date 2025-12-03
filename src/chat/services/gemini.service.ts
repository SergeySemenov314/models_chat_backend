import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { MessageDto, ChatResponseDto } from '../dto/chat-message.dto';

@Injectable()
export class GeminiService {
  private genAI: GoogleGenerativeAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  private toFlatName(name: string): string {
    if (!name) return name;
    return name.includes('/') ? name.split('/').pop() as string : name;
  }

  private buildFallbackOrder(preferred: string, available: string[]): string[] {
    const preferredOrder = [
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite'
    ];

    const flatAvailable = (available || []).map(n => this.toFlatName(n));

    const ordered = [
      this.toFlatName(preferred),
      ...preferredOrder,
      ...flatAvailable
    ];

    // uniq while preserving order
    const seen = new Set<string>();
    return ordered.filter(n => {
      if (!n) return false;
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  }

  private isRetriableError(err: unknown): boolean {
    const msg = String((err as any)?.message || err || '').toLowerCase();
    // Common Gemini/HTTP transient or capacity errors
    return (
      msg.includes('429') ||
      msg.includes('too many requests') ||
      msg.includes('resource exhausted') ||
      msg.includes('rate') ||
      msg.includes('quota') ||
      msg.includes('unavailable') ||
      msg.includes('overloaded') ||
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504')
    );
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const apiKey = this.configService.get<string>('GEMINI_API_KEY');
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      
      if (!response.ok) {
        throw new Error(`ListModels HTTP ${response.status}`);
      }
      
      const json = await response.json();
      const models = (json.models || [])
        .filter(m => Array.isArray(m.supportedGenerationMethods) && 
                    m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name);
      
      return models;
    } catch (error) {
      console.error('Error fetching Gemini models:', error);
      // Возвращаем дефолтные модели если API недоступен
      return ['gemini-2.5-flash', 'gemini-2.0-flash'];
    }
  }

  private pickBestModel(modelsList: string[]): string {
    const names = modelsList.map(m => m);
    const preferredOrder = [
      'gemini-2.5-flash',
      'gemini-2.0-flash'
    ];
    
    for (const pref of preferredOrder) {
      if (names.some(n => n === pref)) return pref;
      if (names.some(n => n.endsWith('/' + pref))) return pref;
    }
    
    if (names.length > 0) {
      const first = names[0];
      return first.includes('/') ? first.split('/').pop() : first;
    }
    
    return 'gemini-2.5-flash';
  }

  async generateResponse(
    model: string,
    messages: MessageDto[],
    systemPrompt?: string
  ): Promise<ChatResponseDto> {
    try {
      // Получаем список доступных моделей и строим порядок попыток
      const availableModels = await this.getAvailableModels();
      const candidates = this.buildFallbackOrder(model, availableModels);

      // Готовим промпт один раз
      let prompt = '';
      if (systemPrompt && systemPrompt.trim()) {
        prompt += `Системная инструкция: ${systemPrompt}\n\n`;
      }
      const recentMessages = messages.slice(-10).filter(msg => msg.role !== 'error');
      recentMessages.forEach(msg => {
        const roleLabel = msg.role === 'assistant' ? 'AI' : 'Пользователь';
        prompt += `${roleLabel}: ${msg.content}\n`;
      });
      prompt += `AI: `;

      let lastError: any = null;
      for (const candidate of candidates) {
        try {
          const genModel = this.genAI.getGenerativeModel({ model: candidate });
          const result = await genModel.generateContent(prompt);
          const response = await result.response;
          const text = response.text();

          return {
            content: text,
            stats: {
              model: candidate,
              promptTokens: response.usageMetadata?.promptTokenCount || 0,
              responseTokens: response.usageMetadata?.candidatesTokenCount || 0,
              totalTokens: response.usageMetadata?.totalTokenCount || 0
            }
          };
        } catch (err) {
          lastError = err;
          const msg = String((err as any)?.message || err || '');
          // Если ошибка не ретраибл и не 404/unknown model — прерываем цикл
          const isNotFound = msg.includes('404') || msg.toLowerCase().includes('not found');
          if (!(isNotFound || this.isRetriableError(err))) {
            break;
          }
          // иначе идем к следующей модели
          continue;
        }
      }

      throw lastError || new Error('All models failed without specific error');
    } catch (error) {
      console.error('Gemini API error:', error);
      throw new InternalServerErrorException(`Ошибка Gemini API: ${error.message}`);
    }
  }
}
