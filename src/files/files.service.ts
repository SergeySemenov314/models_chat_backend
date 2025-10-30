import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FileDocument } from './file.schema';
import { RagService } from '../rag/services/rag.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectModel(FileDocument.name) private fileModel: Model<FileDocument>,
    private readonly ragService: RagService,
  ) {}

  async uploadFile(file: Express.Multer.File): Promise<FileDocument> {
    const fileDoc = new this.fileModel({
      originalName: file.originalname,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
      path: file.path,
    });

    const savedFile = await fileDoc.save();

    // Индексируем файл для RAG (асинхронно, не блокируем ответ)
    this.indexFileForRag(savedFile).catch(error => {
      this.logger.error(`Failed to index file ${savedFile._id} for RAG:`, error);
    });

    return savedFile;
  }

  /**
   * Индексирует файл для RAG
   */
  private async indexFileForRag(file: FileDocument): Promise<void> {
    try {
      // Проверяем, поддерживается ли тип файла для RAG
      const supportedTypes = [
        'application/pdf',
        'text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
      ];

      if (!supportedTypes.includes(file.mimetype)) {
        this.logger.log(`File type ${file.mimetype} not supported for RAG indexing, skipping`);
        return;
      }

      await this.ragService.indexFile(
        file._id.toString(),
        file.path,
        file.mimetype,
        file.originalName
      );
    } catch (error) {
      this.logger.error(`Error indexing file ${file._id}:`, error);
      // Не бросаем ошибку, чтобы не помешать загрузке файла
    }
  }

  async getAllFiles(): Promise<FileDocument[]> {
    return this.fileModel.find().sort({ uploadedAt: -1 }).exec();
  }

  async getFileById(id: string): Promise<FileDocument> {
    const file = await this.fileModel.findById(id).exec();
    if (!file) {
      throw new NotFoundException('Файл не найден');
    }
    return file;
  }

  async deleteFile(id: string): Promise<void> {
    const file = await this.getFileById(id);
    
    // Удаляем индекс из RAG (если существует)
    try {
      await this.ragService.deleteFileIndex(id);
    } catch (error) {
      this.logger.error(`Error deleting RAG index for file ${id}:`, error);
      // Продолжаем удаление файла даже если удаление индекса не удалось
    }
    
    // Удаляем физический файл
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (error) {
      this.logger.error('Ошибка удаления физического файла:', error);
    }

    // Удаляем запись из базы данных
    await this.fileModel.findByIdAndDelete(id).exec();
  }

  async getFileStats(): Promise<{ totalFiles: number; totalSize: number }> {
    const files = await this.fileModel.find().exec();
    const totalFiles = files.length;
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    
    return { totalFiles, totalSize };
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
