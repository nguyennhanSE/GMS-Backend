import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendChatMessageDto {
  @ApiProperty({
    description: 'Member message to the chatbot',
    example: 'What classes do I have booked?',
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message!: string;
}
