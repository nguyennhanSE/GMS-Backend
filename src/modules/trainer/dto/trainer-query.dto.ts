import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';
import { trim } from 'src/utils/helper';

export class GetTrainersQueryDto {
    @ApiPropertyOptional({
        description: 'Page number for pagination (starts at 1)',
        example: '1',
        type: String
    })
    @IsOptional()
    @IsString()
    page?: string;

    @ApiPropertyOptional({
        description: 'Number of items per page',
        example: '10',
        type: String
    })
    @IsOptional()
    @IsString()
    limit?: string;

    @ApiPropertyOptional({
        description: 'Sort order',
        example: 'asc',
        enum: ['asc', 'desc']
    })
    @IsOptional()
    @IsString()
    sort?: 'asc' | 'desc';

    @ApiPropertyOptional({
        description: 'Field to sort by',
        example: 'createdAt',
        type: String
    })
    @IsOptional()
    @IsString()
    sortBy?: string;

    @ApiPropertyOptional({
        description: 'Whether to include total count in response',
        example: true,
        type: Boolean
    })
    @IsOptional()
    @Transform(({ value }) => {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return value;
    })
    @IsBoolean()
    counted?: boolean;

    @ApiPropertyOptional({
        description: 'Search query string (searches in firstName/lastName/email by default)',
        example: 'john',
        type: String
    })
    @IsOptional()
    @IsString()
    @trim()
    q?: string;

    @ApiPropertyOptional({
        description: 'Filter by specific email address',
        example: 'trainer@example.com',
        type: String
    })
    @IsOptional()
    @IsEmail()
    email?: string;

    @ApiPropertyOptional({
        description: 'Specific field to search in (e.g., "firstName", "lastName", "email"). If provided, search query will only search in this field',
        example: 'firstName',
        type: String
    })
    @IsOptional()
    @IsString()
    @trim()
    searchField?: string;
}
