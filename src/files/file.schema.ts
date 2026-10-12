import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class FileDocument extends Document {
  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  filename: string;

  @Prop({ required: true })
  mimetype: string;

  @Prop({ required: true })
  size: number;

  @Prop({ required: true })
  path: string;

  @Prop({ default: Date.now })
  uploadedAt: Date;

  @Prop()
  indexStatus?: 'pending' | 'ready' | 'failed' | 'unsupported' | 'disabled';

  @Prop({ default: false })
  isPreloaded?: boolean;

  @Prop()
  seedKey?: string;

  @Prop()
  seedChecksum?: string;
}

export const FileSchema = SchemaFactory.createForClass(FileDocument);
