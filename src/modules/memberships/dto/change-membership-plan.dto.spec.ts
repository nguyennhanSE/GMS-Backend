import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangeMembershipPlanDto } from './change-membership-plan.dto';

describe('ChangeMembershipPlanDto', () => {
  it('should validate a UUID targetMembershipId', async () => {
    const dto = plainToInstance(ChangeMembershipPlanDto, {
      targetMembershipId: '550e8400-e29b-41d4-a716-446655440000',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should reject a non-UUID targetMembershipId', async () => {
    const dto = plainToInstance(ChangeMembershipPlanDto, {
      targetMembershipId: 'not-a-uuid',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isUuid');
  });
});
