import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { AppCacheService } from '../../libs/cache/cache.service';
import {
  buildMembershipDetailKey,
  buildMembershipInvalidationTags,
  buildMembershipListKey,
  membershipDetailTags,
  membershipListTags,
  MEMBERSHIP_TTL_SECONDS,
} from './memberships.cache';

@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
    private readonly appCacheService: AppCacheService,
    private readonly storageService: StorageService,
  ) {}

  async create(dto: CreateMembershipDto) {
    const created = await this.prisma.membership.create({ data: dto });
    await this.appCacheService.invalidateTags(
      buildMembershipInvalidationTags(created.id),
    );

    return created;
  }

  async findAll() {
    return this.appCacheService.remember(
      buildMembershipListKey(),
      () =>
        this.prisma.membership.findMany({
          orderBy: { minPrice: 'asc' },
        }),
      {
        ttlSeconds: MEMBERSHIP_TTL_SECONDS,
        tags: membershipListTags(),
      },
    );
  }

  async findOne(id: string) {
    const membership = await this.appCacheService.remember(
      buildMembershipDetailKey(id),
      () =>
        this.prisma.membership.findUnique({
          where: { id },
        }),
      {
        ttlSeconds: MEMBERSHIP_TTL_SECONDS,
        tags: membershipDetailTags(id),
      },
    );
    if (!membership) {
      throw new NotFoundException(`Membership tier ${id} not found`);
    }
    return membership;
  }

  /**
   * Get the authenticated user's active membership with tier details.
   * Returns null if no active membership (not an error — user may simply not have one).
   */
  async findMyMembership(userId: string) {
    const active = await this.prisma.userMembership.findFirst({
      where: {
        userId,
        status: 'normal',
        endDate: { gte: new Date() },
      },
      include: {
        membership: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return active;
  }

  async renewMyMembership(userId: string) {
    const activeMembership = await this.requireActiveMembership(userId);
    return this.initiateCheckout(activeMembership.membershipId, userId);
  }

  async changeMyMembershipPlan(userId: string, targetMembershipId: string) {
    const activeMembership = await this.requireActiveMembership(userId);

    if (activeMembership.membershipId === targetMembershipId) {
      throw new BadRequestException(
        'Target membership matches your current active tier. Use renew instead.',
      );
    }

    return this.initiateCheckout(targetMembershipId, userId);
  }

  async update(id: string, dto: UpdateMembershipDto) {
    await this.findOne(id);
    const updated = await this.prisma.membership.update({
      where: { id },
      data: dto,
    });
    await this.appCacheService.invalidateTags(
      buildMembershipInvalidationTags(id),
    );

    return updated;
  }

  async remove(id: string) {
    await this.findOne(id);

    const activeCount = await this.prisma.userMembership.count({
      where: { membershipId: id, status: 'normal' },
    });

    if (activeCount > 0) {
      throw new BadRequestException(
        `Cannot delete tier with ${activeCount} active user memberships. Expire them first.`,
      );
    }

    await this.prisma.membership.delete({ where: { id } });
    await this.appCacheService.invalidateTags(
      buildMembershipInvalidationTags(id),
    );
    return { message: `Membership tier ${id} deleted` };
  }

  /**
   * Initiate Stripe checkout for explicit membership purchase.
   * Price is derived server-side from `purchasePrice` — never trusted from client.
   */
  async initiateCheckout(membershipId: string, userId: string) {
    const membership = await this.findOne(membershipId);

    if (membership.purchasePrice <= 0) {
      throw new BadRequestException(
        'This membership tier has no purchase price configured. Contact admin.',
      );
    }

    const result = await this.paymentService.createCheckout(userId, {
      targetType: 'MEMBERSHIP',
      targetId: membershipId,
      amount: membership.purchasePrice,
      currency: 'VND',
    });

    if (!result.checkoutUrl) {
      throw new BadRequestException(
        'Checkout session could not be created. Please try again.',
      );
    }

    return { checkoutUrl: result.checkoutUrl };
  }

  /**
   * Activate a membership after successful payment.
   * Called by the RabbitMQ consumer — system-level, no user guards.
   *
   * Implements time-stacking: if user already has active same-tier membership,
   * extends endDate. If different tier is active, soft-expires it (audit trail).
   */
  async activateByPayment(
    paymentId: string,
    userId: string,
    membershipId: string,
  ) {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
    });

    if (!membership) {
      throw new NotFoundException(`Membership tier ${membershipId} not found`);
    }

    const now = new Date();
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    return this.prisma.$transaction(async (tx) => {
      // Check for existing active membership of the SAME tier (time-stacking)
      const sameTierActive = await tx.userMembership.findFirst({
        where: {
          userId,
          membershipId,
          status: 'normal',
          endDate: { gte: now },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (sameTierActive) {
        // Time-stacking: extend from existing endDate, not from now
        const extendedEnd = new Date(sameTierActive.endDate);
        extendedEnd.setFullYear(extendedEnd.getFullYear() + 1);

        const updated = await tx.userMembership.update({
          where: { id: sameTierActive.id },
          data: {
            endDate: extendedEnd,
            paymentId,
          },
        });

        this.logger.log(
          `Time-stacked membership for user ${userId}: extended to ${extendedEnd.toISOString()}`,
        );
        return updated;
      }

      // Check for active membership of a DIFFERENT tier (upgrade/downgrade)
      const otherTierActive = await tx.userMembership.findFirst({
        where: {
          userId,
          status: 'normal',
          endDate: { gte: now },
          membershipId: { not: membershipId },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Soft-expire old tier (preserve audit trail — never delete)
      if (otherTierActive) {
        await tx.userMembership.update({
          where: { id: otherTierActive.id },
          data: {
            status: 'expired',
            endDate: now,
          },
        });

        this.logger.log(
          `Expired ${otherTierActive.membershipName} for user ${userId} (upgrade/downgrade)`,
        );
      }

      // Create new membership
      const created = await tx.userMembership.create({
        data: {
          userId,
          membershipId,
          membershipName: membership.name,
          membershipDescription: membership.description || '',
          level: membership.level,
          status: 'normal',
          startDate: now,
          endDate: oneYearFromNow,
          paymentId,
        },
      });

      this.logger.log(
        `Created ${membership.name} membership for user ${userId}`,
      );
      return created;
    });
  }

  /**
   * Deactivate membership after payment failure or refund.
   * Called by the RabbitMQ consumer — system-level, no user guards.
   */
  async deactivateByPayment(paymentId: string): Promise<boolean> {
    const userMembership = await this.prisma.userMembership.findFirst({
      where: { paymentId },
    });

    if (!userMembership) {
      this.logger.warn(
        `No membership found for payment ${paymentId} — skipping deactivation`,
      );
      return false;
    }

    if (userMembership.status === 'expired') {
      this.logger.log(
        `Membership for payment ${paymentId} already expired — skipping`,
      );
      return false;
    }

    await this.prisma.userMembership.update({
      where: { id: userMembership.id },
      data: {
        status: 'expired',
        endDate: new Date(),
      },
    });

    this.logger.log(
      `Deactivated membership ${userMembership.membershipName} for payment ${paymentId}`,
    );
    return true;
  }

  private async requireActiveMembership(userId: string) {
    const activeMembership = await this.findMyMembership(userId);

    if (!activeMembership) {
      throw new BadRequestException(
        'Active membership required. Use membership checkout to purchase a tier first.',
      );
    }

    return activeMembership;
  }

  async uploadMembershipLogo(
    membershipId: string,
    file: Express.Multer.File,
  ) {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      select: { id: true, logoKey: true },
    });
    if (!membership) {
      throw new NotFoundException(`Membership tier ${membershipId} not found`);
    }
    const oldKey = membership.logoKey;

    // Upload-first: new asset on Cloudinary before touching the DB
    const { url, key } = await this.storageService.uploadMembershipLogo({ membershipId, file });

    let updated;
    try {
      updated = await this.prisma.membership.update({
        where: { id: membershipId },
        data: { logoUrl: url, logoKey: key },
      });
      await this.appCacheService.invalidateTags(
        buildMembershipInvalidationTags(membershipId),
      );
    } catch (err) {
      // DB failed — clean up newly uploaded asset so it doesn't orphan
      await this.storageService.deleteObject(key).catch((e: unknown) =>
        this.logger.warn(`Failed to clean up orphaned Cloudinary asset ${key}`, e),
      );
      throw err;
    }

    // DB succeeded — now safely delete the old asset (non-fatal)
    if (oldKey) {
      await this.storageService.deleteObject(oldKey).catch((e: unknown) =>
        this.logger.warn(`Failed to delete old Cloudinary asset ${oldKey}`, e),
      );
    }

    return updated;
  }
}
