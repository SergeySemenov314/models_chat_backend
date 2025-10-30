import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly provider: string;
  private readonly geminiAI: GoogleGenerativeAI | null;
  private readonly openaiApiKey: string | null;

  constructor(private configService: ConfigService) {
    this.provider = this.configService.get<string>('EMBEDDING_PROVIDER') || 'gemini';
    
    if (this.provider === 'gemini') {
      const apiKey = this.configService.get<string>('GEMINI_API_KEY');
      if (apiKey) {
        this.geminiAI = new GoogleGenerativeAI(apiKey);
      } else {
        this.logger.warn('GEMINI_API_KEY not found, embeddings will use fallback');
        this.geminiAI = null;
      }
    } else if (this.provider === 'openai') {
      this.openaiApiKey = this.configService.get<string>('OPENAI_API_KEY') || null;
      if (!this.openaiApiKey) {
        this.logger.warn('OPENAI_API_KEY not found');
      }
    }
  }

  /**
   * Генерирует эмбеддинг для текста
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      this.logger.log(`EmbeddingService: Generating embedding using provider: ${this.provider}`);
      if (this.provider === 'gemini') {
        return await this.generateGeminiEmbedding(text);
      } else if (this.provider === 'openai') {
        return await this.generateOpenAIEmbedding(text);
      } else {
        throw new Error(`Unsupported embedding provider: ${this.provider}`);
      }
    } catch (error) {
      this.logger.error(`Error generating embedding:`, error);
      this.logger.error(error.stack);
      throw error;
    }
  }

  /**
   * Генерирует эмбеддинги для массива текстов
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      if (this.provider === 'gemini') {
        // Gemini может обрабатывать батчами через API
        const embeddings: number[][] = [];
        for (const text of texts) {
          const embedding = await this.generateGeminiEmbedding(text);
          embeddings.push(embedding);
        }
        return embeddings;
      } else if (this.provider === 'openai') {
        // OpenAI поддерживает батчи
        return await this.generateOpenAIEmbeddings(texts);
      } else {
        throw new Error(`Unsupported embedding provider: ${this.provider}`);
      }
    } catch (error) {
      this.logger.error(`Error generating embeddings:`, error);
      throw error;
    }
  }

  /**
   * Генерирует эмбеддинг через Gemini API
   */
  private async generateGeminiEmbedding(text: string): Promise<number[]> {
    if (!this.geminiAI) {
      throw new Error('Gemini AI not initialized');
    }

    try {
      // Gemini использует embedding-001 модель для эмбеддингов
      const model = this.geminiAI.getGenerativeModel({ model: 'embedding-001' });
      
      // Для Gemini нужно использовать специальный метод для эмбеддингов
      // Если в API нет прямого метода, используем альтернативный подход
      const apiKey = this.configService.get<string>('GEMINI_API_KEY');
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${apiKey}`,
        {
          model: 'models/embedding-001',
          content: {
            parts: [{ text: text }]
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      const embedding = response.data.embedding?.values;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response from Gemini');
      }

      return embedding;
    } catch (error) {
      this.logger.error('Gemini embedding error:', error);
      // Fallback: используем простой эмбеддинг на основе текста
      // В продакшене лучше использовать OpenAI или другой провайдер
      return this.fallbackEmbedding(text);
    }
  }

  /**
   * Генерирует эмбеддинг через OpenAI API
   */
  private async generateOpenAIEmbedding(text: string): Promise<number[]> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const model = this.configService.get<string>('EMBEDDING_MODEL') || 'text-embedding-3-small';

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          model: model,
          input: text,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openaiApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const embedding = response.data.data[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response from OpenAI');
      }

      return embedding;
    } catch (error) {
      this.logger.error('OpenAI embedding error:', error);
      throw error;
    }
  }

  /**
   * Генерирует эмбеддинги для массива текстов через OpenAI (батчинг)
   */
  private async generateOpenAIEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const model = this.configService.get<string>('EMBEDDING_MODEL') || 'text-embedding-3-small';

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          model: model,
          input: texts,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openaiApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const embeddings = response.data.data.map((item: any) => item.embedding);
      if (!embeddings || !Array.isArray(embeddings)) {
        throw new Error('Invalid embeddings response from OpenAI');
      }

      return embeddings;
    } catch (error) {
      this.logger.error('OpenAI embeddings error:', error);
      throw error;
    }
  }

  /**
   * Простой fallback эмбеддинг (для тестирования или когда API недоступен)
   * В реальном приложении лучше использовать локальную модель или другой провайдер
   */
  private fallbackEmbedding(text: string): number[] {
    // Простой TF-IDF подобный эмбеддинг на основе хеша
    // Это не настоящий эмбеддинг, но для тестирования сойдет
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Array(384).fill(0);
    
    words.forEach((word, i) => {
      const hash = this.simpleHash(word);
      const index = hash % 384;
      embedding[index] += 1 / (words.length || 1);
    });

    // Нормализация
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => magnitude > 0 ? val / magnitude : 0);
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
}

