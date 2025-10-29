import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Включаем CORS для фронтенда
  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:80', 'http://localhost'],
    credentials: true,
  });
  
  // Глобальная валидация
  app.useGlobalPipes(new ValidationPipe());
  
  await app.listen(3001);
  console.log('Backend server is running on http://localhost:3001');
}
bootstrap(); 