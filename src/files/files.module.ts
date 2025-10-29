import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileDocument, FileSchema } from './file.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: FileDocument.name, schema: FileSchema }])
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService]
})
export class FilesModule {}
