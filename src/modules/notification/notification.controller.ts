import {
  Controller,
  Get,
  Patch,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseModel } from '../../libs/models/response/response.model';
import { CurrentUser } from '../../libs/decorator/current-user.decorator';
import type { RequestUser } from '../../libs/decorator/current-user.decorator';
import { GetNotificationsQueryDto } from './dto/notification-query.dto';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count for the current user' })
  @ApiResponse({ status: 200, description: 'Unread count retrieved successfully' })
  async getUnreadCount(@CurrentUser() user: RequestUser) {
    const responseModel = new ResponseModel();
    const count = await this.notificationService.getUnreadCount(user.sub);
    responseModel.setData({ count });
    return responseModel;
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated notifications for the current user' })
  @ApiResponse({ status: 200, description: 'Notifications retrieved successfully' })
  async getNotifications(
    @CurrentUser() user: RequestUser,
    @Query() query: GetNotificationsQueryDto,
  ) {
    const responseModel = new ResponseModel();
    const page = query.page ? Math.max(1, parseInt(query.page, 10)) : 1;
    const limit = query.limit
      ? Math.min(100, Math.max(1, parseInt(query.limit, 10)))
      : 10;
    const unreadOnly = query.unreadOnly === 'true';

    const data = await this.notificationService.getNotifications(user.sub, {
      page,
      limit,
      unreadOnly,
    });

    responseModel.setData(data);
    return responseModel;
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const responseModel = new ResponseModel();
    const notification = await this.notificationService.markAsRead(id, user.sub);
    responseModel.setData(notification);
    return responseModel;
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read for the current user' })
  @ApiResponse({ status: 200, description: 'Notifications marked as read' })
  async markAllAsRead(@CurrentUser() user: RequestUser) {
    const responseModel = new ResponseModel();
    const result = await this.notificationService.markAllAsRead(user.sub);
    responseModel.setData(result);
    return responseModel;
  }
}
