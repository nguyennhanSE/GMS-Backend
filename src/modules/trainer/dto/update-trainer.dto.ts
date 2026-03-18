import { PartialType } from '@nestjs/swagger';
import { UpdateUserDto } from 'src/modules/user/dto/user.dto';

export class UpdateTrainerDto extends PartialType(UpdateUserDto) {}