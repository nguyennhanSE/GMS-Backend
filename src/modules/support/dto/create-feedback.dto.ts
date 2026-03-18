import { IsString, IsNotEmpty } from 'class-validator';

export class CreateFeedbackDto {
  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}
