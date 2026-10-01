import { IsString, MaxLength } from 'class-validator';

export class PresignedUrlDto {
  @IsString()
  @MaxLength(255, { message: 'El nombre del archivo es demasiado largo' })
  fileName: string;

  @IsString()
  contentType: string;
}
