import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../libs/decorator/current-user.decorator';
import type { RequestUser } from '../../libs/decorator/current-user.decorator';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ResponseModel } from '../../libs/models/response/response.model';
import { ERoleName } from '../roles/enums/role.enum';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { ChatbotService } from './chatbot.service';

@ApiTags('Chatbot')
@ApiBearerAuth()
@Roles(ERoleName.MEMBER)
@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('session')
  @ApiOperation({ summary: 'Create or return the active chatbot session' })
  async createOrGetSession(@CurrentUser() user: RequestUser) {
    const responseModel = new ResponseModel();
    const session = await this.chatbotService.createOrGetSession(user.sub);
    responseModel.setData(session);
    return responseModel;
  }

  @Get('session/active')
  @ApiOperation({ summary: 'Get the active chatbot session for the member' })
  async getActiveSession(@CurrentUser() user: RequestUser) {
    const responseModel = new ResponseModel();
    const session = await this.chatbotService.getActiveSession(user.sub);
    responseModel.setData(session);
    return responseModel;
  }

  @Get('session/:sessionId/messages')
  @ApiOperation({ summary: 'Get chat messages for a member session' })
  async getMessages(
    @CurrentUser() user: RequestUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    const responseModel = new ResponseModel();
    const messages = await this.chatbotService.getMessages(user.sub, sessionId);
    responseModel.setData(messages);
    return responseModel;
  }

  @Post('session/:sessionId/messages')
  @ApiOperation({ summary: 'Send a member message to the chatbot' })
  async sendMessage(
    @CurrentUser() user: RequestUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: SendChatMessageDto,
  ) {
    const responseModel = new ResponseModel();
    const reply = await this.chatbotService.sendMessage(
      user.sub,
      sessionId,
      dto.message,
    );
    responseModel.setData(reply);
    return responseModel;
  }

  @Post('session/:sessionId/close')
  @ApiOperation({ summary: 'Close a member chatbot session' })
  async closeSession(
    @CurrentUser() user: RequestUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    const responseModel = new ResponseModel();
    const result = await this.chatbotService.closeSession(user.sub, sessionId);
    responseModel.setData(result);
    return responseModel;
  }
}
