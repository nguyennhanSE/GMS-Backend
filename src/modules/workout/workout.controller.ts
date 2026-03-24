import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ResponseModel } from '../../libs/models/response/response.model';
import { CurrentUser } from '../../libs/decorator/current-user.decorator';
import type { RequestUser } from '../../libs/decorator/current-user.decorator';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import { WorkoutService } from './workout.service';
import { CreateExerciseDto, UpdateExerciseDto } from './dto/exercise.dto';
import { CreateWorkoutPlanDto } from './dto/workout-plan.dto';
import {
  CompleteWorkoutSessionDto,
  CreateWorkoutSessionDto,
} from './dto/workout-session.dto';
import { CreateExerciseSetLogDto } from './dto/exercise-set-log.dto';

@ApiTags('Workout')
@ApiBearerAuth()
@Controller()
export class WorkoutController {
  constructor(private readonly workoutService: WorkoutService) {}

  @Get('exercises')
  @ApiOperation({ summary: 'List workout exercises' })
  @ApiResponse({ status: 200, description: 'Exercises retrieved successfully' })
  async listExercises() {
    const responseModel = new ResponseModel();
    const exercises = await this.workoutService.listExercises();
    responseModel.setData(exercises);
    return responseModel;
  }

  @Post('exercises')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF, ERoleName.TRAINER)
  @ApiOperation({ summary: 'Create a workout exercise' })
  @ApiResponse({ status: 201, description: 'Exercise created successfully' })
  async createExercise(@Body() dto: CreateExerciseDto) {
    const responseModel = new ResponseModel();
    const exercise = await this.workoutService.createExercise(dto);
    responseModel.setData(exercise);
    return responseModel;
  }

  @Patch('exercises/:id')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF, ERoleName.TRAINER)
  @ApiOperation({ summary: 'Update a workout exercise' })
  @ApiResponse({ status: 200, description: 'Exercise updated successfully' })
  async updateExercise(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExerciseDto,
  ) {
    const responseModel = new ResponseModel();
    const exercise = await this.workoutService.updateExercise(id, dto);
    responseModel.setData(exercise);
    return responseModel;
  }

  @Delete('exercises/:id')
  @Roles(ERoleName.ADMIN, ERoleName.STAFF, ERoleName.TRAINER)
  @ApiOperation({ summary: 'Delete a workout exercise' })
  @ApiResponse({ status: 200, description: 'Exercise deleted successfully' })
  async deleteExercise(@Param('id', ParseUUIDPipe) id: string) {
    const responseModel = new ResponseModel();
    const result = await this.workoutService.deleteExercise(id);
    responseModel.setData(result);
    return responseModel;
  }

  @Post('workout-plans')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'Create a workout plan with items and assignments' })
  @ApiResponse({
    status: 201,
    description: 'Workout plan created successfully',
  })
  async createWorkoutPlan(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateWorkoutPlanDto,
  ) {
    const responseModel = new ResponseModel();
    const plan = await this.workoutService.createWorkoutPlan(user, dto);
    responseModel.setData(plan);
    return responseModel;
  }

  @Get('workout-plans')
  @Roles(ERoleName.TRAINER, ERoleName.MEMBER)
  @ApiOperation({ summary: 'List accessible workout plans' })
  @ApiResponse({
    status: 200,
    description: 'Workout plans retrieved successfully',
  })
  async listWorkoutPlans(@CurrentUser() user: RequestUser) {
    const responseModel = new ResponseModel();
    const plans = await this.workoutService.listWorkoutPlans(user);
    responseModel.setData(plans);
    return responseModel;
  }

  @Get('workout-plans/:id')
  @Roles(ERoleName.TRAINER, ERoleName.MEMBER)
  @ApiOperation({ summary: 'Get workout plan details' })
  @ApiResponse({
    status: 200,
    description: 'Workout plan retrieved successfully',
  })
  async getWorkoutPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const responseModel = new ResponseModel();
    const plan = await this.workoutService.getWorkoutPlan(id, user);
    responseModel.setData(plan);
    return responseModel;
  }

  @Delete('workout-plans/:id')
  @Roles(ERoleName.TRAINER)
  @ApiOperation({ summary: 'Delete a workout plan' })
  @ApiResponse({
    status: 200,
    description: 'Workout plan deleted successfully',
  })
  async deleteWorkoutPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const responseModel = new ResponseModel();
    const result = await this.workoutService.deleteWorkoutPlan(id, user);
    responseModel.setData(result);
    return responseModel;
  }

  @Post('workout-sessions')
  @Roles(ERoleName.MEMBER)
  @ApiOperation({ summary: 'Start a workout session' })
  @ApiResponse({
    status: 201,
    description: 'Workout session created successfully',
  })
  async startWorkoutSession(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateWorkoutSessionDto,
  ) {
    const responseModel = new ResponseModel();
    const session = await this.workoutService.createWorkoutSession(user, dto);
    responseModel.setData(session);
    return responseModel;
  }

  @Get('workout-sessions')
  @Roles(ERoleName.MEMBER, ERoleName.TRAINER)
  @ApiOperation({ summary: 'List accessible workout sessions' })
  @ApiResponse({
    status: 200,
    description: 'Workout sessions retrieved successfully',
  })
  async listWorkoutSessions(@CurrentUser() user: RequestUser) {
    const responseModel = new ResponseModel();
    const sessions = await this.workoutService.listWorkoutSessions(user);
    responseModel.setData(sessions);
    return responseModel;
  }

  @Patch('workout-sessions/:id/complete')
  @Roles(ERoleName.MEMBER)
  @ApiOperation({ summary: 'Complete a workout session' })
  @ApiResponse({
    status: 200,
    description: 'Workout session completed successfully',
  })
  async completeWorkoutSession(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CompleteWorkoutSessionDto,
  ) {
    const responseModel = new ResponseModel();
    const session = await this.workoutService.completeWorkoutSession(id, user, dto);
    responseModel.setData(session);
    return responseModel;
  }

  @Post('workout-sessions/:sessionId/sets')
  @Roles(ERoleName.MEMBER)
  @ApiOperation({ summary: 'Log a completed exercise set' })
  @ApiResponse({
    status: 201,
    description: 'Exercise set logged successfully',
  })
  async createExerciseSetLog(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateExerciseSetLogDto,
  ) {
    const responseModel = new ResponseModel();
    const setLog = await this.workoutService.createExerciseSetLog(sessionId, user, dto);
    responseModel.setData(setLog);
    return responseModel;
  }
}
