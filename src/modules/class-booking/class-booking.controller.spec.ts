import { Test, TestingModule } from '@nestjs/testing';
import { ClassBookingController } from './class-booking.controller';
import { ClassBookingService } from './class-booking.service';

describe('ClassBookingController', () => {
  let controller: ClassBookingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClassBookingController],
      providers: [ClassBookingService],
    }).compile();

    controller = module.get<ClassBookingController>(ClassBookingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
