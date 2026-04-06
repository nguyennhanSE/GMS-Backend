import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './libs/decorator/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @Public()
  getHealth() {
    return this.appService.getHealth();
  }
}
