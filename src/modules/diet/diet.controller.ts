import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { DietService } from './diet.service';
import { CreateDietPlanDto, UpdateDietPlanDto } from './dto/diet-plan.dto';
import { DietPlanQueryDto } from './dto/diet-plan-query.dto';
import {
  CreateDietPlanAssignmentsDto,
  UpdateDietPlanAssignmentDto,
} from './dto/diet-plan-assignment.dto';

@ApiTags('Diet')
@ApiBearerAuth()
@Controller()
export class DietController {
  constructor(private readonly dietService: DietService) {}

  @Post('diet-plans')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'Create a draft private diet plan' })
  @ApiResponse({ status: 201, description: 'Diet plan created successfully' })
  async createDietPlan(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateDietPlanDto,
  ) {
    const responseModel = new ResponseModel();
    const plan = await this.dietService.createDietPlan(user, dto);
    responseModel.setData(plan);
    return responseModel;
  }

  @Get('diet-plans')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF, ERoleName.TRAINER, ERoleName.MEMBER)
  @ApiOperation({ summary: 'List accessible diet plans' })
  @ApiResponse({ status: 200, description: 'Diet plans retrieved successfully' })
  async listDietPlans(
    @CurrentUser() user: RequestUser,
    @Query() query: DietPlanQueryDto,
  ) {
    const responseModel = new ResponseModel();
    const plans = await this.dietService.listDietPlans(user, query);
    responseModel.setData(plans);
    return responseModel;
  }

  @Get('diet-plans/:id')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF, ERoleName.TRAINER, ERoleName.MEMBER)
  @ApiOperation({ summary: 'Get a diet plan detail view' })
  @ApiResponse({ status: 200, description: 'Diet plan retrieved successfully' })
  async getDietPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const responseModel = new ResponseModel();
    const plan = await this.dietService.getDietPlan(id, user);
    responseModel.setData(plan);
    return responseModel;
  }

  @Patch('diet-plans/:id')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'Update a never-assigned diet plan' })
  @ApiResponse({ status: 200, description: 'Diet plan updated successfully' })
  async updateDietPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateDietPlanDto,
  ) {
    const responseModel = new ResponseModel();
    const plan = await this.dietService.updateDietPlan(id, user, dto);
    responseModel.setData(plan);
    return responseModel;
  }

  @Post('diet-plans/:id/assignments')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'Create diet-plan assignments' })
  @ApiResponse({
    status: 201,
    description: 'Diet plan assignments created successfully',
  })
  async createDietPlanAssignments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateDietPlanAssignmentsDto,
  ) {
    const responseModel = new ResponseModel();
    const plan = await this.dietService.createDietPlanAssignments(id, user, dto);
    responseModel.setData(plan);
    return responseModel;
  }

  @Patch('diet-plans/:id/assignments/:assignmentId')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'End or remove a diet-plan assignment' })
  @ApiResponse({
    status: 200,
    description: 'Diet plan assignment updated successfully',
  })
  async updateDietPlanAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateDietPlanAssignmentDto,
  ) {
    const responseModel = new ResponseModel();
    const plan = await this.dietService.updateDietPlanAssignment(
      id,
      assignmentId,
      user,
      dto,
    );
    responseModel.setData(plan);
    return responseModel;
  }

  @Post('diet-plans/:id/archive')
  @HttpCode(200)
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'Archive a private diet plan' })
  @ApiResponse({ status: 200, description: 'Diet plan archived successfully' })
  async archiveDietPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const responseModel = new ResponseModel();
    const plan = await this.dietService.archiveDietPlan(id, user);
    responseModel.setData(plan);
    return responseModel;
  }

  @Delete('diet-plans/:id')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'Delete an unused draft private diet plan' })
  @ApiResponse({ status: 200, description: 'Diet plan deleted successfully' })
  async deleteDietPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const responseModel = new ResponseModel();
    const result = await this.dietService.deleteDietPlan(id, user);
    responseModel.setData(result);
    return responseModel;
  }

  @Post('diet-plans/:id/clone')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'Clone an immutable assigned diet plan into a new draft' })
  @ApiResponse({ status: 201, description: 'Diet plan cloned successfully' })
  async cloneDietPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const responseModel = new ResponseModel();
    const plan = await this.dietService.cloneDietPlan(id, user);
    responseModel.setData(plan);
    return responseModel;
  }
}
