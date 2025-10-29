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
      // Получаем список доступных моделей для проверки
      const availableModels = await this.getAvailableModels();
      let modelNameToUse = model;

      // Проверяем доступность модели
      if (availableModels.length > 0) {
        const flatNames = availableModels.map(n => n.includes('/') ? n.split('/').pop() : n);
        if (!flatNames.includes(modelNameToUse)) {
          modelNameToUse = this.pickBestModel(availableModels);
        }
      }

      let genModel = this.genAI.getGenerativeModel({ model: modelNameToUse });

      // Подготавливаем промпт
      let prompt = '';
      if (systemPrompt && systemPrompt.trim()) {
        prompt += `Системная инструкция: ${systemPrompt}\n\n`;
      }

      // Добавляем историю сообщений (последние 10)
      const recentMessages = messages.slice(-10).filter(msg => msg.role !== 'error');
      recentMessages.forEach(msg => {
        const roleLabel = msg.role === 'assistant' ? 'AI' : 'Пользователь';
        prompt += `${roleLabel}: ${msg.content}\n`;
      });
      prompt += `AI: `;

      let result;
      try {
        result = await genModel.generateContent(prompt);
      } catch (err) {
        // Если модель не найдена, пробуем fallback
        const isNotFound = (err && (String(err.message || err).includes('404') || 
                                   String(err.message || err).includes('not found')));
        if (isNotFound && availableModels.length > 0) {
          const fallback = this.pickBestModel(availableModels);
          if (fallback && fallback !== modelNameToUse) {
            modelNameToUse = fallback;
            genModel = this.genAI.getGenerativeModel({ model: modelNameToUse });
            result = await genModel.generateContent(prompt);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      const response = await result.response;
      const text = response.text();

      return {
        content: text,
        stats: {
          model: modelNameToUse,
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          responseTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0
        }
      };
    } catch (error) {
      console.error('Gemini API error:', error);
      throw new InternalServerErrorException(`Ошибка Gemini API: ${error.message}`);
    }
  }
}
