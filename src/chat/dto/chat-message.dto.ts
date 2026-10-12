import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateNested, IsEnum, IsBoolean } from 'class-validator';
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
  @IsOptional()
  @IsString()
  model?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages: MessageDto[];
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

  @IsOptional()
  sources?: Array<{
    document: string;
    similarity: number;
  }>;

  @IsOptional()
  @IsString()
  fileSearchWarning?: string;
}

export class ModelsListDto {
  @IsArray()
  @IsString({ each: true })
  models: string[];
}
