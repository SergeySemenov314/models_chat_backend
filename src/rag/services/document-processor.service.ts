import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as mammoth from 'mammoth';

export interface DocumentChunk {
  content: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
  metadata?: {
    pageNumber?: number;
  };
}

@Injectable()
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;

  constructor() {
    // Можно получить из конфига, пока хардкод
    this.chunkSize = parseInt(process.env.CHUNK_SIZE || '1000');
    this.chunkOverlap = parseInt(process.env.CHUNK_OVERLAP || '200');
  }

  /**
   * Извлекает текст из файла в зависимости от его типа
   */
  async extractTextFromFile(filePath: string, mimetype: string): Promise<string> {
    try {
      if (mimetype === 'application/pdf') {
        return await this.extractTextFromPDF(filePath);
      } else if (
        mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimetype === 'application/msword'
      ) {
        return await this.extractTextFromDOCX(filePath);
      } else if (mimetype === 'text/plain') {
        return await this.extractTextFromTXT(filePath);
      } else {
        throw new Error(`Unsupported file type: ${mimetype}`);
      }
    } catch (error) {
      this.logger.error(`Error extracting text from file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Извлекает текст из PDF файла
   */
  private async extractTextFromPDF(filePath: string): Promise<string> {
    try {
      // Динамический импорт для избежания проблем с загрузкой модуля при старте приложения
      // Используем require динамически, чтобы модуль загружался только при необходимости
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      return data.text;
    } catch (error) {
      this.logger.error(`Error parsing PDF file ${filePath}:`, error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }

  /**
   * Извлекает текст из DOCX файла
   */
  private async extractTextFromDOCX(filePath: string): Promise<string> {
    const dataBuffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer: dataBuffer });
    return result.value;
  }

  /**
   * Извлекает текст из TXT файла
   */
  private async extractTextFromTXT(filePath: string): Promise<string> {
    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * Разбивает текст на чанки с перекрытием
   */
  chunkText(text: string, metadata?: Record<string, any>): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    
    if (!text || text.trim().length === 0) {
      return chunks;
    }

    // Разбиваем текст на предложения для более умного чанкинга
    const sentences = this.splitIntoSentences(text);
    
    let currentChunk = '';
    let startChar = 0;
    let chunkIndex = 0;
    let currentStartChar = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;

      // Если добавление предложения превышает размер чанка
      if (potentialChunk.length > this.chunkSize && currentChunk.length > 0) {
        // Сохраняем текущий чанк
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          startChar: currentStartChar,
          endChar: startChar + currentChunk.length,
          metadata,
        });

        // Начинаем новый чанк с перекрытием
        const overlapText = this.getOverlapText(currentChunk, this.chunkOverlap);
        currentChunk = overlapText + sentence;
        currentStartChar = startChar + currentChunk.length - overlapText.length - sentence.length;
      } else {
        currentChunk = potentialChunk;
      }

      startChar += sentence.length + (currentChunk.length > sentence.length ? 1 : 0);
    }

    // Добавляем последний чанк если он есть
    if (currentChunk.trim().length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        startChar: currentStartChar,
        endChar: startChar,
        metadata,
      });
    }

    return chunks;
  }

  /**
   * Разбивает текст на предложения
   */
  private splitIntoSentences(text: string): string[] {
    // Простое разбиение по точкам, восклицательным и вопросительным знакам
    // Можно улучшить с помощью более сложной логики
    const sentences = text
      .split(/([.!?]+[\s\n]+)/)
      .filter(s => s.trim().length > 0)
      .map((s, i, arr) => {
        if (i < arr.length - 1 && /[.!?]+/.test(s)) {
          return s + arr[i + 1];
        }
        return s;
      })
      .filter(s => s.trim().length > 0);

    // Если разбиение не сработало, используем простой подход по символам
    if (sentences.length === 0) {
      return [text];
    }

    return sentences;
  }

  /**
   * Получает текст для перекрытия из конца чанка
   */
  private getOverlapText(chunk: string, overlapSize: number): string {
    if (chunk.length <= overlapSize) {
      return chunk;
    }

    const overlapEnd = chunk.length;
    const overlapStart = Math.max(0, overlapEnd - overlapSize);
    
    // Пытаемся начать перекрытие с начала предложения
    let start = overlapStart;
    for (let i = overlapStart; i >= 0; i--) {
      if (chunk[i] === '.' || chunk[i] === '!' || chunk[i] === '?') {
        start = i + 1;
        break;
      }
    }

    return chunk.substring(start).trim();
  }

  /**
   * Обрабатывает файл: извлекает текст и разбивает на чанки
   */
  async processFile(filePath: string, mimetype: string): Promise<DocumentChunk[]> {
    const text = await this.extractTextFromFile(filePath, mimetype);
    return this.chunkText(text);
  }
}

