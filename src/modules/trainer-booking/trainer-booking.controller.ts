import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../libs/decorator/current-user.decorator';
import type { RequestUser } from '../../libs/decorator/current-user.decorator';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ResponseModel } from '../../libs/models/response/response.model';
import { ERoleName } from '../roles/enums/role.enum';
import { CreateTrainerBookingDto } from './dto/create-trainer-booking.dto';
import { TrainerBookingActionDto } from './dto/trainer-booking-action.dto';
import {
  TrainerBookingSlotsQueryDto,
  TrainerBookingTrainerQueryDto,
} from './dto/trainer-booking-query.dto';
import { toTrainerBookingResponse } from './mapper/trainer-booking.mapper';
import { TrainerBookingService } from './trainer-booking.service';

@ApiTags('Trainer Booking')
@ApiBearerAuth()
@Controller('trainer-bookings')
export class TrainerBookingController {
  constructor(
    private readonly trainerBookingService: TrainerBookingService,
  ) {}

  @Get('trainers')
  @Roles(
    ERoleName.ADMIN,
    ERoleName.STAFF,
    ERoleName.TRAINER,
    ERoleName.MEMBER,
  )
  @ApiOperation({ summary: 'List trainers available for trainer booking' })
  async listTrainers(
    @Query() query: TrainerBookingTrainerQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    const response = new ResponseModel();
    const result = await this.trainerBookingService.listBookableTrainers(
      query,
      user,
    );
    response.setData(result);
    return response;
  }

  @Get('trainers/:trainerId')
  @Roles(
    ERoleName.ADMIN,
    ERoleName.STAFF,
    ERoleName.TRAINER,
    ERoleName.MEMBER,
  )
  @ApiOperation({ summary: 'Get trainer booking profile details' })
  async getTrainer(
    @Param('trainerId', ParseUUIDPipe) trainerId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const response = new ResponseModel();
    const result = await this.trainerBookingService.getTrainerProfile(
      trainerId,
      user.sub,
    );
    response.setData(result);
    return response;
  }

  @Get('trainers/:trainerId/slots')
  @Roles(
    ERoleName.ADMIN,
    ERoleName.STAFF,
    ERoleName.TRAINER,
    ERoleName.MEMBER,
  )
  @ApiOperation({ summary: 'Get bookable slots for a trainer' })
  async getTrainerSlots(
    @Param('trainerId', ParseUUIDPipe) trainerId: string,
    @Query() query: TrainerBookingSlotsQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    const response = new ResponseModel();
    const result = await this.trainerBookingService.getTrainerSlots(
      trainerId,
      query,
      user,
    );
    response.setData(result);
    return response;
  }

  @Post()
  @Roles(ERoleName.MEMBER)
  @ApiOperation({ summary: 'Create a trainer booking request' })
  @ApiResponse({ status: 201, description: 'Trainer booking request created' })
  @ApiResponse({
    status: 403,
    description: 'Active membership required to create trainer booking',
  })
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateTrainerBookingDto,
  ) {
    const response = new ResponseModel();
    const result = await this.trainerBookingService.create(user.sub, dto);
    response.setData(toTrainerBookingResponse(result));
    return response;
  }

  @Get('me')
  @Roles(ERoleName.MEMBER)
  @ApiOperation({ summary: 'List trainer bookings for current member' })
  async getMine(@CurrentUser() user: RequestUser) {
    const response = new ResponseModel();
    const result = await this.trainerBookingService.findMine(user.sub);
    response.setData(result.map(toTrainerBookingResponse));
    return response;
  }

  @Get('trainer/me')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'List trainer bookings assigned to current trainer' })
  async getTrainerMine(@CurrentUser() user: RequestUser) {
    const response = new ResponseModel();
    const result = await this.trainerBookingService.findTrainerMine(user.sub);
    response.setData(result.map(toTrainerBookingResponse));
    return response;
  }

  @Post(':id/accept')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'Accept a pending trainer booking request' })
  async accept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const response = new ResponseModel();
    const result = await this.trainerBookingService.accept(id, user.sub);
    response.setData(toTrainerBookingResponse(result));
    return response;
  }

  @Post(':id/reject')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'Reject a pending trainer booking request' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: TrainerBookingActionDto,
  ) {
    const response = new ResponseModel();
    const result = await this.trainerBookingService.reject(id, user.sub, dto);
    response.setData(toTrainerBookingResponse(result));
    return response;
  }

  @Get(':id')
  @Roles(
    ERoleName.ADMIN,
    ERoleName.STAFF,
    ERoleName.TRAINER,
    ERoleName.MEMBER,
  )
  @ApiOperation({ summary: 'Get trainer booking details' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const response = new ResponseModel();
    const result = await this.trainerBookingService.findOneAuthorized(id, user);
    response.setData(toTrainerBookingResponse(result));
    return response;
  }

  @Post(':id/cancel')
  @Roles(
    ERoleName.ADMIN,
    ERoleName.STAFF,
    ERoleName.TRAINER,
    ERoleName.MEMBER,
  )
  @ApiOperation({ summary: 'Cancel an eligible trainer booking' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: TrainerBookingActionDto,
  ) {
    const response = new ResponseModel();
    const result = await this.trainerBookingService.cancel(id, user, dto);
    response.setData(toTrainerBookingResponse(result));
    return response;
  }

  @Post(':id/complete')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF, ERoleName.TRAINER)
  @ApiOperation({ summary: 'Mark a confirmed trainer booking as completed' })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const response = new ResponseModel();
    const result = await this.trainerBookingService.complete(id, user);
    response.setData(toTrainerBookingResponse(result));
    return response;
  }
}
