import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { TrainerService } from './trainer.service';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { GetTrainersQueryDto, UpdateTrainerAvailabilityDto } from './dto/trainer-query.dto';
import { ResponseModel } from '../../libs/models/response/response.model';
import { toTrainerResponse } from './mapper/trainer.mapper';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ERoleName } from '../roles/enums/role.enum';

@ApiTags('Trainer Management')
@ApiBearerAuth()
@Controller('trainer')
export class TrainerController {
  constructor(private readonly trainerService: TrainerService) {}

  @Post('create')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Create a new trainer' })
  @ApiResponse({ status: 201, description: 'Trainer created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error or trainer already exists' })
  async create(@Body() createTrainerDto: CreateTrainerDto) {
    const responseModel = new ResponseModel();

    try {
      const trainer = await this.trainerService.create(createTrainerDto);
      const result = toTrainerResponse(trainer);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get('list')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF)
  @ApiOperation({ summary: 'Get paginated list of trainers' })
  @ApiResponse({ status: 200, description: 'Trainers retrieved successfully' })
  async list(@Query() q: GetTrainersQueryDto) {
    const responseModel = new ResponseModel();

    try {
      const { 
        page, 
        limit, 
        sort, 
        sortBy, 
        counted, 
        q: search, 
        email, 
        searchField 
      } = q;

      const pageNum = page ? (typeof page === 'string' ? parseInt(page, 10) : page) : 1;
      const limitNum = limit ? (typeof limit === 'string' ? parseInt(limit, 10) : limit) : 10;

      const data = await this.trainerService.getTrainerPaginate(
        { 
          page: pageNum, 
          limit: limitNum, 
          sort: sort || 'asc', 
          sortBy: sortBy || 'createdAt' 
        },
        { q: search, email, searchField },
        { counted: counted ?? true },
      );

      const docs = data.docs.map(e => toTrainerResponse(e));

      const result = { ...data, docs };
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get(':id')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF, ERoleName.TRAINER)
  @ApiOperation({ summary: 'Get trainer by ID' })
  @ApiResponse({ status: 200, description: 'Trainer retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Trainer not found' })
  @ApiParam({ name: 'id', description: 'Trainer ID (UUID)', type: String })
  async findOne(@Param('id') id: string) {
    const responseModel = new ResponseModel();

    try {
      const trainer = await this.trainerService.findOne(id);
      const result = toTrainerResponse(trainer);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Patch(':id')
  @Roles(ERoleName.ADMIN, ERoleName.TRAINER)
  @ApiOperation({ summary: 'Update trainer information' })
  @ApiResponse({ status: 200, description: 'Trainer updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  @ApiResponse({ status: 404, description: 'Trainer not found' })
  @ApiParam({ name: 'id', description: 'Trainer ID (UUID)', type: String })
  async update(@Param('id') id: string, @Body() updateTrainerDto: UpdateTrainerDto) {
    const responseModel = new ResponseModel();

    try {
      const trainer = await this.trainerService.update(id, updateTrainerDto);
      const result = toTrainerResponse(trainer);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Delete(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Delete trainer' })
  @ApiResponse({ status: 200, description: 'Trainer deleted successfully' })
  @ApiResponse({ status: 404, description: 'Trainer not found' })
  @ApiParam({ name: 'id', description: 'Trainer ID (UUID)', type: String })
  async remove(@Param('id') id: string) {
    const responseModel = new ResponseModel();

    try {
      const result = await this.trainerService.remove(id);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get(':id/available-time')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF, ERoleName.TRAINER, ERoleName.MEMBER)
  @ApiOperation({ summary: 'Get trainer available time slots' })
  @ApiResponse({ status: 200, description: 'Available time retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Trainer not found' })
  @ApiParam({ name: 'id', description: 'Trainer ID (UUID)', type: String })
  async getAvailableTime(@Param('id') id: string) {
    const responseModel = new ResponseModel();

    try {
      const availableTime = await this.trainerService.getTrainerAvailableTime(id);
      responseModel.setData({ 
        trainerId: id,
        availableTime 
      });
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Patch(':id/availability')
  @Roles(ERoleName.ADMIN, ERoleName.TRAINER)
  @ApiOperation({ summary: 'Update trainer availability (time slots and days)' })
  @ApiResponse({ status: 200, description: 'Availability updated successfully' })
  @ApiResponse({ status: 404, description: 'Trainer not found' })
  @ApiParam({ name: 'id', description: 'Trainer ID (UUID)', type: String })
  async updateAvailability(
    @Param('id') id: string,
    @Body() updateAvailabilityDto: UpdateTrainerAvailabilityDto
  ) {
    const responseModel = new ResponseModel();

    try {
      let trainer = await this.trainerService.findOne(id);

      // Update available time if provided
      if (updateAvailabilityDto.trainerAvailableTime !== undefined) {
        trainer = await this.trainerService.updateTrainerAvailableTime(
          id,
          updateAvailabilityDto.trainerAvailableTime
        );
      }

      // Update available days if provided
      if (updateAvailabilityDto.trainerAvailableDays !== undefined) {
        trainer = await this.trainerService.updateTrainerAvailableDays(
          id,
          updateAvailabilityDto.trainerAvailableDays
        );
      }

      const result = toTrainerResponse(trainer);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }
}
