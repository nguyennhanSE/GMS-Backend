import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsArray, IsObject, IsString } from "class-validator";
import { CreateUserDto } from "src/modules/user/dto/user.dto";

export class CreateTrainerDto extends CreateUserDto {
    @ApiProperty({
        description: 'Trainer available time',
        example: [{ startTime: '09:00', endTime: '10:00' }],
    })
    @IsOptional()
    @IsArray()
    @IsObject({ each: true })
    trainerAvailableTime?: Record<string, any>[];

    @ApiProperty({
        description: 'Trainer available days',
        example: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    trainerAvailableDays?: string[];
}