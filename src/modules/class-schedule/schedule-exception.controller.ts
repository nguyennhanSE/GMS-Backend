import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ResponseModel } from '../../libs/models/response/response.model';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import { ScheduleExceptionService } from './schedule-exception.service';
import {
  CreateScheduleExceptionDto,
  UpdateScheduleExceptionDto,
} from './dto/schedule-exception.dto';
import { toScheduleExceptionResponse } from './mapper/schedule-exception.mapper';

@ApiTags('Schedule Exceptions')
@ApiBearerAuth()
@Controller('class-schedule')
export class ScheduleExceptionController {
  constructor(private readonly exceptionService: ScheduleExceptionService) {}

  @Post(':scheduleId/exceptions')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({
    summary: 'Add an exception date to a schedule',
    description:
      'Mark a specific date as cancelled (holiday/closure) or rescheduled to a different time.',
  })
  @ApiResponse({
    status: 201,
    description: 'Exception created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation error',
  })
  @ApiResponse({
    status: 404,
    description: 'Schedule not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Exception already exists for this date',
  })
  async createException(
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: CreateScheduleExceptionDto,
  ) {
    const responseModel = new ResponseModel();

    try {
      const exception = await this.exceptionService.create(scheduleId, dto);
      const result = toScheduleExceptionResponse(exception);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get(':scheduleId/exceptions')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF, ERoleName.TRAINER)
  @ApiOperation({
    summary: 'Get all exceptions for a schedule',
    description: 'Returns list of exception dates ordered by date ascending.',
  })
  @ApiResponse({
    status: 200,
    description: 'Exceptions retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Schedule not found',
  })
  async getExceptions(@Param('scheduleId', ParseUUIDPipe) scheduleId: string) {
    const responseModel = new ResponseModel();

    try {
      const exceptions =
        await this.exceptionService.findByScheduleId(scheduleId);
      const result = exceptions.map(toScheduleExceptionResponse);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get('exceptions/:exceptionId')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF)
  @ApiOperation({
    summary: 'Get a specific exception by ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Exception retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Exception not found',
  })
  async getException(@Param('exceptionId', ParseUUIDPipe) exceptionId: string) {
    const responseModel = new ResponseModel();

    try {
      const exception = await this.exceptionService.findById(exceptionId);
      const result = toScheduleExceptionResponse(exception);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Patch('exceptions/:exceptionId')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({
    summary: 'Update an exception',
    description: 'Modify the exception type, reason, or rescheduled times.',
  })
  @ApiResponse({
    status: 200,
    description: 'Exception updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation error',
  })
  @ApiResponse({
    status: 404,
    description: 'Exception not found',
  })
  async updateException(
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
    @Body() dto: UpdateScheduleExceptionDto,
  ) {
    const responseModel = new ResponseModel();

    try {
      const exception = await this.exceptionService.update(exceptionId, dto);
      const result = toScheduleExceptionResponse(exception);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Delete('exceptions/:exceptionId')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({
    summary: 'Delete an exception',
    description:
      'Remove an exception, restoring the class to its normal schedule on that date.',
  })
  @ApiResponse({
    status: 200,
    description: 'Exception deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Exception not found',
  })
  async deleteException(
    @Param('exceptionId', ParseUUIDPipe) exceptionId: string,
  ) {
    const responseModel = new ResponseModel();

    try {
      const result = await this.exceptionService.remove(exceptionId);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }
}
