import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from './services/gemini.service';
import { CustomService } from './services/custom.service';
import { RagService } from '../rag/services/rag.service';
import { ChatRequestDto, ChatResponseDto } from './dto/chat-message.dto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private geminiService: GeminiService,
    private customService: CustomService,
    private ragService: RagService,
  ) {}

  async sendMessage(chatRequest: ChatRequestDto): Promise<ChatResponseDto> {
    const { provider, model, messages, systemPrompt, useRag } = chatRequest;

    let enhancedSystemPrompt = systemPrompt || '';
    let sources: Array<{ document: string; similarity: number }> = [];

    // Если включен RAG, ищем релевантные документы
    if (useRag && this.ragService.isEnabled()) {
      this.logger.log(`RAG requested: useRag=${useRag}, RAG enabled=${this.ragService.isEnabled()}`);
      try {
        // Берем последнее сообщение пользователя для поиска
        const lastUserMessage = messages
          .filter(msg => msg.role === 'user' || msg.role === 'human')
          .pop();
        
        if (lastUserMessage) {
          this.logger.log(`RAG: Searching for documents matching query: "${lastUserMessage.content.substring(0, 50)}..."`);
          const searchResults = await this.ragService.searchDocuments(lastUserMessage.content);
          
          this.logger.log(`RAG: Search returned ${searchResults.length} results`);
          
          if (searchResults.length > 0) {
            // Форматируем документы для добавления в промпт
            const documentsContext = this.ragService.formatDocumentsForPrompt(searchResults);
            enhancedSystemPrompt = (enhancedSystemPrompt ? enhancedSystemPrompt + '\n\n' : '') + documentsContext;
            
            // Сохраняем источники для ответа
            sources = searchResults.map(result => ({
              document: result.metadata.originalName,
              similarity: result.similarity,
            }));

            this.logger.log(`RAG: Found ${searchResults.length} relevant documents, added to prompt`);
            this.logger.debug(`RAG: Sources: ${sources.map(s => s.document).join(', ')}`);
          } else {
            this.logger.warn('RAG: No relevant documents found for query');
          }
        }
      } catch (error) {
        this.logger.error('Error during RAG search:', error);
        this.logger.error(error.stack);
        // Продолжаем без RAG если произошла ошибка
      }
    } else if (useRag && !this.ragService.isEnabled()) {
      this.logger.warn('RAG requested but is disabled. Set RAG_ENABLED=true in environment variables.');
    }

    let response: ChatResponseDto;

    if (provider === 'gemini') {
      response = await this.geminiService.generateResponse(model, messages, enhancedSystemPrompt);
    } else if (provider === 'custom') {
      response = await this.customService.generateResponse(model, messages, enhancedSystemPrompt);
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    // Добавляем источники в ответ, если они есть
    if (sources.length > 0) {
      response.sources = sources;
    }

    return response;
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      return await this.geminiService.getAvailableModels();
    } catch (error) {
      this.logger.error('Error getting available models:', error);
      // Возвращаем дефолтные модели в случае ошибки
      return ['gemini-2.5-flash', 'gemini-2.0-flash'];
    }
  }
}
