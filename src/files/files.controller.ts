import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { FilesService } from './files.service';
import { UploadFileDto } from './dto/upload-file.dto';
import * as fs from 'fs';

// Настройка хранения файлов
const storage = diskStorage({
  destination: './uploads',
  filename: (req, file, callback) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = extname(file.originalname);
    callback(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

@Controller('api/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {
    // Создаем папку uploads если её нет
    if (!fs.existsSync('./uploads')) {
      fs.mkdirSync('./uploads', { recursive: true });
    }
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage,
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB максимум
      },
      fileFilter: (req, file, callback) => {
        // Разрешенные типы файлов
        const allowedMimes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'application/pdf',
          'text/plain',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ];

        if (allowedMimes.includes(file.mimetype)) {
          callback(null, true);
        } else {
          callback(new BadRequestException('Неподдерживаемый тип файла'), false);
        }
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() uploadFileDto: UploadFileDto,
  ) {
    if (!file) {
      throw new BadRequestException('Файл не был загружен');
    }

    const savedFile = await this.filesService.uploadFile(file);
    
    return {
      message: 'Файл успешно загружен',
      file: {
        id: savedFile._id,
        originalName: savedFile.originalName,
        filename: savedFile.filename,
        mimetype: savedFile.mimetype,
        size: savedFile.size,
        formattedSize: this.filesService.formatFileSize(savedFile.size),
        uploadedAt: savedFile.uploadedAt,
        available: fs.existsSync(savedFile.path),
        indexStatus: savedFile.indexStatus,
        isPreloaded: savedFile.isPreloaded || false,
      },
    };
  }

  @Get()
  async getAllFiles() {
    const files = await this.filesService.getAllFiles();
    const stats = await this.filesService.getFileStats();
    
    return {
      files: files.map(file => ({
        id: file._id,
        originalName: file.originalName,
        filename: file.filename,
        mimetype: file.mimetype,
        size: file.size,
        formattedSize: this.filesService.formatFileSize(file.size),
        uploadedAt: file.uploadedAt,
        available: fs.existsSync(file.path),
        indexStatus: fs.existsSync(file.path) ? (file.indexStatus || 'unknown') : 'missing',
        isPreloaded: file.isPreloaded || false,
      })),
      stats: {
        totalFiles: stats.totalFiles,
        totalSize: this.filesService.formatFileSize(stats.totalSize),
      },
    };
  }

  @Get(':id/download')
  async downloadFile(@Param('id') id: string, @Res() res: Response) {
    const file = await this.filesService.getFileById(id);
    
    if (!fs.existsSync(file.path)) {
      throw new NotFoundException('Файл отсутствует на сервере. Загрузите его повторно.');
    }
    res.download(file.path, file.originalName);
  }

  @Post(':id/reindex')
  async reindexFile(@Param('id') id: string) {
    const file = await this.filesService.reindexFile(id);
    return { id: file._id, indexStatus: file.indexStatus };
  }

  @Delete(':id')
  async deleteFile(@Param('id') id: string) {
    await this.filesService.deleteFile(id);
    return { message: 'Файл успешно удален' };
  }

  @Get('stats')
  async getStats() {
    const stats = await this.filesService.getFileStats();
    return {
      totalFiles: stats.totalFiles,
      totalSize: this.filesService.formatFileSize(stats.totalSize),
    };
  }
}
