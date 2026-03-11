import { Test, TestingModule } from '@nestjs/testing';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

describe('MembershipsController', () => {
  let controller: MembershipsController;
  let service: jest.Mocked<any>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      initiateCheckout: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MembershipsController],
      providers: [{ provide: MembershipsService, useValue: service }],
    }).compile();

    controller = module.get<MembershipsController>(MembershipsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll should delegate to service', async () => {
    const tiers = [{ id: '1', name: 'Basic' }];
    service.findAll.mockResolvedValue(tiers);

    const result = await controller.findAll();

    expect(result).toEqual(tiers);
    expect(service.findAll).toHaveBeenCalled();
  });

  it('initiateCheckout should pass id and user.sub', async () => {
    service.initiateCheckout.mockResolvedValue({
      checkoutUrl: 'https://stripe.com/123',
    });

    const result = await controller.initiateCheckout('tier-1', {
      sub: 'user-1',
      email: 'test@test.com',
      tokenType: 'access',
      roles: ['member'],
    });

    expect(service.initiateCheckout).toHaveBeenCalledWith('tier-1', 'user-1');
    expect(result.checkoutUrl).toBe('https://stripe.com/123');
  });
});
