import { IsString, IsOptional } from 'class-validator';

export class UploadFileDto {
  @IsString()
  @IsOptional()
  description?: string;
}
