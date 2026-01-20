import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsIn } from 'class-validator';

/**
 * DTO for updating a class booking.
 * Only status can be updated - userId, classScheduleId, and dates are immutable.
 */
export class UpdateClassBookingDto {
  @ApiPropertyOptional({
    description: 'Booking status',
    example: 'confirmed',
    enum: ['pending', 'confirmed', 'cancelled', 'attended', 'no-show'],
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @IsIn(['pending', 'confirmed', 'cancelled', 'attended', 'no-show'], {
    message:
      'Status must be one of: pending, confirmed, cancelled, attended, no-show',
  })
  status?: string;
}
