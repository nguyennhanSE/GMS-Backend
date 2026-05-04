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
      findMyMembership: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      renewMyMembership: jest.fn(),
      changeMyMembershipPlan: jest.fn(),
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

  it('renewMyMembership should pass user.sub', async () => {
    service.renewMyMembership.mockResolvedValue({
      checkoutUrl: 'https://stripe.com/renew',
    });

    const result = await controller.renewMyMembership({
      sub: 'user-1',
      email: 'test@test.com',
      tokenType: 'access',
      roles: ['member'],
    });

    expect(service.renewMyMembership).toHaveBeenCalledWith('user-1');
    expect(result.checkoutUrl).toBe('https://stripe.com/renew');
  });

  it('changeMyMembershipPlan should pass user.sub and targetMembershipId', async () => {
    service.changeMyMembershipPlan.mockResolvedValue({
      checkoutUrl: 'https://stripe.com/change-plan',
    });

    const result = await controller.changeMyMembershipPlan(
      {
        sub: 'user-1',
        email: 'test@test.com',
        tokenType: 'access',
        roles: ['member'],
      },
      {
        targetMembershipId: '11111111-2222-3333-4444-555555555555',
      },
    );

    expect(service.changeMyMembershipPlan).toHaveBeenCalledWith(
      'user-1',
      '11111111-2222-3333-4444-555555555555',
    );
    expect(result.checkoutUrl).toBe('https://stripe.com/change-plan');
  });
});
