import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateTrainerConversationDto {
  @ApiProperty({
    description: 'The opposite participant in the trainer-member conversation',
    example: 'df7b6f79-4d34-495e-9ce9-0e47779f4ff0',
  })
  @IsUUID()
  partnerId!: string;
}
