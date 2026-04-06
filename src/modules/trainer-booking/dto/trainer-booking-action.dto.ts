import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TrainerBookingActionDto {
  @ApiPropertyOptional({ example: 'Trainer unavailable due to event' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

