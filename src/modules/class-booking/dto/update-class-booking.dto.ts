import { PartialType } from '@nestjs/swagger';
import { CreateClassBookingDto } from './create-class-booking.dto';

export class UpdateClassBookingDto extends PartialType(CreateClassBookingDto) {}
