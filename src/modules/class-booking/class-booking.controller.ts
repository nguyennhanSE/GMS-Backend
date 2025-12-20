import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseUUIDPipe } from '@nestjs/common';
import { ClassBookingService } from './class-booking.service';
import { CreateClassBookingDto, CreateMultipleClassBookingDto } from './dto/create-class-booking.dto';
import { UpdateClassBookingDto } from './dto/update-class-booking.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ResponseModel } from '../../libs/models/response/response.model';
import { toResponse } from './mapper/class-booking.mapper';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ERoleName } from '../roles/enums/role.enum';

class GetClassBookingsQueryDto {
  page?: string;
  limit?: string;
  sort?: 'asc' | 'desc';
  sortBy?: string;
  counted?: boolean;
  userId?: string;
  classScheduleId?: string;
  status?: string;
  q?: string;
  searchField?: string;
}

@ApiTags('Class Booking Management')
@ApiBearerAuth()
@Controller('class-booking')
export class ClassBookingController {
  constructor(private readonly classBookingService: ClassBookingService) {}

  @Post('create')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Create a new class booking' })
  @ApiResponse({ status: 201, description: 'Class booking created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  async create(@Body() createClassBookingDto: CreateMultipleClassBookingDto) {
    const responseModel = new ResponseModel();

    try {
      const classBooking = await this.classBookingService.create(createClassBookingDto);
      const result = classBooking.map(toResponse);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get('list')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Get paginated list of class bookings' })
  @ApiResponse({ status: 200, description: 'Class bookings retrieved successfully' })
  async list(@Query() query: GetClassBookingsQueryDto) {
    const responseModel = new ResponseModel();

    try {
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
        searchField 
      } = query;

      const pageNum = page ? (typeof page === 'string' ? parseInt(page, 10) : page) : 1;
      const limitNum = limit ? (typeof limit === 'string' ? parseInt(limit, 10) : limit) : 10;

      const data = await this.classBookingService.findAll(
        { 
          page: pageNum, 
          limit: limitNum, 
          sort: sort || 'desc', 
          sortBy: sortBy || 'createdAt' 
        },
        { userId, classScheduleId, status, q: search, searchField },
        { counted: counted ?? true },
      );

      const docs = data.docs.map(e => toResponse(e));

      const result = { ...data, docs };
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get('user/:userId')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Get bookings by user ID' })
  @ApiParam({ name: 'userId', description: 'User UUID', type: String })
  @ApiResponse({ status: 200, description: 'User bookings retrieved successfully' })
  async findByUserId(@Param('userId', ParseUUIDPipe) userId: string) {
    const responseModel = new ResponseModel();

    try {
      const bookings = await this.classBookingService.findByUserId(userId);
      const result = bookings.map(toResponse);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get('class-schedule/:classScheduleId')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Get bookings by class schedule ID' })
  @ApiParam({ name: 'classScheduleId', description: 'Class Schedule UUID', type: String })
  @ApiResponse({ status: 200, description: 'Class schedule bookings retrieved successfully' })
  async findByClassScheduleId(@Param('classScheduleId', ParseUUIDPipe) classScheduleId: string) {
    const responseModel = new ResponseModel();

    try {
      const bookings = await this.classBookingService.findByClassScheduleId(classScheduleId);
      const result = bookings.map(toResponse);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Get class booking by ID' })
  @ApiResponse({ status: 200, description: 'Class booking retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Class booking not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const responseModel = new ResponseModel();

    try {
      const classBooking = await this.classBookingService.findOne(id);
      const result = toResponse(classBooking);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Patch(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Update class booking information' })
  @ApiResponse({ status: 200, description: 'Class booking updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  @ApiResponse({ status: 404, description: 'Class booking not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string, 
    @Body() updateClassBookingDto: UpdateClassBookingDto
  ) {
    const responseModel = new ResponseModel();

    try {
      const classBooking = await this.classBookingService.update(id, updateClassBookingDto);
      const result = toResponse(classBooking);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Delete(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Delete class booking' })
  @ApiResponse({ status: 200, description: 'Class booking deleted successfully' })
  @ApiResponse({ status: 404, description: 'Class booking not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const responseModel = new ResponseModel();

    try {
      const result = await this.classBookingService.remove(id);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }
}
