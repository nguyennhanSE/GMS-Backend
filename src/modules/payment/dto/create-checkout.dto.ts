import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaymentTargetType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCheckoutDto {
  @ApiProperty({ enum: PaymentTargetType, example: 'CLASS_BOOKING' })
  @IsEnum(PaymentTargetType)
  @IsNotEmpty()
  targetType: PaymentTargetType;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  @IsNotEmpty()
  targetId: string;

  @ApiPropertyOptional({
    example: 50000,
    description:
      'Amount in smallest currency unit. Optional for TRAINER_BOOKING because the server derives it from the booking.',
  })
  @ValidateIf(
    (dto: CreateCheckoutDto) =>
      dto.targetType !== PaymentTargetType.TRAINER_BOOKING ||
      dto.amount !== undefined,
  )
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiProperty({ example: 'VND', required: false, default: 'VND' })
  @IsOptional()
  @IsString()
  currency?: string = 'VND';
}
