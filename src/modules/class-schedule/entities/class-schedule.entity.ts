import { ClassBookingEntity } from "src/modules/class-booking/entities/class-booking.entity";

export class ClassScheduleEntity {
    id!: string;
    name!: string;
    description!: string;
    createdAt?: Date | null;
    updatedAt?: Date | null;
    classStartTime?: Date | null;
    classEndTime?: Date | null; 
    trainerId?: string | null;

    classBookings?: ClassBookingEntity[];
    trainer?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    } | null;
}
