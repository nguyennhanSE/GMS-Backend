import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsBoolean, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetClassBookingsQueryDto {
  @ApiPropertyOptional({
    description: 'Page number',
    example: '1',
    default: '1',
  })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: '10',
    default: '10',
  })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'desc',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Whether to include total count',
    example: true,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  counted?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by user ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Filter by class schedule ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  classScheduleId?: string;

  @ApiPropertyOptional({
    description: 'Filter by booking status',
    example: 'confirmed',
    enum: ['pending', 'confirmed', 'cancelled', 'attended', 'no_show'],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Search query text',
    example: 'yoga',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: 'Specific field to search in',
    example: 'name',
  })
  @IsOptional()
  @IsString()
  searchField?: string;
}
