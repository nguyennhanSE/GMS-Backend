import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsOptional, IsString } from 'class-validator';

export class GetNotificationsQueryDto {
  @ApiPropertyOptional({
    description: 'Page number',
    example: '1',
  })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({
    description: 'Page size',
    example: '10',
  })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({
    description: 'Return unread notifications only',
    example: 'true',
  })
  @IsOptional()
  @IsBooleanString()
  unreadOnly?: string;
}
