import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type RequestUser,
} from '../../libs/decorator/current-user.decorator';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ResponseModel } from '../../libs/models/response/response.model';
import { ERoleName } from '../roles/enums/role.enum';
import { CreateTrainerConversationDto } from './dto/create-trainer-conversation.dto';
import { SendTrainerMessageDto } from './dto/send-trainer-message.dto';
import { TrainerMessageQueryDto } from './dto/trainer-message-query.dto';
import { TrainerMessagingService } from './trainer-messaging.service';

@ApiTags('Trainer Messaging')
@ApiBearerAuth()
@Roles(ERoleName.MEMBER, ERoleName.TRAINER)
@Controller('trainer-messaging')
export class TrainerMessagingController {
  constructor(
    private readonly trainerMessagingService: TrainerMessagingService,
  ) {}

  @Get('contacts')
  @ApiOperation({ summary: 'List booking-eligible trainer messaging contacts' })
  async listContacts(@CurrentUser() user: RequestUser) {
    const response = new ResponseModel();
    const contacts = await this.trainerMessagingService.listContacts(user);
    response.setData(contacts);
    return response;
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List trainer messaging conversations for the caller' })
  async listConversations(@CurrentUser() user: RequestUser) {
    const response = new ResponseModel();
    const conversations =
      await this.trainerMessagingService.listConversations(user);
    response.setData(conversations);
    return response;
  }

  @Post('conversations')
  @ApiOperation({
    summary: 'Create or return the conversation for a trainer-member pair',
  })
  async createConversation(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateTrainerConversationDto,
  ) {
    const response = new ResponseModel();
    const conversation =
      await this.trainerMessagingService.createOrGetConversation(
        user,
        dto.partnerId,
      );
    response.setData(conversation);
    return response;
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({
    summary: 'Get paginated messages for a trainer-member conversation',
  })
  async getMessages(
    @CurrentUser() user: RequestUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: TrainerMessageQueryDto,
  ) {
    const response = new ResponseModel();
    const messages = await this.trainerMessagingService.getMessages(
      user,
      conversationId,
      query,
    );
    response.setData(messages);
    return response;
  }

  @Post('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'Send a message in a trainer-member conversation' })
  async sendMessage(
    @CurrentUser() user: RequestUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendTrainerMessageDto,
  ) {
    const response = new ResponseModel();
    const page = await this.trainerMessagingService.sendMessage(
      user,
      conversationId,
      dto.content,
    );
    response.setData(page);
    return response;
  }

  @Post('conversations/:conversationId/read')
  @ApiOperation({
    summary: 'Mark a trainer-member conversation as read for the caller',
  })
  async markRead(
    @CurrentUser() user: RequestUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    const response = new ResponseModel();
    const result = await this.trainerMessagingService.markConversationRead(
      user,
      conversationId,
    );
    response.setData(result);
    return response;
  }
}
