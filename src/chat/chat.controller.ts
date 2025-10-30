import { Controller, Post, Get, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatRequestDto, ChatResponseDto, ModelsListDto } from './dto/chat-message.dto';
import { CustomService } from './services/custom.service';
import { RagService } from '../rag/services/rag.service';

@Controller('api/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly customService: CustomService,
    private readonly ragService: RagService,
  ) {}

  @Post()
  async sendMessage(@Body() chatRequest: ChatRequestDto): Promise<ChatResponseDto> {
    try {
      return await this.chatService.sendMessage(chatRequest);
    } catch (error) {
      console.error('Chat controller error:', error);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Internal server error',
          error: 'Chat Error'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('models')
  async getAvailableModels(): Promise<ModelsListDto> {
    try {
      const models = await this.chatService.getAvailableModels();
      return { models };
    } catch (error) {
      console.error('Models controller error:', error);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Failed to fetch models',
          error: 'Models Error'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('config')
  async getConfig() {
    return {
      customServerConfigured: this.customService.isConfigured(),
      defaultCustomModel: this.customService.getDefaultModel()
    };
  }

  @Get('rag/status')
  async getRagStatus() {
    try {
      const isEnabled = this.ragService.isEnabled();
      const stats = await this.ragService.getStats();
      return {
        enabled: isEnabled,
        stats: stats
      };
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Failed to get RAG status',
          error: 'RAG Status Error'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
