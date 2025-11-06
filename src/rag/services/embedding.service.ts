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
  private readonly huggingFaceApiKey: string | null;
  private readonly huggingFaceModel: string;

  constructor(private configService: ConfigService) {
    this.provider = this.configService.get<string>('EMBEDDING_PROVIDER') || 'gemini';
    this.huggingFaceApiKey = null;
    this.huggingFaceModel = 'sentence-transformers/all-MiniLM-L6-v2';
    
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
    } else if (this.provider === 'huggingface') {
      this.huggingFaceApiKey = this.configService.get<string>('HUGGINGFACE_API_KEY') || null;
      // Используем модель, которая точно поддерживает feature extraction через Inference API
      this.huggingFaceModel = this.configService.get<string>('HUGGINGFACE_EMBEDDING_MODEL') || 
                              'BAAI/bge-small-en-v1.5';
      if (!this.huggingFaceApiKey) {
        this.logger.error('HUGGINGFACE_API_KEY is required for Hugging Face embeddings. Please set it in your .env file.');
      } else {
        this.logger.log(`Hugging Face embeddings configured with API key and model: ${this.huggingFaceModel}`);
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
      } else if (this.provider === 'huggingface') {
        return await this.generateHuggingFaceEmbedding(text);
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
      this.logger.log(`EmbeddingService: Generating ${texts.length} embeddings using provider: ${this.provider}`);
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
      } else if (this.provider === 'huggingface') {
        // Hugging Face поддерживает батчи
        this.logger.log(`Using Hugging Face API with model: ${this.huggingFaceModel}`);
        return await this.generateHuggingFaceEmbeddings(texts);
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
   * Генерирует эмбеддинг через Hugging Face Inference API
   */
  private async generateHuggingFaceEmbedding(text: string): Promise<number[]> {
    if (!this.huggingFaceApiKey) {
      throw new Error('HUGGINGFACE_API_KEY is required for Hugging Face embeddings');
    }

    try {
      this.logger.log(`Calling Hugging Face API: ${this.huggingFaceModel} for single text`);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.huggingFaceApiKey}`,
      };

      // Используем models endpoint для embeddings
      // Для некоторых моделей нужно использовать другой формат
      const requestBody = this.huggingFaceModel.includes('sentence-transformers') 
        ? { inputs: [text] }  // sentence-transformers ожидает массив
        : { inputs: text };    // другие модели ожидают строку

      const apiUrl = `https://router.huggingface.co/hf-inference/models/${this.huggingFaceModel}`;
      const response = await axios.post(
        apiUrl,
        requestBody,
        {
          headers,
          timeout: 30000, // 30 секунд таймаут
        }
      );

      this.logger.log(`Hugging Face API response received successfully`);

      // Hugging Face возвращает массив чисел или массив массивов
      let embedding: number[];
      if (Array.isArray(response.data)) {
        // Если это массив массивов, берем первый элемент
        if (Array.isArray(response.data[0])) {
          embedding = response.data[0];
        } else {
          embedding = response.data;
        }
      } else {
        throw new Error('Invalid embedding response from Hugging Face');
      }

      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Invalid embedding response from Hugging Face');
      }

      return embedding;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 503) {
          // Модель загружается, нужно подождать
          this.logger.warn('Hugging Face model is loading, waiting 10 seconds...');
          await new Promise(resolve => setTimeout(resolve, 10000));
          // Повторная попытка
          return this.generateHuggingFaceEmbedding(text);
        }
        if (error.response?.status === 410) {
          // Старый endpoint больше не поддерживается
          this.logger.error('Hugging Face API endpoint is deprecated. Please check the API documentation.');
        }
        if (error.response?.status === 401) {
          // Требуется авторизация
          this.logger.error('Hugging Face API requires authentication. Please set HUGGINGFACE_API_KEY in your .env file.');
        }
        this.logger.error(`Hugging Face API error: ${error.response?.status} - ${error.response?.statusText}`);
        if (error.response?.data) {
          this.logger.error(`Error details: ${JSON.stringify(error.response.data)}`);
        }
      } else {
        this.logger.error('Hugging Face embedding error:', error);
      }
      throw error;
    }
  }

  /**
   * Генерирует эмбеддинги для массива текстов через Hugging Face (батчинг)
   */
  private async generateHuggingFaceEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.huggingFaceApiKey) {
      throw new Error('HUGGINGFACE_API_KEY is required for Hugging Face embeddings');
    }

    try {
      this.logger.log(`Calling Hugging Face API: ${this.huggingFaceModel} for ${texts.length} texts`);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.huggingFaceApiKey}`,
      };

      // Используем models endpoint для embeddings
      // Для sentence-transformers уже ожидается массив, для других моделей тоже
      const apiUrl = `https://router.huggingface.co/hf-inference/models/${this.huggingFaceModel}`;
      const response = await axios.post(
        apiUrl,
        {
          inputs: texts,
        },
        {
          headers,
          timeout: 60000, // 60 секунд таймаут для батча
        }
      );

      this.logger.log(`Hugging Face API response received successfully for ${texts.length} texts`);

      // Hugging Face возвращает массив массивов для батча
      let embeddings: number[][];
      if (Array.isArray(response.data)) {
        if (Array.isArray(response.data[0])) {
          embeddings = response.data;
        } else {
          // Если вернулся один массив, оборачиваем в массив
          embeddings = [response.data];
        }
      } else {
        throw new Error('Invalid embeddings response from Hugging Face');
      }

      if (!embeddings || !Array.isArray(embeddings) || embeddings.length === 0) {
        throw new Error('Invalid embeddings response from Hugging Face');
      }

      if (embeddings.length !== texts.length) {
        this.logger.warn(
          `Mismatch: requested ${texts.length} embeddings, got ${embeddings.length}`
        );
      }

      return embeddings;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 503) {
          // Модель загружается, нужно подождать
          this.logger.warn('Hugging Face model is loading, waiting 10 seconds...');
          await new Promise(resolve => setTimeout(resolve, 10000));
          // Повторная попытка
          return this.generateHuggingFaceEmbeddings(texts);
        }
        if (error.response?.status === 410) {
          // Старый endpoint больше не поддерживается
          this.logger.error('Hugging Face API endpoint is deprecated. Please check the API documentation.');
        }
        if (error.response?.status === 401) {
          // Требуется авторизация
          this.logger.error('Hugging Face API requires authentication. Please set HUGGINGFACE_API_KEY in your .env file.');
        }
        this.logger.error(`Hugging Face API error: ${error.response?.status} - ${error.response?.statusText}`);
        if (error.response?.data) {
          this.logger.error(`Error details: ${JSON.stringify(error.response.data)}`);
        }
      } else {
        this.logger.error('Hugging Face embeddings error:', error);
      }
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

