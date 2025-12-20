import { JsonValue } from "@prisma/client/runtime/client";
import { UserEntity } from "src/modules/user/entities/user.entity";

export class TrainerEntity extends UserEntity {
    trainerAvailableTime: JsonValue | null;
    trainerAvailableDays: string[] | null;
}