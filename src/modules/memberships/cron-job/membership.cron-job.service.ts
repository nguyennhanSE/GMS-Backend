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
   * Main method to recalculate all user memberships based on their purchase history
   * This should be called when:
   * 1. Admin updates membership minPrice
   * 2. Scheduled cron job runs
   */
  async recalculateAllUserMemberships(): Promise<{
    totalUsersProcessed: number;
    totalUpdated: number;
    totalCreated: number;
    errors: number;
  }> {
    this.logger.log('Starting membership recalculation for all users');

    const startTime = Date.now();
    let totalUsersProcessed = 0;
    let totalUpdated = 0;
    let totalCreated = 0;
    let errors = 0;

    try {
      // 1. Get all membership tiers sorted by minPrice descending
      const membershipTiers = await this.getMembershipTiers();

      if (membershipTiers.length === 0) {
        this.logger.warn('No membership tiers found. Skipping recalculation.');
        return {
          totalUsersProcessed: 0,
          totalUpdated: 0,
          totalCreated: 0,
          errors: 0,
        };
      }

      this.logger.log(`Found ${membershipTiers.length} membership tiers`);

      // 2. Get all users with their total purchase amounts
      const users = await this.getUsersWithPurchaseAmounts();

      this.logger.log(`Processing ${users.length} users`);

      // 3. Process each user
      for (const user of users) {
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

      const duration = Date.now() - startTime;
      this.logger.log(
        `Membership recalculation completed in ${duration}ms. ` +
          `Processed: ${totalUsersProcessed}, Created: ${totalCreated}, ` +
          `Updated: ${totalUpdated}, Errors: ${errors}`,
      );

      return { totalUsersProcessed, totalUpdated, totalCreated, errors };
    } catch (error) {
      this.logger.error('Failed to recalculate memberships', error.stack);
      throw error;
    }
  }

  /**
   * Recalculate membership for a specific user
   * Updates both UserMembership relation and User.membershipLevel field
   */
  async recalculateUserMembership(
    userId: string,
    totalPurchaseAmount: number,
    membershipTiers?: MembershipTier[],
  ): Promise<{ action: 'created' | 'updated' | 'unchanged' }> {
    // Get membership tiers if not provided
    if (!membershipTiers) {
      membershipTiers = await this.getMembershipTiers();
    }

    if (membershipTiers.length === 0) {
      this.logger.warn(`No membership tiers available for user ${userId}`);
      return { action: 'unchanged' };
    }

    // Determine appropriate membership tier based on purchase amount
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

    // Check if user already has this membership
    const existingMembership = await this.prisma.userMembership.findFirst({
      where: {
        userId: userId,
        membershipId: appropriateTier.id,
        status: 'normal',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const now = new Date();
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    // If user already has this membership and it's still active, check if it needs updating
    if (existingMembership) {
      // If the membership is still valid and active, just check if it needs updating
      if (
        existingMembership.endDate > now &&
        existingMembership.status === 'normal'
      ) {
        return { action: 'unchanged' };
      }

      // Update the existing membership (extend validity period)
      await this.prisma.userMembership.update({
        where: {
          id: existingMembership.id,
        },
        data: {
          endDate: oneYearFromNow,
          status: 'normal',
          level: appropriateTier.level,
          updatedAt: now,
        },
      });

      this.logger.debug(
        `Updated membership for user ${userId} to ${appropriateTier.name}`,
      );
      return { action: 'updated' };
    }

    // Check if user has a different active membership
    const otherActiveMembership = await this.prisma.userMembership.findFirst({
      where: {
        userId: userId,
        status: 'normal',
        endDate: { gte: now },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // If user has a different active membership, expire it
    if (otherActiveMembership) {
      await this.prisma.userMembership.update({
        where: {
          id: otherActiveMembership.id,
        },
        data: {
          status: 'expired',
          endDate: now,
          updatedAt: now,
        },
      });

      this.logger.debug(
        `Expired old membership ${otherActiveMembership.membershipName} for user ${userId}`,
      );
    }

    // Create new membership for the user
    await this.prisma.userMembership.create({
      data: {
        userId: userId,
        membershipId: appropriateTier.id,
        membershipName: appropriateTier.name,
        membershipDescription: appropriateTier.description || '',
        level: appropriateTier.level,
        status: 'normal',
        startDate: now,
        endDate: oneYearFromNow,
      },
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
   * Get all users with their total purchase amounts from orders
   */
  private async getUsersWithPurchaseAmounts(): Promise<
    Array<{ id: string; totalPurchaseAmount: number }>
  > {
    // Calculate total purchase amount per user from completed membership payments
    const result = await this.prisma.$transaction<
      Array<{ id: string; totalPurchaseAmount: number }>
    >(async (tx) => {
      // Get all users with their memberships
      const users = await tx.user.findMany({
        select: {
          id: true,
          userMembership: {
            select: {
              id: true,
              startDate: true,
            },
          },
        },
      });

      // Calculate total purchase amount for each user
      const usersWithAmounts: Array<{
        id: string;
        totalPurchaseAmount: number;
      }> = [];

      for (const user of users) {
        let totalPurchaseAmount = 0;

        // Sum up all successful payments for this user
        const payments = await tx.payment.findMany({
          where: {
            userId: user.id,
            targetType: 'MEMBERSHIP',
            status: 'SUCCESS',
          },
          select: {
            amount: true,
          },
        });

        totalPurchaseAmount = payments.reduce(
          (sum, p) => sum + Number(p.amount),
          0,
        );

        usersWithAmounts.push({
          id: user.id,
          totalPurchaseAmount,
        });
      }

      return usersWithAmounts;
    });

    return result;
  }

  /**
   * Determine the appropriate membership tier for a given purchase amount
   * Returns the highest tier that the user qualifies for
   */
  private determineAppropriateMembershipTier(
    purchaseAmount: number,
    tiers: MembershipTier[],
  ): MembershipTier | null {
    // Tiers should be sorted by minPrice descending
    // Return the first tier where purchase amount >= minPrice
    for (const tier of tiers) {
      if (purchaseAmount >= tier.minPrice) {
        return tier;
      }
    }

    // If no tier matches, return the lowest tier (last in the sorted array)
    return tiers.length > 0 ? tiers[tiers.length - 1] : null;
  }

  /**
   * Recalculate memberships for users whose purchase amounts fall within a specific range
   * Useful after updating a specific membership tier's minPrice
   */
  async recalculateMembershipsAfterTierUpdate(updatedTierId: string): Promise<{
    totalUsersProcessed: number;
    totalUpdated: number;
    totalCreated: number;
    errors: number;
  }> {
    this.logger.log(
      `Recalculating memberships after tier ${updatedTierId} was updated`,
    );

    // Get the updated tier
    const updatedTier = await this.prisma.membership.findUnique({
      where: { id: updatedTierId },
    });

    if (!updatedTier) {
      this.logger.warn(`Tier ${updatedTierId} not found`);
      return {
        totalUsersProcessed: 0,
        totalUpdated: 0,
        totalCreated: 0,
        errors: 0,
      };
    }

    // Get all tiers to determine affected users
    const allTiers = await this.getMembershipTiers();

    // Find the next tier (lower minPrice)
    const sortedTiers = [...allTiers].sort((a, b) => b.minPrice - a.minPrice);
    const updatedTierIndex = sortedTiers.findIndex(
      (t) => t.id === updatedTierId,
    );
    const nextLowerTier = sortedTiers[updatedTierIndex + 1];

    // Determine the range of users to update
    const minAmount = nextLowerTier ? nextLowerTier.minPrice : 0;
    const maxAmount = updatedTier.minPrice;

    // For simplicity, we'll just recalculate all users
    // In a production system, you might want to optimize this by only processing affected users
    return await this.recalculateAllUserMemberships();
  }
}
