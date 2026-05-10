import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  ParseFilePipeBuilder,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { MembershipsService } from './memberships.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { ChangeMembershipPlanDto } from './dto/change-membership-plan.dto';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import { CurrentUser } from '../../libs/decorator/current-user.decorator';
import type { RequestUser } from '../../libs/decorator/current-user.decorator';

@ApiTags('memberships')
@ApiBearerAuth()
@Controller('memberships')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post()
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Create a membership tier (admin only)' })
  create(@Body() dto: CreateMembershipDto) {
    return this.membershipsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all membership tiers' })
  findAll() {
    return this.membershipsService.findAll();
  }

  @Get('my')
  @ApiOperation({ summary: 'Get my active membership' })
  findMyMembership(@CurrentUser() user: RequestUser) {
    return this.membershipsService.findMyMembership(user.sub);
  }

  @Post('my/renew')
  @Roles(ERoleName.MEMBER)
  @ApiOperation({
    summary: 'Renew the authenticated member active membership via Stripe checkout',
  })
  renewMyMembership(@CurrentUser() user: RequestUser) {
    return this.membershipsService.renewMyMembership(user.sub);
  }

  @Post('my/change-plan')
  @Roles(ERoleName.MEMBER)
  @ApiOperation({
    summary:
      'Create a Stripe checkout to change the authenticated member active membership tier',
  })
  changeMyMembershipPlan(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangeMembershipPlanDto,
  ) {
    return this.membershipsService.changeMyMembershipPlan(
      user.sub,
      dto.targetMembershipId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a membership tier by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.membershipsService.findOne(id);
  }

  @Patch(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Update a membership tier (admin only)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMembershipDto,
  ) {
    return this.membershipsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Delete a membership tier (admin only)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.membershipsService.remove(id);
  }

  @Post(':id/checkout')
  @ApiOperation({ summary: 'Purchase a membership via Stripe checkout' })
  initiateCheckout(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.membershipsService.initiateCheckout(id, user.sub);
  }

  @Post(':id/logo')
  @Roles(ERoleName.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload or replace Membership tier logo (Admin only)' })
  uploadMembershipLogo(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 5 * 1024 * 1024 })
        .build({
          fileIsRequired: true,
          errorHttpStatusCode: 400,
        }),
    )
    file: Express.Multer.File,
  ) {
    return this.membershipsService.uploadMembershipLogo(id, file);
  }
}
