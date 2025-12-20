import { ApiProperty, PartialType } from '@nestjs/swagger';
import { UpdateUserDto } from 'src/modules/user/dto/user.dto';
import { IsOptional, IsArray, IsObject, IsString } from 'class-validator';
import { JsonValue } from '@prisma/client/runtime/client';

export class UpdateTrainerDto extends PartialType(UpdateUserDto) {
    @ApiProperty({
        description: 'Trainer available time',
        example: [{ startTime: '09:00', endTime: '10:00' }],
    })
    @IsOptional()
    @IsArray()
    @IsObject({ each: true })
    trainerAvailableTime?: JsonValue[];

    @ApiProperty({
        description: 'Trainer available days',
        example: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    trainerAvailableDays?: string[];
}