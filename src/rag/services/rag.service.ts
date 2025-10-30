import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentProcessorService, DocumentChunk } from './document-processor.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService, DocumentMetadata } from './vector-store.service';

export interface SearchResult {
  content: string;
  metadata: DocumentMetadata;
  similarity: number;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly enabled: boolean;
  private readonly topK: number;

  constructor(
    private readonly documentProcessor: DocumentProcessorService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
    private readonly configService: ConfigService,
  ) {
    this.enabled = this.configService.get<string>('RAG_ENABLED') === 'true';
    this.topK = parseInt(this.configService.get<string>('TOP_K_RESULTS') || '5');
    
    // Логируем статус RAG при инициализации
    this.logger.log(`RAG Service initialized: enabled=${this.enabled}, topK=${this.topK}`);
    if (!this.enabled) {
      this.logger.warn('RAG is DISABLED. Set RAG_ENABLED=true in .env file to enable RAG functionality.');
    }
  }

  /**
   * Проверяет, включен ли RAG
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Индексирует файл: извлекает текст, разбивает на чанки, генерирует эмбеддинги и сохраняет в векторную БД
   */
  async indexFile(
    fileId: string,
    filePath: string,
    mimetype: string,
    originalName: string
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.log('RAG is disabled, skipping indexing');
      return;
    }

    try {
      this.logger.log(`[RAG] Starting indexing for file ${fileId}: ${originalName}`);

      // 1. Извлекаем текст и разбиваем на чанки
      const chunks = await this.documentProcessor.processFile(filePath, mimetype);
      
      if (chunks.length === 0) {
        this.logger.warn(`[RAG] No chunks extracted from file ${fileId}`);
        return;
      }

      this.logger.log(`[RAG] Extracted ${chunks.length} chunks from file ${fileId}`);

      // 2. Генерируем эмбеддинги для всех чанков
      this.logger.log(`[RAG] Generating embeddings for ${chunks.length} chunks...`);
      const chunkTexts = chunks.map(chunk => chunk.content);
      const embeddings = await this.embeddingService.generateEmbeddings(chunkTexts);

      if (embeddings.length !== chunks.length) {
        throw new Error(`Mismatch between chunks (${chunks.length}) and embeddings (${embeddings.length})`);
      }

      this.logger.log(`[RAG] Generated ${embeddings.length} embeddings`);

      // 3. Подготавливаем метаданные
      const metadatas: DocumentMetadata[] = chunks.map((chunk, index) => ({
        fileId: fileId,
        chunkIndex: chunk.chunkIndex,
        originalName: originalName,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
        ...chunk.metadata,
      }));

      // 4. Сохраняем в векторную БД
      this.logger.log(`[RAG] Saving ${chunks.length} chunks to vector store...`);
      await this.vectorStore.addDocuments(embeddings, chunkTexts, metadatas);

      this.logger.log(`[RAG] Successfully indexed file ${fileId} with ${chunks.length} chunks`);
    } catch (error) {
      this.logger.error(`[RAG] Error indexing file ${fileId}:`, error);
      this.logger.error(error.stack);
      throw error;
    }
  }

  /**
   * Удаляет индексацию файла из векторной БД
   */
  async deleteFileIndex(fileId: string): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      await this.vectorStore.deleteDocumentsByFileId(fileId);
      this.logger.log(`Deleted index for file ${fileId}`);
    } catch (error) {
      this.logger.error(`Error deleting index for file ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Ищет релевантные документы по запросу
   */
  async searchDocuments(query: string, filter?: { fileId?: string }): Promise<SearchResult[]> {
    if (!this.enabled) {
      this.logger.log('RAG is disabled, returning empty results');
      return [];
    }

    try {
      this.logger.log(`RAG: Generating embedding for query: "${query.substring(0, 50)}..."`);
      // 1. Генерируем эмбеддинг для запроса
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);
      this.logger.log(`RAG: Generated embedding, dimension: ${queryEmbedding.length}`);

      // 2. Ищем похожие документы
      this.logger.log(`RAG: Searching vector store for top ${this.topK} results`);
      const results = await this.vectorStore.searchSimilar(queryEmbedding, this.topK, filter);
      this.logger.log(`RAG: Vector store returned ${results.length} results`);

      // 3. Преобразуем результаты в формат SearchResult
      const searchResults: SearchResult[] = results.map(result => ({
        content: result.document,
        metadata: result.metadata,
        // Преобразуем расстояние в схожесть (1 - normalized distance)
        similarity: result.distance >= 0 ? 1 - Math.min(result.distance, 1) : 0,
      }));

      this.logger.log(`Found ${searchResults.length} relevant documents for query`);
      if (searchResults.length > 0) {
        this.logger.debug(`RAG: Top result similarity: ${searchResults[0].similarity.toFixed(3)}`);
      }
      return searchResults;
    } catch (error) {
      this.logger.error('Error searching documents:', error);
      this.logger.error(error.stack);
      // Возвращаем пустой массив вместо выбрасывания ошибки
      return [];
    }
  }

  /**
   * Форматирует найденные документы для включения в промпт
   */
  formatDocumentsForPrompt(searchResults: SearchResult[]): string {
    if (searchResults.length === 0) {
      return '';
    }

    let formatted = '\n\n=== Релевантные документы ===\n';
    
    searchResults.forEach((result, index) => {
      formatted += `\n[Документ ${index + 1} из "${result.metadata.originalName}"]\n`;
      formatted += `${result.content}\n`;
      formatted += `---\n`;
    });

    formatted += '\n=== Конец релевантных документов ===\n\n';
    formatted += 'Используй информацию из вышеприведенных документов для ответа на вопрос пользователя. ';
    formatted += 'Если информации в документах недостаточно, отвечай на основе своих знаний. ';
    formatted += 'Указывай источники информации, когда это возможно.\n\n';

    return formatted;
  }

  /**
   * Получает статистику по индексированным документам
   */
  async getStats(): Promise<{ totalDocuments: number }> {
    if (!this.enabled) {
      return { totalDocuments: 0 };
    }

    try {
      const count = await this.vectorStore.getDocumentCount();
      return { totalDocuments: count };
    } catch (error) {
      this.logger.error('Error getting RAG stats:', error);
      return { totalDocuments: 0 };
    }
  }
}

