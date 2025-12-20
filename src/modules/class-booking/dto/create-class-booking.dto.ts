import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsDate, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { Type } from "class-transformer";


export class CreateClassBookingBaseDto {
    @ApiProperty({
        description: 'User ID who is booking the class',
        example: '123e4567-e89b-12d3-a456-426614174000',
        format: 'uuid'
    })
    @IsUUID()
    @IsNotEmpty()
    userId!: string;

    @ApiProperty({
        description: 'Booking start date',
        example: '2025-01-01',
        type: Date
    })
    @Type(() => Date)
    @IsDate()
    @IsNotEmpty()
    bookingStartDate?: Date;

    @ApiProperty({
        description: 'Booking end date',
        example: '2025-01-31',
        type: Date
    })
    @Type(() => Date)
    @IsDate()
    @IsNotEmpty()
    bookingEndDate?: Date;

    @ApiPropertyOptional({
        description: 'Booking status',
        example: 'confirmed',
        maxLength: 50
    })
    @IsOptional()
    @IsString()
    @MaxLength(50)
    status?: string;
}
export class CreateClassBookingDto extends CreateClassBookingBaseDto {
    @ApiProperty({
        description: 'Class Schedule ID being booked',
        example: '123e4567-e89b-12d3-a456-426614174001',
        format: 'uuid'
    })
    @IsUUID()
    @IsNotEmpty()
    classScheduleId!: string;
}

export class CreateMultipleClassBookingDto extends CreateClassBookingBaseDto {
    @ApiProperty({
        description: 'Class Schedule IDs being booked',
        example: ['123e4567-e89b-12d3-a456-426614174001', '123e4567-e89b-12d3-a456-426614174002'],
    })
    @IsArray()
    @IsNotEmpty()
    classScheduleId!: string[];
}
