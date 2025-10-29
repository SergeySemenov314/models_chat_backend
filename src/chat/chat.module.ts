import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { GeminiService } from './services/gemini.service';
import { CustomService } from './services/custom.service';

@Module({
  imports: [ConfigModule],
  controllers: [ChatController],
  providers: [ChatService, GeminiService, CustomService],
  exports: [ChatService],
})
export class ChatModule {}
