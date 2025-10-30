import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChromaClient } from 'chromadb';
import * as path from 'path';
import * as fs from 'fs';

export interface DocumentMetadata {
  fileId: string;
  chunkIndex: number;
  originalName: string;
  startChar?: number;
  endChar?: number;
  [key: string]: any;
}

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private client: ChromaClient;
  private collection: any;
  private readonly collectionName = 'documents';
  private readonly vectorDbPath: string;

  constructor(private configService: ConfigService) {
    this.vectorDbPath = this.configService.get<string>('VECTOR_DB_PATH') || path.resolve(process.cwd(), 'vector_db');
  }

  async onModuleInit() {
    await this.initialize();
  }

  /**
   * Инициализирует ChromaDB клиент и коллекцию
   */
  private async initialize() {
    try {
      // Создаем директорию если её нет
      if (!fs.existsSync(this.vectorDbPath)) {
        fs.mkdirSync(this.vectorDbPath, { recursive: true });
      }

      // Инициализируем ChromaDB клиент
      // ChromaDB может работать в режиме in-memory или с персистентным хранилищем
      // Для локального хранилища используем path, для сервера - host и port
      const chromaConfig: any = {};
      
      // Проверяем, указан ли путь к серверу ChromaDB
      const chromaHost = this.configService.get<string>('CHROMA_HOST');
      const chromaPort = this.configService.get<string>('CHROMA_PORT');
      
      if (chromaHost && chromaHost.trim() !== '') {
        // Используем удаленный сервер ChromaDB (новый формат API)
        chromaConfig.host = chromaHost;
        chromaConfig.port = chromaPort ? parseInt(chromaPort, 10) : 8000;
      } else {
        // Используем локальное хранилище
        chromaConfig.path = this.vectorDbPath;
      }

      this.client = new ChromaClient(chromaConfig);

      // Проверяем, существует ли коллекция
      try {
        this.collection = await this.client.getCollection({
          name: this.collectionName,
        });
        this.logger.log(`Loaded existing collection: ${this.collectionName}`);
      } catch (error) {
        // Если коллекция не существует, создаем её
        this.collection = await this.client.createCollection({
          name: this.collectionName,
          metadata: { description: 'Document embeddings for RAG' },
        });
        this.logger.log(`Created new collection: ${this.collectionName}`);
      }
    } catch (error) {
      this.logger.error('Error initializing ChromaDB:', error);
      // Не бросаем ошибку при инициализации, чтобы не ломать приложение
      // RAG просто не будет работать если ChromaDB недоступен
      this.logger.warn('ChromaDB initialization failed, RAG will be disabled');
    }
  }

  /**
   * Добавляет документы в векторную базу данных
   */
  async addDocuments(
    embeddings: number[][],
    documents: string[],
    metadatas: DocumentMetadata[],
    ids?: string[]
  ): Promise<void> {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      if (!this.collection) {
        throw new Error('ChromaDB collection is not initialized');
      }

      // Генерируем ID если не предоставлены
      const documentIds = ids || embeddings.map((_, index) => 
        `${metadatas[index].fileId}_chunk_${metadatas[index].chunkIndex}`
      );

      await this.collection.add({
        ids: documentIds,
        embeddings: embeddings,
        documents: documents,
        metadatas: metadatas.map(meta => ({
          ...meta,
          // ChromaDB требует, чтобы метаданные были простыми объектами
          fileId: String(meta.fileId),
          chunkIndex: Number(meta.chunkIndex),
        })),
      });

      this.logger.log(`Added ${documents.length} documents to vector store`);
    } catch (error) {
      this.logger.error('Error adding documents to vector store:', error);
      throw error;
    }
  }

  /**
   * Поиск похожих документов по запросу
   */
  async searchSimilar(
    queryEmbedding: number[],
    topK: number = 5,
    filter?: { fileId?: string }
  ): Promise<Array<{ document: string; metadata: DocumentMetadata; distance: number }>> {
    try {
      if (!this.collection) {
        this.logger.warn('VectorStore: Collection not initialized, attempting to initialize...');
        await this.initialize();
      }

      if (!this.collection) {
        this.logger.warn('ChromaDB collection is not initialized, returning empty results');
        return [];
      }

      const where: any = {};
      if (filter?.fileId) {
        where.fileId = filter.fileId;
      }

      this.logger.log(`VectorStore: Querying collection "${this.collectionName}" with topK=${topK}`);
      const results = await this.collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
        where: Object.keys(where).length > 0 ? where : undefined,
      });

      this.logger.log(`VectorStore: Query returned ${results.documents?.[0]?.length || 0} documents`);

      // Обрабатываем результаты
      const documents: Array<{ document: string; metadata: DocumentMetadata; distance: number }> = [];

      if (results.documents && results.documents[0]) {
        const docs = results.documents[0];
        const metadatas = results.metadatas?.[0] || [];
        const distances = results.distances?.[0] || [];

        for (let i = 0; i < docs.length; i++) {
          documents.push({
            document: docs[i],
            metadata: metadatas[i] as DocumentMetadata,
            distance: distances[i] || 0,
          });
        }
      }

      return documents;
    } catch (error) {
      this.logger.error('Error searching similar documents:', error);
      this.logger.error(error.stack);
      // Возвращаем пустой массив вместо выбрасывания ошибки
      return [];
    }
  }

  /**
   * Удаляет документы по fileId
   */
  async deleteDocumentsByFileId(fileId: string): Promise<void> {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      // Получаем все документы с этим fileId
      const results = await this.collection.get({
        where: { fileId: fileId },
      });

      if (results.ids && results.ids.length > 0) {
        await this.collection.delete({
          ids: results.ids,
        });
        this.logger.log(`Deleted ${results.ids.length} documents for fileId: ${fileId}`);
      }
    } catch (error) {
      this.logger.error(`Error deleting documents for fileId ${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Получает количество документов в коллекции
   */
  async getDocumentCount(): Promise<number> {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      const count = await this.collection.count();
      return count;
    } catch (error) {
      this.logger.error('Error getting document count:', error);
      return 0;
    }
  }

  /**
   * Получает все документы для конкретного файла
   */
  async getDocumentsByFileId(fileId: string): Promise<Array<{ document: string; metadata: DocumentMetadata }>> {
    try {
      if (!this.collection) {
        await this.initialize();
      }

      const results = await this.collection.get({
        where: { fileId: fileId },
      });

      const documents: Array<{ document: string; metadata: DocumentMetadata }> = [];

      if (results.documents && results.documents.length > 0) {
        for (let i = 0; i < results.documents.length; i++) {
          documents.push({
            document: results.documents[i],
            metadata: results.metadatas?.[i] as DocumentMetadata || {
              fileId: 'unknown',
              chunkIndex: 0,
              originalName: 'unknown'
            },
          });
        }
      }

      return documents;
    } catch (error) {
      this.logger.error(`Error getting documents for fileId ${fileId}:`, error);
      throw error;
    }
  }
}

