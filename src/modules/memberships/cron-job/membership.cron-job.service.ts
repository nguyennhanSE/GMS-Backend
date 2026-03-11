import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MembershipLevel } from '@prisma/client';

interface MembershipTier {
  id: string;
  name: string;
  description: string | null;
  minPrice: number;
  level: MembershipLevel;
}

@Injectable()
export class MembershipRecalculationService {
  private static readonly BATCH_SIZE = 50;
  private readonly logger = new Logger(MembershipRecalculationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Scheduled cron job that runs daily at 2 AM to recalculate user memberships
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleScheduledMembershipRecalculation() {
    this.logger.log('Starting scheduled membership recalculation...');
    await this.recalculateAllUserMemberships();
    this.logger.log('Completed scheduled membership recalculation');
  }

  /**
   * Main method to recalculate all user memberships based on their purchase history.
   * Only affects AUTO-TIERED memberships. Paid/admin-granted memberships are never touched.
   */
  async recalculateAllUserMemberships(): Promise<{
    totalUsersProcessed: number;
    totalUpdated: number;
    totalCreated: number;
    skippedPaid: number;
    errors: number;
  }> {
    this.logger.log('Starting membership recalculation for all users');

    const startTime = Date.now();
    let totalUsersProcessed = 0;
    let totalUpdated = 0;
    let totalCreated = 0;
    let skippedPaid = 0;
    let errors = 0;

    try {
      const membershipTiers = await this.getMembershipTiers();

      if (membershipTiers.length === 0) {
        this.logger.warn('No membership tiers found. Skipping recalculation.');
        return {
          totalUsersProcessed: 0,
          totalUpdated: 0,
          totalCreated: 0,
          skippedPaid: 0,
          errors: 0,
        };
      }

      this.logger.log(`Found ${membershipTiers.length} membership tiers`);

      // FIX: Replace N+1 with groupBy aggregation
      const users = await this.getUsersWithPurchaseAmounts();

      this.logger.log(`Processing ${users.length} users in batches of ${MembershipRecalculationService.BATCH_SIZE}`);

      // Process users in batches to avoid overwhelming the DB connection pool
      for (
        let i = 0;
        i < users.length;
        i += MembershipRecalculationService.BATCH_SIZE
      ) {
        const batch = users.slice(
          i,
          i + MembershipRecalculationService.BATCH_SIZE,
        );
        const batchNum =
          Math.floor(i / MembershipRecalculationService.BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(
          users.length / MembershipRecalculationService.BATCH_SIZE,
        );

        for (const user of batch) {
          try {
            const result = await this.recalculateUserMembership(
              user.id,
              user.totalPurchaseAmount,
              membershipTiers,
            );

            if (result.action === 'created') {
              totalCreated++;
            } else if (result.action === 'updated') {
              totalUpdated++;
            } else if (result.action === 'skipped_paid') {
              skippedPaid++;
            }

            totalUsersProcessed++;
          } catch (error) {
            this.logger.error(
              `Error processing user ${user.id}: ${error.message}`,
              error.stack,
            );
            errors++;
          }
        }

        this.logger.debug(
          `Batch ${batchNum}/${totalBatches} complete (${batch.length} users)`,
        );
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Membership recalculation completed in ${duration}ms. ` +
          `Processed: ${totalUsersProcessed}, Created: ${totalCreated}, ` +
          `Updated: ${totalUpdated}, Skipped (paid): ${skippedPaid}, Errors: ${errors}`,
      );

      return {
        totalUsersProcessed,
        totalUpdated,
        totalCreated,
        skippedPaid,
        errors,
      };
    } catch (error) {
      this.logger.error('Failed to recalculate memberships', error.stack);
      throw error;
    }
  }

  /**
   * Recalculate membership for a specific user.
   *
   * SOURCE-AWARE: If the user has a paid or admin-granted active membership,
   * the cron will NEVER downgrade or overwrite it.
   *
   * TRANSACTIONAL: The expire + create path is wrapped in $transaction
   * to prevent broken state if the process crashes mid-operation.
   */
  async recalculateUserMembership(
    userId: string,
    totalPurchaseAmount: number,
    membershipTiers?: MembershipTier[],
  ): Promise<{
    action: 'created' | 'updated' | 'unchanged' | 'skipped_paid';
  }> {
    if (!membershipTiers) {
      membershipTiers = await this.getMembershipTiers();
    }

    if (membershipTiers.length === 0) {
      this.logger.warn(`No membership tiers available for user ${userId}`);
      return { action: 'unchanged' };
    }

    const appropriateTier = this.determineAppropriateMembershipTier(
      totalPurchaseAmount,
      membershipTiers,
    );

    if (!appropriateTier) {
      this.logger.warn(
        `Could not determine appropriate tier for user ${userId} with purchase amount ${totalPurchaseAmount}`,
      );
      return { action: 'unchanged' };
    }

    const now = new Date();

    // SOURCE-AWARE CHECK: If user has ANY active paid or admin-granted membership,
    // the cron must NOT touch it — regardless of what tier the cron thinks they deserve.
    const paidActiveMembership = await this.prisma.userMembership.findFirst({
      where: {
        userId,
        status: 'normal',
        endDate: { gte: now },
        OR: [
          { paymentId: { not: null } },
          { updatedByAdmin: true },
        ],
      },
    });

    if (paidActiveMembership) {
      this.logger.debug(
        `User ${userId} has active paid/admin membership "${paidActiveMembership.membershipName}" — skipping`,
      );
      return { action: 'skipped_paid' };
    }

    // Check if user already has this auto-assigned tier and it's still active
    const existingMembership = await this.prisma.userMembership.findFirst({
      where: {
        userId,
        membershipId: appropriateTier.id,
        status: 'normal',
      },
      orderBy: { createdAt: 'desc' },
    });

    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    if (existingMembership) {
      if (
        existingMembership.endDate > now &&
        existingMembership.status === 'normal'
      ) {
        return { action: 'unchanged' };
      }

      // Extend expired same-tier membership
      await this.prisma.userMembership.update({
        where: { id: existingMembership.id },
        data: {
          endDate: oneYearFromNow,
          status: 'normal',
          level: appropriateTier.level,
        },
      });

      this.logger.debug(
        `Updated membership for user ${userId} to ${appropriateTier.name}`,
      );
      return { action: 'updated' };
    }

    // FIX: Wrap expire + create in $transaction to prevent broken state on crash
    await this.prisma.$transaction(async (tx) => {
      // Check for a different active auto-assigned membership
      const otherActiveMembership = await tx.userMembership.findFirst({
        where: {
          userId,
          status: 'normal',
          endDate: { gte: now },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (otherActiveMembership) {
        await tx.userMembership.update({
          where: { id: otherActiveMembership.id },
          data: {
            status: 'expired',
            endDate: now,
          },
        });

        this.logger.debug(
          `Expired old membership ${otherActiveMembership.membershipName} for user ${userId}`,
        );
      }

      await tx.userMembership.create({
        data: {
          userId,
          membershipId: appropriateTier.id,
          membershipName: appropriateTier.name,
          membershipDescription: appropriateTier.description || '',
          level: appropriateTier.level,
          status: 'normal',
          startDate: now,
          endDate: oneYearFromNow,
          // paymentId is null → auto-assigned by cron (distinguishable from paid)
        },
      });
    });

    this.logger.debug(
      `Created new membership ${appropriateTier.name} for user ${userId}`,
    );
    return { action: 'created' };
  }

  /**
   * Get all membership tiers sorted by minPrice (descending)
   */
  private async getMembershipTiers(): Promise<MembershipTier[]> {
    return this.prisma.membership.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        minPrice: true,
        level: true,
      },
      orderBy: {
        minPrice: 'desc',
      },
    });
  }

  /**
   * FIX: Replace N+1 with groupBy aggregation.
   * Single query to get total purchase amounts per user.
   */
  private async getUsersWithPurchaseAmounts(): Promise<
    Array<{ id: string; totalPurchaseAmount: number }>
  > {
    // Aggregate all successful membership payments by userId in ONE query
    const paymentTotals = await this.prisma.payment.groupBy({
      by: ['userId'],
      where: {
        targetType: 'MEMBERSHIP',
        status: 'SUCCESS',
      },
      _sum: {
        amount: true,
      },
    });

    // Get all user IDs (some users may have $0 in payments)
    const allUsers = await this.prisma.user.findMany({
      select: { id: true },
    });

    // Build a lookup map from the groupBy results
    const amountMap = new Map<string, number>();
    for (const row of paymentTotals) {
      amountMap.set(row.userId, Number(row._sum.amount ?? 0));
    }

    return allUsers.map((user) => ({
      id: user.id,
      totalPurchaseAmount: amountMap.get(user.id) ?? 0,
    }));
  }

  /**
   * Determine the appropriate membership tier for a given purchase amount.
   * Returns the highest tier that the user qualifies for.
   */
  private determineAppropriateMembershipTier(
    purchaseAmount: number,
    tiers: MembershipTier[],
  ): MembershipTier | null {
    // Tiers sorted by minPrice descending — first match is the highest qualifying tier
    for (const tier of tiers) {
      if (purchaseAmount >= tier.minPrice) {
        return tier;
      }
    }

    // Fallback: assign the lowest tier (last in desc-sorted array)
    return tiers.length > 0 ? tiers[tiers.length - 1] : null;
  }

  /**
   * Trigger recalculation after a tier's minPrice is updated.
   */
  async recalculateMembershipsAfterTierUpdate(updatedTierId: string) {
    this.logger.log(
      `Recalculating memberships after tier ${updatedTierId} was updated`,
    );

    const updatedTier = await this.prisma.membership.findUnique({
      where: { id: updatedTierId },
    });

    if (!updatedTier) {
      this.logger.warn(`Tier ${updatedTierId} not found`);
      return {
        totalUsersProcessed: 0,
        totalUpdated: 0,
        totalCreated: 0,
        skippedPaid: 0,
        errors: 0,
      };
    }

    return this.recalculateAllUserMemberships();
  }
}
