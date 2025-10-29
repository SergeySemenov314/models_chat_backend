import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FileDocument } from './file.schema';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FilesService {
  constructor(
    @InjectModel(FileDocument.name) private fileModel: Model<FileDocument>
  ) {}

  async uploadFile(file: Express.Multer.File): Promise<FileDocument> {
    const fileDoc = new this.fileModel({
      originalName: file.originalname,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
      path: file.path,
    });

    return fileDoc.save();
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
    
    // Удаляем физический файл
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (error) {
      console.error('Ошибка удаления физического файла:', error);
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
