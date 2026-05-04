import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class ChangeMembershipPlanDto {
  @ApiProperty({
    example: '11111111-2222-3333-4444-555555555555',
    description: 'Target membership tier ID for the plan change checkout',
  })
  @IsUUID()
  @IsNotEmpty()
  targetMembershipId: string;
}
