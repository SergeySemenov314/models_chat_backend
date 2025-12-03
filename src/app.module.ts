import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { ChatModule } from './chat/chat.module';
import { FilesModule } from './files/files.module';
import { RagModule } from './rag/rag.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        // Используем переменную окружения или дефолтное значение для Docker
        const mongoHost = configService.get<string>('MONGO_HOST', 'mongodb');
        const mongoPort = configService.get<string>('MONGO_PORT', '27017');
        const mongoDb = configService.get<string>('MONGO_DB', 'app');
        const mongoUri = configService.get<string>('MONGO_URI') || `mongodb://${mongoHost}:${mongoPort}/${mongoDb}`;
        
        return {
          uri: mongoUri,
        };
      },
      inject: [ConfigService],
    }),
    UsersModule,
    ChatModule,
    FilesModule,
    RagModule,
  ],
})
export class AppModule {} 