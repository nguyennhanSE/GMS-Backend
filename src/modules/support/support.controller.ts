import { Controller, Post, Body } from '@nestjs/common';
import { SupportService } from './support.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { CurrentUser } from '../../libs/decorator/current-user.decorator';
import type { RequestUser } from '../../libs/decorator/current-user.decorator';
import { ResponseModel } from '../../libs/models/response/response.model';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('feedback')
  async createFeedback(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateFeedbackDto,
  ) {
    const responseModel = new ResponseModel();
    const result = await this.supportService.createFeedback(
      user.sub,
      user.email,
      dto,
    );
    responseModel.setData(result);
    return responseModel;
  }
}
