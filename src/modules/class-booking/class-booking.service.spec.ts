import { Test, TestingModule } from '@nestjs/testing';
import { ClassBookingService } from './class-booking.service';

describe('ClassBookingService', () => {
  let service: ClassBookingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ClassBookingService],
    }).compile();

    service = module.get<ClassBookingService>(ClassBookingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
