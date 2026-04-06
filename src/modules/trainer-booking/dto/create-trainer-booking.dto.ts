import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTrainerBookingDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  trainerId!: string;

  @ApiProperty({ example: '2026-04-10T09:00:00.000Z', type: Date })
  @Type(() => Date)
  @IsDate()
  @IsNotEmpty()
  startAt!: Date;

  @ApiProperty({ example: '2026-04-10T10:00:00.000Z', type: Date })
  @Type(() => Date)
  @IsDate()
  @IsNotEmpty()
  endAt!: Date;

  @ApiPropertyOptional({ example: 'Focus on deadlift form' })
  @IsOptional()
  @IsString()
  notes?: string;
}

