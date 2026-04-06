import { UserEntity } from '../../user/entities/user.entity';

export class TrainerBookingEntity {
  id!: string;
  memberId!: string;
  trainerId!: string;
  startAt!: Date;
  endAt!: Date;
  status!: string;
  price!: number;
  currency!: string;
  paymentId?: string | null;
  notes?: string | null;
  cancelledAt?: Date | null;
  cancelReason?: string | null;
  rescheduledFromBookingId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  member?: UserEntity | null;
  trainer?: UserEntity | null;
}

