import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaymentTargetType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCheckoutDto {
  @ApiProperty({ enum: PaymentTargetType, example: 'CLASS_BOOKING' })
  @IsEnum(PaymentTargetType)
  @IsNotEmpty()
  targetType: PaymentTargetType;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  @IsNotEmpty()
  targetId: string;

  @ApiProperty({
    example: 50000,
    description: 'Amount in smallest currency unit',
  })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({ example: 'VND', required: false, default: 'VND' })
  @IsOptional()
  @IsString()
  currency?: string = 'VND';
}
