import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { MessageDto, ChatResponseDto } from '../dto/chat-message.dto';

@Injectable()
export class GeminiService {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private readonly http: AxiosInstance;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    this.apiKey = apiKey;

    // Если задан GEMINI_PROXY_URL — все вызовы к Google идут через прокси
    // (нужно, когда сервер в регионе, где Google блокирует Gemini, напр. EEA).
    // Через прокси идут ТОЛЬКО запросы этого клиента — ChromaDB/HuggingFace не затрагиваются.
    const proxyUrl = this.configService.get<string>('GEMINI_PROXY_URL');
    const axiosConfig: any = { timeout: 60000 };
    if (proxyUrl && proxyUrl.trim()) {
      const url = proxyUrl.trim();
      axiosConfig.httpsAgent = new HttpsProxyAgent(url);
      axiosConfig.proxy = false; // отключаем встроенный proxy axios, используем agent
      try {
        console.log(`Gemini: outbound requests routed via proxy ${new URL(url).host}`);
      } catch {
        console.log('Gemini: outbound requests routed via proxy');
      }
    }
    this.http = axios.create(axiosConfig);
  }

  private toFlatName(name: string): string {
    if (!name) return name;
    return name.includes('/') ? name.split('/').pop() as string : name;
  }

  private buildFallbackOrder(preferred: string, available: string[]): string[] {
    // Порядок по убыванию: сначала модели, у которых есть бесплатная квота
    // (Gemini 2.0-* сейчас имеют free tier limit=0), затем остальные как запас.
    const preferredOrder = [
      'gemini-2.5-flash-lite',
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

  // Собирает читаемое сообщение об ошибке из axios-ошибки (status + тело ответа Google),
  // чтобы isRetriableError видел '429'/'quota' и т.п.
  private describeAxiosError(err: any): string {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const dataStr = data
      ? (typeof data === 'string' ? data : JSON.stringify(data))
      : '';
    return `${status ?? ''} ${err?.message ?? ''} ${dataStr}`.trim();
  }

  async getAvailableModels(): Promise<string[]> {
    const defaults = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    try {
      // pageSize=1000 чтобы получить весь список за один запрос (по умолчанию ~50).
      const resp = await this.http.get(`${this.baseUrl}/models`, {
        params: { pageSize: 1000, key: this.apiKey },
      });

      const models = (resp.data?.models || [])
        .filter(m => Array.isArray(m.supportedGenerationMethods) &&
                    m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name);

      if (models.length === 0) {
        console.warn('ListModels returned an empty generateContent list, using defaults');
        return defaults;
      }

      return models;
    } catch (error) {
      // Логируем тело ответа — сразу видно причину (регион/квота/ключ).
      console.error('Error fetching Gemini models:', this.describeAxiosError(error));
      return defaults;
    }
  }

  private pickBestModel(modelsList: string[]): string {
    const names = modelsList.map(m => m);
    const preferredOrder = [
      'gemini-2.5-flash-lite',
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

    return 'gemini-2.5-flash-lite';
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
          const resp = await this.http.post(
            `${this.baseUrl}/models/${candidate}:generateContent`,
            { contents: [{ role: 'user', parts: [{ text: prompt }] }] },
            {
              params: { key: this.apiKey },
              headers: { 'Content-Type': 'application/json' },
            }
          );

          const data = resp.data;
          const text = (data?.candidates?.[0]?.content?.parts || [])
            .map((p: any) => p?.text || '')
            .join('');
          const usage = data?.usageMetadata || {};

          return {
            content: text,
            stats: {
              model: candidate,
              promptTokens: usage.promptTokenCount || 0,
              responseTokens: usage.candidatesTokenCount || 0,
              totalTokens: usage.totalTokenCount || 0
            }
          };
        } catch (err) {
          const msg = this.describeAxiosError(err);
          lastError = new Error(msg);
          // Если ошибка не ретраибл и не 404/unknown model — прерываем цикл
          const isNotFound = msg.includes('404') || msg.toLowerCase().includes('not found');
          if (!(isNotFound || this.isRetriableError(lastError))) {
            break;
          }
          // иначе идем к следующей модели
          continue;
        }
      }

      throw lastError || new Error('All models failed without specific error');
    } catch (error) {
      console.error('Gemini API error:', error?.message || error);
      throw new InternalServerErrorException(`Ошибка Gemini API: ${error?.message || error}`);
    }
  }
}
