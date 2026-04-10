import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendTrainerMessageDto {
  @ApiProperty({
    description: 'Plain text message content',
    example: 'Can we move our session to later this week?',
    maxLength: 2000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}
