import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, MaxLength, IsDate, IsUUID } from "class-validator";
import { Transform } from "class-transformer";
import { trim } from "src/utils/helper";

export class CreateClassScheduleDto {
    @ApiProperty({
        description: 'Class schedule name',
        example: 'Morning Yoga',
        maxLength: 255
    })
    @IsString()
    @IsNotEmpty()
    @Transform(({ value }) => value?.trim())
    @MaxLength(255)
    name!: string;

    @ApiPropertyOptional({
        description: 'Class schedule description',
        example: 'A relaxing morning yoga class for all levels',
        maxLength: 1000
    })
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    @MaxLength(1000)
    description?: string;

    @ApiProperty({
        description: 'Class schedule start time',
        example: '2025-01-01T09:00:00Z',
    })
    @IsDate()
    @IsNotEmpty()
    @Transform(({ value }) => {
        if (!value) return new Date();
        return new Date(String(value));
    })
    classStartTime!: Date;

    @ApiProperty({
        description: 'Class schedule end time',
        example: '2025-01-01T10:00:00Z',
    })
    @IsDate()
    @IsNotEmpty()
    @Transform(({ value }) => {
        if (!value) return new Date();
        return new Date(String(value));
    })
    classEndTime!: Date;

    @ApiPropertyOptional({
        description: 'Trainer ID (optional)',
        example: '123e4567-e89b-12d3-a456-426614174000',
        format: 'uuid'
    })
    @IsOptional()
    @IsUUID()
    trainerId?: string;
}
