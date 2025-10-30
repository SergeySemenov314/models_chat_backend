import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DocumentProcessorService } from './services/document-processor.service';
import { EmbeddingService } from './services/embedding.service';
import { VectorStoreService } from './services/vector-store.service';
import { RagService } from './services/rag.service';

@Module({
  imports: [ConfigModule],
  providers: [
    DocumentProcessorService,
    EmbeddingService,
    VectorStoreService,
    RagService,
  ],
  exports: [RagService],
})
export class RagModule {}



