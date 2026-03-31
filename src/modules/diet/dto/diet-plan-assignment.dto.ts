import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DietPlanAssignmentStatus } from '@prisma/client';

export class CreateDietPlanAssignmentItemDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  @IsUUID()
  @IsNotEmpty()
  memberId!: string;

  @ApiProperty({ example: '2026-03-31' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2026-04-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveTo?: string;
}

export class CreateDietPlanAssignmentsDto {
  @ApiProperty({ type: [CreateDietPlanAssignmentItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDietPlanAssignmentItemDto)
  assignments!: CreateDietPlanAssignmentItemDto[];
}

export enum DietPlanAssignmentTerminalStatusDto {
  ENDED = 'ENDED',
  REMOVED = 'REMOVED',
}

export class UpdateDietPlanAssignmentDto {
  @ApiProperty({
    enum: DietPlanAssignmentTerminalStatusDto,
    example: DietPlanAssignmentTerminalStatusDto.ENDED,
  })
  @IsEnum(DietPlanAssignmentTerminalStatusDto)
  status!: DietPlanAssignmentTerminalStatusDto;

  @ApiPropertyOptional({ example: '2026-03-31' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveTo?: string;

  @ApiPropertyOptional({ example: 'Nutrition block completed successfully' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  endReason?: string;
}
