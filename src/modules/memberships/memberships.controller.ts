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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MembershipsService } from './memberships.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
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
}
