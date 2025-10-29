import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class MessageDto {
  @IsString()
  @IsNotEmpty()
  role: string;

  @IsString()
  @IsNotEmpty()
  content: string;
}

export class ChatRequestDto {
  @IsString()
  @IsNotEmpty()
  provider: 'gemini' | 'custom';

  @IsString()
  @IsNotEmpty()
  model: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages: MessageDto[];

  @IsOptional()
  @IsString()
  systemPrompt?: string;
}

export class ChatResponseDto {
  @IsString()
  content: string;

  @IsOptional()
  stats?: {
    model: string;
    promptTokens?: number;
    responseTokens?: number;
    totalTokens?: number;
  };
}

export class ModelsListDto {
  @IsArray()
  @IsString({ each: true })
  models: string[];
}
