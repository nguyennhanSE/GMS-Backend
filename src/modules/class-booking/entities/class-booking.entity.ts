import { ClassScheduleEntity } from "src/modules/class-schedule/entities/class-schedule.entity";
import { UserEntity } from "src/modules/user/entities/user.entity";

export class ClassBookingEntity {
    id!: string;
    userId!: string;
    classScheduleId!: string;
    bookingStartDate!: Date;
    bookingEndDate!: Date;
    status!: string;
    createdAt?: Date | null;
    updatedAt?: Date | null;

    user?: UserEntity | null;
    classSchedule?: ClassScheduleEntity | null;
}
