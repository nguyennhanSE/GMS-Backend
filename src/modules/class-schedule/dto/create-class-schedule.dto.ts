import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, MaxLength, IsDate } from "class-validator";
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
    @Transform(({ value }) => new Date(value || ''))
    classStartTime!: Date;

    @ApiProperty({
        description: 'Class schedule end time',
        example: '2025-01-01T10:00:00Z',
    })
    @IsDate()
    @IsNotEmpty()
    @Transform(({ value }) => new Date(value || ''))
    classEndTime!: Date;
}
