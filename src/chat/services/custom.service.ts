import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { MessageDto, ChatResponseDto } from '../dto/chat-message.dto';

@Injectable()
export class CustomService {
  private readonly customServerUrl: string;
  private readonly defaultModel: string;

  constructor(private configService: ConfigService) {
    this.customServerUrl = this.configService.get<string>('CUSTOM_SERVER_URL') || '';
    this.defaultModel = this.configService.get<string>('CUSTOM_MODEL') || 'qwen2:0.5b';
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  isConfigured(): boolean {
    return !!(this.customServerUrl && this.customServerUrl.trim());
  }

  async generateResponse(
    model: string,
    messages: MessageDto[],
    systemPrompt?: string
  ): Promise<ChatResponseDto> {
    try {
      if (!this.customServerUrl || !this.customServerUrl.trim()) {
        throw new BadRequestException('Custom server URL is not configured on server');
      }

      // Подготавливаем сообщения для отправки
      const chatMessages = [];
      if (systemPrompt && systemPrompt.trim()) {
        chatMessages.push({ role: 'system', content: systemPrompt });
      }

      // Добавляем историю сообщений (последние 10)
      const recentMessages = messages.slice(-10).filter(msg => msg.role !== 'error');
      chatMessages.push(...recentMessages.map(msg => ({ 
        role: msg.role, 
        content: msg.content 
      })));

      const requestBody = {
        model: model,
        messages: chatMessages,
        stream: false
      };

      const response = await axios.post(
        `${this.customServerUrl.replace(/\/$/, '')}/api/chat`,
        requestBody,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000 // 30 секунд таймаут
        }
      );

      const data = response.data;
      const content = data?.message?.content || data?.content || '';

      if (!content) {
        throw new InternalServerErrorException('Empty response from custom server');
      }

      return {
        content: content,
        stats: {
          model: model,
          totalTokens: data?.usage?.total_tokens || data?.eval_count || 0,
          promptTokens: data?.usage?.prompt_tokens || 0,
          responseTokens: data?.usage?.completion_tokens || 0
        }
      };
    } catch (error) {
      console.error('Custom server error:', error);
      
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data || error.message;
        throw new InternalServerErrorException(
          `Custom server HTTP ${status}: ${message}`
        );
      }
      
      throw new InternalServerErrorException(
        `Ошибка кастомного сервера: ${error.message}`
      );
    }
  }
}
