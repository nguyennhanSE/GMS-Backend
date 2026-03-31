import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TrainerService } from './trainer.service';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { GetTrainersQueryDto } from './dto/trainer-query.dto';
import { SetTrainerAvailabilityDto } from './dto/trainer-availability.dto';
import {
  CreateTrainerClientLinkDto,
  EndTrainerClientLinkDto,
} from './dto/trainer-client-link.dto';
import { ResponseModel } from '../../libs/models/response/response.model';
import { CurrentUser } from '../../libs/decorator/current-user.decorator';
import type { RequestUser } from '../../libs/decorator/current-user.decorator';
import { toTrainerResponse } from './mapper/trainer.mapper';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ERoleName } from '../roles/enums/role.enum';

@ApiTags('Trainer Management')
@ApiBearerAuth()
@Controller('trainer')
export class TrainerController {
  private readonly logger = new Logger(TrainerController.name);

  constructor(private readonly trainerService: TrainerService) {}

  @Post('create')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Create a new trainer' })
  @ApiResponse({ status: 201, description: 'Trainer created successfully' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation error or trainer already exists',
  })
  async create(@Body() createTrainerDto: CreateTrainerDto) {
    const responseModel = new ResponseModel();
    const trainer = await this.trainerService.create(createTrainerDto);
    responseModel.setData(toTrainerResponse(trainer));
    return responseModel;
  }

  @Get('list')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF)
  @ApiOperation({ summary: 'Get paginated list of trainers' })
  @ApiResponse({ status: 200, description: 'Trainers retrieved successfully' })
  async list(@Query() q: GetTrainersQueryDto) {
    const responseModel = new ResponseModel();

    const {
      page,
      limit,
      sort,
      sortBy,
      counted,
      q: search,
      email,
      searchField,
    } = q;

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

    const data = await this.trainerService.getTrainerPaginate(
      {
        page: pageNum,
        limit: limitNum,
        sort: sort || 'asc',
        sortBy: sortBy || 'createdAt',
      },
      { q: search, email, searchField },
      { counted: counted ?? true },
    );

    const docs = data.docs.map((e) => toTrainerResponse(e));
    responseModel.setData({ ...data, docs });
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
    const trainer = await this.trainerService.findOne(id);
    responseModel.setData(toTrainerResponse(trainer));
    return responseModel;
  }

  @Patch(':id')
  @Roles(ERoleName.ADMIN, ERoleName.TRAINER)
  @ApiOperation({ summary: 'Update trainer information' })
  @ApiResponse({ status: 200, description: 'Trainer updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  @ApiResponse({ status: 404, description: 'Trainer not found' })
  @ApiParam({ name: 'id', description: 'Trainer ID (UUID)', type: String })
  async update(
    @Param('id') id: string,
    @Body() updateTrainerDto: UpdateTrainerDto,
  ) {
    const responseModel = new ResponseModel();
    const trainer = await this.trainerService.update(id, updateTrainerDto);
    responseModel.setData(toTrainerResponse(trainer));
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
    const result = await this.trainerService.remove(id);
    responseModel.setData(result);
    return responseModel;
  }

  // ============================================
  // AVAILABILITY ENDPOINTS (relational table)
  // ============================================

  @Get(':id/availability')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF, ERoleName.TRAINER, ERoleName.MEMBER)
  @ApiOperation({ summary: 'Get trainer availability slots' })
  @ApiResponse({
    status: 200,
    description: 'Availability retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Trainer not found' })
  @ApiParam({ name: 'id', description: 'Trainer ID (UUID)', type: String })
  async getAvailability(@Param('id') id: string) {
    const responseModel = new ResponseModel();
    const availability = await this.trainerService.getAvailabilities(id);
    responseModel.setData({ trainerId: id, availability });
    return responseModel;
  }

  @Put(':id/availability')
  @Roles(ERoleName.ADMIN, ERoleName.TRAINER)
  @ApiOperation({
    summary: 'Set trainer availability (replaces all existing slots)',
  })
  @ApiResponse({
    status: 200,
    description: 'Availability updated successfully',
  })
  @ApiResponse({ status: 404, description: 'Trainer not found' })
  @ApiParam({ name: 'id', description: 'Trainer ID (UUID)', type: String })
  async setAvailability(
    @Param('id') id: string,
    @Body() dto: SetTrainerAvailabilityDto,
  ) {
    const responseModel = new ResponseModel();
    const availability = await this.trainerService.setAvailabilities(
      id,
      dto.slots,
    );
    responseModel.setData({ trainerId: id, availability });
    return responseModel;
  }

  @Delete(':id/availability/:slotId')
  @Roles(ERoleName.ADMIN, ERoleName.TRAINER)
  @ApiOperation({ summary: 'Delete a single availability slot' })
  @ApiResponse({
    status: 200,
    description: 'Availability slot deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Trainer or slot not found' })
  @ApiParam({ name: 'id', description: 'Trainer ID (UUID)', type: String })
  @ApiParam({
    name: 'slotId',
    description: 'Availability slot ID (UUID)',
    type: String,
  })
  async deleteAvailabilitySlot(
    @Param('id') id: string,
    @Param('slotId') slotId: string,
  ) {
    const responseModel = new ResponseModel();
    await this.trainerService.deleteAvailability(id, slotId);
    responseModel.setData({
      message: `Availability slot ${slotId} deleted successfully`,
    });
    return responseModel;
  }

  // ============================================
  // TRAINER-CLIENT LINK ENDPOINTS
  // ============================================

  @Post(':trainerId/clients')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF)
  @ApiOperation({ summary: 'Create a trainer-client link' })
  @ApiResponse({
    status: 201,
    description: 'Trainer-client link created successfully',
  })
  async createTrainerClientLink(
    @Param('trainerId', ParseUUIDPipe) trainerId: string,
    @Body() dto: CreateTrainerClientLinkDto,
  ) {
    const responseModel = new ResponseModel();
    const link = await this.trainerService.createTrainerClientLink(
      trainerId,
      dto,
    );
    responseModel.setData(link);
    return responseModel;
  }

  @Patch(':trainerId/clients/:linkId/end')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF)
  @ApiOperation({ summary: 'End a trainer-client link' })
  @ApiResponse({
    status: 200,
    description: 'Trainer-client link ended successfully',
  })
  async endTrainerClientLink(
    @Param('trainerId', ParseUUIDPipe) trainerId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() dto: EndTrainerClientLinkDto,
  ) {
    const responseModel = new ResponseModel();
    const link = await this.trainerService.endTrainerClientLink(
      trainerId,
      linkId,
      dto,
    );
    responseModel.setData(link);
    return responseModel;
  }

  @Get('me/clients')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'List active clients for the current trainer' })
  @ApiResponse({
    status: 200,
    description: 'Trainer clients retrieved successfully',
  })
  async listTrainerClients(@CurrentUser() user: RequestUser) {
    const responseModel = new ResponseModel();
    const links = await this.trainerService.listTrainerClientLinks(user);
    responseModel.setData(links);
    return responseModel;
  }
}
