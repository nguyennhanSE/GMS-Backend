import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ClassBookingService } from './class-booking.service';
import { CreateMultipleClassBookingDto } from './dto/create-class-booking.dto';
import { UpdateClassBookingDto } from './dto/update-class-booking.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ResponseModel } from '../../libs/models/response/response.model';
import { toResponse } from './mapper/class-booking.mapper';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import { CurrentUser } from '../../libs/decorator/current-user.decorator';
import type { RequestUser } from '../../libs/decorator/current-user.decorator';
import { GetClassBookingsQueryDto } from './dto/class-booking-query.dto';

@ApiTags('Class Booking Management')
@ApiBearerAuth()
@Controller('class-booking')
export class ClassBookingController {
  constructor(private readonly classBookingService: ClassBookingService) {}

  @Post('create')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Create a new class booking (Admin only)' })
  @ApiResponse({
    status: 201,
    description: 'Class booking created successfully',
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad request - validation error, class full, or duplicate booking',
  })
  async create(@Body() createClassBookingDto: CreateMultipleClassBookingDto) {
    const responseModel = new ResponseModel();

    const classBooking = await this.classBookingService.create(
      createClassBookingDto,
    );
    const result = classBooking.map(toResponse);
    responseModel.setData(result);

    return responseModel;
  }

  @Get('list')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF)
  @ApiOperation({ summary: 'Get paginated list of class bookings' })
  @ApiResponse({
    status: 200,
    description: 'Class bookings retrieved successfully',
  })
  async list(@Query() query: GetClassBookingsQueryDto) {
    const responseModel = new ResponseModel();

    const {
      page,
      limit,
      sort,
      sortBy,
      counted,
      userId,
      classScheduleId,
      status,
      q: search,
      searchField,
    } = query;

    const pageNum = page
      ? typeof page === 'string'
        ? parseInt(page, 10)
        : page
      : 1;
    const limitNum = limit
      ? typeof limit === 'string'
        ? parseInt(limit, 10)
        : limit
      : 10;

    const data = await this.classBookingService.findAll(
      {
        page: pageNum,
        limit: limitNum,
        sort: sort || 'desc',
        sortBy: sortBy || 'createdAt',
      },
      { userId, classScheduleId, status, q: search, searchField },
      { counted: counted ?? true },
    );

    const docs = data.docs.map((e) => toResponse(e));

    const result = { ...data, docs };
    responseModel.setData(result);

    return responseModel;
  }

  @Get('my-bookings')
  @Roles(ERoleName.MEMBER, ERoleName.TRAINER, ERoleName.STAFF, ERoleName.ADMIN)
  @ApiOperation({ summary: "Get current user's bookings" })
  @ApiResponse({
    status: 200,
    description: 'User bookings retrieved successfully',
  })
  async getMyBookings(@CurrentUser() user: RequestUser) {
    const responseModel = new ResponseModel();

    const bookings = await this.classBookingService.findByUserId(user.sub);
    const result = bookings.map(toResponse);
    responseModel.setData(result);

    return responseModel;
  }

  @Get('user/:userId')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF)
  @ApiOperation({ summary: 'Get bookings by user ID (Admin/Staff only)' })
  @ApiParam({ name: 'userId', description: 'User UUID', type: String })
  @ApiResponse({
    status: 200,
    description: 'User bookings retrieved successfully',
  })
  async findByUserId(@Param('userId', ParseUUIDPipe) userId: string) {
    const responseModel = new ResponseModel();

    const bookings = await this.classBookingService.findByUserId(userId);
    const result = bookings.map(toResponse);
    responseModel.setData(result);

    return responseModel;
  }

  @Get('class-schedule/:classScheduleId')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF)
  @ApiOperation({ summary: 'Get bookings by class schedule ID' })
  @ApiParam({
    name: 'classScheduleId',
    description: 'Class Schedule UUID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Class schedule bookings retrieved successfully',
  })
  async findByClassScheduleId(
    @Param('classScheduleId', ParseUUIDPipe) classScheduleId: string,
  ) {
    const responseModel = new ResponseModel();

    const bookings =
      await this.classBookingService.findByClassScheduleId(classScheduleId);
    const result = bookings.map(toResponse);
    responseModel.setData(result);

    return responseModel;
  }

  @Post(':id/checkout')
  @Roles(ERoleName.MEMBER)
  @ApiOperation({ summary: 'Initiate payment checkout for a booking' })
  @ApiResponse({ status: 201, description: 'Checkout URL created' })
  @ApiResponse({
    status: 400,
    description: 'Booking not pending or no price set',
  })
  @ApiResponse({ status: 403, description: 'Not your booking' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  @ApiParam({ name: 'id', description: 'Booking UUID', type: String })
  async checkout(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const responseModel = new ResponseModel();
    const result = await this.classBookingService.initiateCheckout(
      id,
      user.sub,
    );
    responseModel.setData(result);
    return responseModel;
  }

  @Get(':id')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF)
  @ApiOperation({ summary: 'Get class booking by ID' })
  @ApiResponse({
    status: 200,
    description: 'Class booking retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Class booking not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const responseModel = new ResponseModel();

    const classBooking = await this.classBookingService.findOne(id);
    const result = toResponse(classBooking);
    responseModel.setData(result);

    return responseModel;
  }

  @Patch(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Update class booking status (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Class booking updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  @ApiResponse({ status: 404, description: 'Class booking not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateClassBookingDto: UpdateClassBookingDto,
  ) {
    const responseModel = new ResponseModel();

    const classBooking = await this.classBookingService.update(
      id,
      updateClassBookingDto,
    );
    const result = toResponse(classBooking);
    responseModel.setData(result);

    return responseModel;
  }

  @Patch(':id/cancel')
  @Roles(ERoleName.ADMIN, ERoleName.MEMBER)
  @ApiOperation({
    summary: 'Cancel a class booking (Members can cancel their own)',
  })
  @ApiResponse({ status: 200, description: 'Booking cancelled successfully' })
  @ApiResponse({
    status: 403,
    description: "Forbidden - cannot cancel another user's booking",
  })
  @ApiResponse({ status: 404, description: 'Class booking not found' })
  @ApiParam({ name: 'id', description: 'Booking UUID', type: String })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const responseModel = new ResponseModel();

    const isAdmin = user.roles.includes(ERoleName.ADMIN);
    const classBooking = await this.classBookingService.cancel(
      id,
      user.sub,
      isAdmin,
    );
    const result = toResponse(classBooking);
    responseModel.setData(result);

    return responseModel;
  }

  @Delete(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Delete class booking permanently (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Class booking deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Class booking not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const responseModel = new ResponseModel();

    const result = await this.classBookingService.remove(id);
    responseModel.setData(result);

    return responseModel;
  }
}
