import { Injectable } from '@nestjs/common';
import { GeminiService } from './services/gemini.service';
import { CustomService } from './services/custom.service';
import { ChatRequestDto, ChatResponseDto } from './dto/chat-message.dto';

@Injectable()
export class ChatService {
  constructor(
    private geminiService: GeminiService,
    private customService: CustomService
  ) {}

  async sendMessage(chatRequest: ChatRequestDto): Promise<ChatResponseDto> {
    const { provider, model, messages, systemPrompt } = chatRequest;

    if (provider === 'gemini') {
      return await this.geminiService.generateResponse(model, messages, systemPrompt);
    } else if (provider === 'custom') {
      return await this.customService.generateResponse(model, messages, systemPrompt);
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      return await this.geminiService.getAvailableModels();
    } catch (error) {
      console.error('Error getting available models:', error);
      // Возвращаем дефолтные модели в случае ошибки
      return ['gemini-2.5-flash', 'gemini-2.0-flash'];
    }
  }
}
