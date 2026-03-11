import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MembershipLevel } from '@prisma/client';

export class CreateMembershipDto {
  @ApiProperty({ example: 'Premium' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Access to all gym facilities', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 500000,
    description: 'Minimum lifetime spend to auto-qualify for this tier',
  })
  @IsInt()
  @Min(0)
  minPrice: number;

  @ApiProperty({
    example: 480000,
    description: 'Price for explicit purchase via Stripe checkout',
  })
  @IsInt()
  @Min(0)
  purchasePrice: number;

  @ApiProperty({ enum: MembershipLevel, example: 'PREMIUM' })
  @IsEnum(MembershipLevel)
  level: MembershipLevel;
}
