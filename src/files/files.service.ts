import { Injectable, NotFoundException, ForbiddenException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FileDocument } from './file.schema';
import { RagService } from '../rag/services/rag.service';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const PRELOADED_FILES = [
  {
    key: 'ai',
    originalName: 'Text about AI.docx',
    filename: 'preloaded-text-about-ai.docx',
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  {
    key: 'rag',
    originalName: 'text about RAG.txt',
    filename: 'preloaded-text-about-rag.txt',
    mimetype: 'text/plain',
  },
] as const;

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectModel(FileDocument.name) private fileModel: Model<FileDocument>,
    private readonly ragService: RagService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Фоновые задачи предыдущего процесса не переживают перезапуск контейнера.
    await this.fileModel.updateMany(
      { indexStatus: 'pending' },
      { $set: { indexStatus: 'failed' } },
    ).exec();

    for (const seed of PRELOADED_FILES) {
      await this.ensurePreloadedFile(seed);
    }
  }

  private async ensurePreloadedFile(seed: typeof PRELOADED_FILES[number]): Promise<void> {
    const sourcePath = path.join(process.cwd(), 'seed-documents', seed.originalName);
    const source = fs.readFileSync(sourcePath);
    const checksum = createHash('sha256').update(source).digest('hex');
    const uploadsPath = path.join(process.cwd(), 'uploads');
    fs.mkdirSync(uploadsPath, { recursive: true });
    const targetPath = path.join(uploadsPath, seed.filename);
    const targetChecksum = fs.existsSync(targetPath)
      ? createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex')
      : '';
    if (targetChecksum !== checksum) {
      fs.copyFileSync(sourcePath, targetPath);
    }

    let file = await this.fileModel.findOne({ seedKey: seed.key }).exec();
    if (!file) {
      file = await this.fileModel.findOne({ originalName: seed.originalName })
        .sort({ uploadedAt: 1 }).exec();
    }

    const needsIndex = !file || file.seedChecksum !== checksum || file.indexStatus !== 'ready';
    if (!file) {
      file = new this.fileModel({ uploadedAt: new Date() });
    }
    file.originalName = seed.originalName;
    file.filename = seed.filename;
    file.mimetype = seed.mimetype;
    file.size = source.length;
    file.path = targetPath;
    file.isPreloaded = true;
    file.seedKey = seed.key;
    file.seedChecksum = checksum;

    if (!this.ragService.isEnabled()) {
      file.indexStatus = 'disabled';
      await file.save();
      return;
    }

    await file.save();
    let indexed = false;
    if (!needsIndex) {
      try {
        indexed = await this.ragService.hasIndexedFile(file._id.toString());
      } catch (error) {
        this.logger.warn(`Could not verify index for ${seed.originalName}: ${error}`);
      }
    }
    if (needsIndex || !indexed) {
      await this.reindexFile(file._id.toString());
    }
  }

  async uploadFile(file: Express.Multer.File): Promise<FileDocument> {
    const fileDoc = new this.fileModel({
      originalName: file.originalname,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
      path: file.path,
      indexStatus: 'pending',
    });

    const savedFile = await fileDoc.save();

    // Индексация может быть долгой: статус сохраняется после её завершения.
    void this.indexFileForRag(savedFile)
      .then(async status => {
        savedFile.indexStatus = status;
        await savedFile.save();
      })
      .catch(error => this.logger.error(`Failed to save index status for ${savedFile._id}:`, error));

    return savedFile;
  }

  /**
   * Индексирует файл для RAG
   */
  private async indexFileForRag(file: FileDocument): Promise<FileDocument['indexStatus']> {
    try {
      // Проверяем, поддерживается ли тип файла для RAG
      const supportedTypes = [
        'application/pdf',
        'text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ];

      if (!supportedTypes.includes(file.mimetype)) {
        this.logger.log(`File type ${file.mimetype} not supported for RAG indexing, skipping`);
        return 'unsupported';
      }

      if (!this.ragService.isEnabled()) {
        return 'disabled';
      }

      await this.ragService.indexFile(
        file._id.toString(),
        file.path,
        file.mimetype,
        file.originalName
      );
      return 'ready';
    } catch (error) {
      this.logger.error(`Error indexing file ${file._id}:`, error);
      return 'failed';
    }
  }

  async getAllFiles(): Promise<FileDocument[]> {
    return this.fileModel.find().sort({ isPreloaded: -1, uploadedAt: -1 }).exec();
  }

  async getFileById(id: string): Promise<FileDocument> {
    const file = await this.fileModel.findById(id).exec();
    if (!file) {
      throw new NotFoundException('Файл не найден');
    }
    return file;
  }

  async reindexFile(id: string): Promise<FileDocument> {
    const file = await this.getFileById(id);
    if (!fs.existsSync(file.path)) {
      throw new NotFoundException('Файл отсутствует на сервере. Загрузите его повторно.');
    }

    file.indexStatus = 'pending';
    await file.save();

    void (async () => {
      try {
        await this.ragService.deleteFileIndex(id);
        file.indexStatus = await this.indexFileForRag(file);
      } catch (error) {
        this.logger.error(`Failed to reindex file ${id}:`, error);
        file.indexStatus = 'failed';
      }
      await file.save();
    })().catch(error => this.logger.error(`Failed to save reindex status for ${id}:`, error));

    return file;
  }

  async deleteFile(id: string): Promise<void> {
    const file = await this.getFileById(id);
    if (file.isPreloaded) {
      throw new ForbiddenException('Предзагруженный файл нельзя удалить');
    }
    
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
