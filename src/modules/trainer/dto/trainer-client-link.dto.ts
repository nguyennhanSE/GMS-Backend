import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateTrainerClientLinkDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  @IsUUID()
  @IsNotEmpty()
  memberId!: string;
}

export class EndTrainerClientLinkDto {
  @ApiPropertyOptional({ example: 'Client moved to another coach' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  endReason?: string;
}
