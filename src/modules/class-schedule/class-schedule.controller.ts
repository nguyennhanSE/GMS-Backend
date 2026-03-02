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
import { ClassScheduleService } from './class-schedule.service';
import { CreateClassScheduleDto } from './dto/create-class-schedule.dto';
import { UpdateClassScheduleDto } from './dto/update-class-schedule.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ResponseModel } from '../../libs/models/response/response.model';
import { toResponse } from './mapper/class-schedule.mapper';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import { GetClassSchedulesQueryDto } from './dto/class-schedule-query.dto';
import { CheckScheduleConflictDto } from './dto/check-conflict.dto';

@ApiTags('Class Schedule Management')
@ApiBearerAuth()
@Controller('class-schedule')
export class ClassScheduleController {
  constructor(private readonly classScheduleService: ClassScheduleService) {}

  @Post('create')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Create a new class schedule' })
  @ApiResponse({
    status: 201,
    description: 'Class schedule created successfully',
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad request - validation error or class schedule already exists',
  })
  async create(@Body() createClassScheduleDto: CreateClassScheduleDto) {
    const responseModel = new ResponseModel();

    try {
      const classSchedule = await this.classScheduleService.create(
        createClassScheduleDto,
      );
      const result = toResponse(classSchedule);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get('list')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF, ERoleName.TRAINER, ERoleName.MEMBER)
  @ApiOperation({ summary: 'Get paginated list of class schedules' })
  @ApiResponse({
    status: 200,
    description: 'Class schedules retrieved successfully',
  })
  async list(@Query() query: GetClassSchedulesQueryDto) {
    const responseModel = new ResponseModel();

    try {
      const {
        page,
        limit,
        sort,
        sortBy,
        counted,
        q: search,
        searchField,
        dayOfWeek,
        trainerId,
        classId,
        isActive,
        date,
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

      // Parse date for availability context (UTC noon to avoid timezone issues)
      const targetDate = date ? new Date(date + 'T12:00:00Z') : undefined;

      const data = await this.classScheduleService.findAll(
        {
          page: pageNum,
          limit: limitNum,
          sort: sort || 'asc',
          sortBy: sortBy || 'createdAt',
        },
        { q: search, searchField, dayOfWeek, trainerId, classId, isActive },
        { counted: counted ?? true },
        targetDate,
      );

      const docs = data.docs.map((e) => toResponse(e));

      const result = { ...data, docs };
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Get class schedule by ID' })
  @ApiResponse({
    status: 200,
    description: 'Class schedule retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Class schedule not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('date') date?: string,
  ) {
    const responseModel = new ResponseModel();

    try {
      const targetDate = date ? new Date(date + 'T12:00:00Z') : undefined;

      const classSchedule = await this.classScheduleService.findOne(
        id,
        targetDate,
      );
      const result = toResponse(classSchedule);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Patch(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Update class schedule information' })
  @ApiResponse({
    status: 200,
    description: 'Class schedule updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  @ApiResponse({ status: 404, description: 'Class schedule not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateClassScheduleDto: UpdateClassScheduleDto,
  ) {
    const responseModel = new ResponseModel();

    try {
      const classSchedule = await this.classScheduleService.update(
        id,
        updateClassScheduleDto,
      );
      const result = toResponse(classSchedule);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Delete(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Delete class schedule' })
  @ApiResponse({
    status: 200,
    description: 'Class schedule deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Class schedule not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const responseModel = new ResponseModel();

    try {
      const result = await this.classScheduleService.remove(id);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Post('check-conflict')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF)
  @ApiOperation({
    summary: 'Check if a schedule conflicts with existing schedules',
    description:
      'Useful for frontend validation before creating/updating schedules. Returns whether there is a conflict and the list of conflicting schedules.',
  })
  @ApiResponse({
    status: 200,
    description: 'Conflict check completed',
  })
  async checkConflict(@Body() dto: CheckScheduleConflictDto) {
    const responseModel = new ResponseModel();

    try {
      const result = await this.classScheduleService.checkConflict(
        dto.trainerId,
        dto.dayOfWeek,
        dto.startTime,
        dto.endTime,
        dto.excludeScheduleId,
      );

      responseModel.setData({
        hasConflict: result.hasConflict,
        conflictingSchedules: result.conflictingSchedules.map((s) => ({
          id: s.id,
          className: s.gymClass?.className,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          location: s.location,
        })),
      });
    } catch (error) {
      throw error;
    }

    return responseModel;
  }
}
