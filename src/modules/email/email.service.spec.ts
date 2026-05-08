import { Test, TestingModule } from '@nestjs/testing';
import { UserEmailService } from './email.service';
import { EMAIL_DELIVERY_SERVICE } from './email.interface';

describe('EmailService', () => {
  let service: UserEmailService;
  const emailServiceMock = {
    sendEmail: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserEmailService,
        { provide: EMAIL_DELIVERY_SERVICE, useValue: emailServiceMock },
      ],
    }).compile();

    service = module.get<UserEmailService>(UserEmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
