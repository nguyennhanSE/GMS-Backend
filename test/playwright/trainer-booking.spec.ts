import { expect, test, type APIRequestContext } from '@playwright/test';
import { TrainerBookingStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays, getErrorMessage, getNextDayOfWeek } from '../test-helpers';
import {
  createApiContext,
  createStripeWebhookEvent,
  loginAs,
} from './api-helpers';

type TestUser = {
  id: string;
  email: string;
  password: string;
};

const prisma = new PrismaService();
const TEST_PASSWORD = 'PlaywrightTrainerBooking@123';
const suitePrefix = 'playwright-trainer-booking-';
const suiteKey = `${suitePrefix}${Date.now()}`;
const freeTrainerAvailabilitySeed = [
  { dayOfWeek: 2, startHour: 9, startMinute: 0, endHour: 13, endMinute: 0 },
  { dayOfWeek: 3, startHour: 9, startMinute: 0, endHour: 13, endMinute: 0 },
  { dayOfWeek: 4, startHour: 9, startMinute: 0, endHour: 13, endMinute: 0 },
] as const;
const classConflictTrainerAvailabilitySeed = [
  { dayOfWeek: 2, startHour: 9, startMinute: 0, endHour: 12, endMinute: 0 },
] as const;

test.describe('Trainer Booking Playwright API E2E', () => {
  let anonymousApi: APIRequestContext;
  let adminApi: APIRequestContext;
  let memberApi: APIRequestContext;
  let otherMemberApi: APIRequestContext;
  let freeTrainerApi: APIRequestContext;
  let classConflictTrainerApi: APIRequestContext;

  let memberUser: TestUser;
  let otherMemberUser: TestUser;
  let adminUser: TestUser;
  let freeTrainerUser: TestUser;
  let classConflictTrainerUser: TestUser;

  let membershipId: string;
  let conflictClassId: string;
  let conflictScheduleId: string;

  test.beforeAll(async () => {
    await prisma.$connect();
    await cleanupSuiteState();
    await setupBaseFixtures();

    anonymousApi = await createApiContext();
    adminApi = await createAuthenticatedContext(adminUser);
    memberApi = await createAuthenticatedContext(memberUser);
    otherMemberApi = await createAuthenticatedContext(otherMemberUser);
    freeTrainerApi = await createAuthenticatedContext(freeTrainerUser);
    classConflictTrainerApi =
      await createAuthenticatedContext(classConflictTrainerUser);
  });

  test.afterEach(async () => {
    await clearPerTestState();
  });

  test.afterAll(async () => {
    await Promise.all([
      anonymousApi?.dispose(),
      adminApi?.dispose(),
      memberApi?.dispose(),
      otherMemberApi?.dispose(),
      freeTrainerApi?.dispose(),
      classConflictTrainerApi?.dispose(),
    ]);
    await cleanupSuiteState();
    await prisma.$disconnect();
  });

  async function createAuthenticatedContext(
    user: TestUser,
  ): Promise<APIRequestContext> {
    const login = await loginAs(anonymousApi, user.email, user.password);
    return createApiContext(login.accessToken);
  }

  test('lists trainers, returns trainer booking profile details, and exposes slot lookup', async () => {
    const slotDay = getNextDayOfWeek('WED');
    const trainersResponse = await memberApi.get('trainer-bookings/trainers', {
      params: {
        specialization: 'Strength',
        availableOnly: 'true',
        date: slotDay.toISOString(),
      },
    });

    expect(trainersResponse.status()).toBe(200);

    const trainersBody = (await trainersResponse.json()) as {
      data: Array<{
        id: string;
        specialization: string;
        experience: number;
        canBook: boolean;
        pricing: Record<string, number>;
      }>;
    };
    const listedTrainer = trainersBody.data.find(
      (candidate) => candidate.id === freeTrainerUser.id,
    );

    expect(listedTrainer).toEqual(
      expect.objectContaining({
        id: freeTrainerUser.id,
        specialization: 'Strength',
        experience: 5,
        canBook: true,
      }),
    );
    expect(listedTrainer?.pricing['60']).toBe(350000);

    const profileResponse = await memberApi.get(
      `trainer-bookings/trainers/${freeTrainerUser.id}`,
    );

    expect(profileResponse.status()).toBe(200);
    const profileBody = (await profileResponse.json()) as {
      data: {
        id: string;
        specialization: string;
        biography: string;
        certifications: string[];
        areasOfExpertise: string[];
      };
    };

    expect(profileBody.data).toEqual(
      expect.objectContaining({
        id: freeTrainerUser.id,
        specialization: 'Strength',
        biography: 'Strength trainer profile',
        certifications: ['NASM'],
        areasOfExpertise: ['Strength'],
      }),
    );

    const slotsResponse = await memberApi.get(
      `trainer-bookings/trainers/${freeTrainerUser.id}/slots`,
      {
        params: {
          from: slotDay.toISOString(),
          to: addDays(slotDay, 1).toISOString(),
        },
      },
    );

    expect(slotsResponse.status()).toBe(200);
    const slotsBody = (await slotsResponse.json()) as {
      data: Array<{
        startAt: string;
        endAt: string;
        durations: number[];
      }>;
    };

    expect(Array.isArray(slotsBody.data)).toBe(true);
    expect(slotsBody.data.length).toBeGreaterThan(0);
    expect(slotsBody.data[0]).toEqual(
      expect.objectContaining({
        startAt: expect.any(String),
        endAt: expect.any(String),
        durations: expect.arrayContaining([30, 60]),
      }),
    );
  });

  test('propagates trainer availability changes made through the trainer API into booking slots and booking validation', async () => {
    const slotDay = getNextDayOfWeek('WED');
    const shiftedAvailabilityResponse = await freeTrainerApi.put(
      `trainer/${freeTrainerUser.id}/availability`,
      {
        data: {
          slots: [
            { dayOfWeek: 'WED', startTime: '15:00', endTime: '17:00' },
          ],
        },
      },
    );
    expect(shiftedAvailabilityResponse.status()).toBe(200);

    const slotsResponse = await memberApi.get(
      `trainer-bookings/trainers/${freeTrainerUser.id}/slots`,
      {
        params: {
          from: slotDay.toISOString(),
          to: addDays(slotDay, 1).toISOString(),
        },
      },
    );
    expect(slotsResponse.status()).toBe(200);

    const slotsBody = (await slotsResponse.json()) as {
      data: Array<{
        startAt: string;
        endAt: string;
        durations: number[];
      }>;
    };

    const shiftedSlot = createSlot('WED', 15, 0, 120);
    const oldMorningSlot = createSlot('WED', 9, 0, 60);

    expect(slotsBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startAt: shiftedSlot.startAt.toISOString(),
          endAt: shiftedSlot.endAt.toISOString(),
          durations: expect.arrayContaining([30, 60, 90]),
        }),
      ]),
    );
    expect(
      slotsBody.data.find(
        (slot) => slot.startAt === oldMorningSlot.startAt.toISOString(),
      ),
    ).toBeUndefined();

    const outsideHoursResponse = await memberApi.post('trainer-bookings', {
      data: {
        trainerId: freeTrainerUser.id,
        startAt: oldMorningSlot.startAt.toISOString(),
        endAt: oldMorningSlot.endAt.toISOString(),
      },
    });
    expect(outsideHoursResponse.status()).toBe(400);
    expect(getErrorMessage(await outsideHoursResponse.json())).toContain(
      'The requested time is outside the trainer working hours',
    );

    const shiftedBooking = await createBookingRequest(
      memberApi,
      freeTrainerUser.id,
      createSlot('WED', 15, 0, 60),
    );
    expect(shiftedBooking.status).toBe(TrainerBookingStatus.PENDING_REVIEW);
  });

  test('creates a trainer booking and limits list/detail access to authorized actors', async () => {
    const bookingA = await createBookingRequest(
      memberApi,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );
    const bookingB = await createBookingRequest(
      otherMemberApi,
      freeTrainerUser.id,
      createSlot('WED', 11, 0, 60),
    );

    expect(bookingA.status).toBe(TrainerBookingStatus.PENDING_REVIEW);
    expect(bookingB.status).toBe(TrainerBookingStatus.PENDING_REVIEW);

    const memberListResponse = await memberApi.get('trainer-bookings/me');
    expect(memberListResponse.status()).toBe(200);
    const memberListBody = (await memberListResponse.json()) as {
      data: Array<{ id: string }>;
    };
    expect(memberListBody.data).toHaveLength(1);
    expect(memberListBody.data[0].id).toBe(bookingA.id);

    const trainerListResponse = await freeTrainerApi.get(
      'trainer-bookings/trainer/me',
    );
    expect(trainerListResponse.status()).toBe(200);
    const trainerListBody = (await trainerListResponse.json()) as {
      data: Array<{ id: string }>;
    };
    expect(
      trainerListBody.data.map((item) => item.id).sort(),
    ).toEqual([bookingA.id, bookingB.id].sort());

    const memberDetailResponse = await memberApi.get(
      `trainer-bookings/${bookingA.id}`,
    );
    expect(memberDetailResponse.status()).toBe(200);

    const trainerDetailResponse = await freeTrainerApi.get(
      `trainer-bookings/${bookingA.id}`,
    );
    expect(trainerDetailResponse.status()).toBe(200);

    const adminDetailResponse = await adminApi.get(
      `trainer-bookings/${bookingA.id}`,
    );
    expect(adminDetailResponse.status()).toBe(200);

    const unauthorizedDetailResponse = await otherMemberApi.get(
      `trainer-bookings/${bookingA.id}`,
    );
    expect(unauthorizedDetailResponse.status()).toBe(403);
  });

  test('requires an active membership before a member can create a trainer booking', async () => {
    await prisma.userMembership.deleteMany({
      where: { userId: memberUser.id },
    });

    const slot = createSlot('WED', 10, 0, 60);
    const response = await memberApi.post('trainer-bookings', {
      data: {
        trainerId: freeTrainerUser.id,
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
      },
    });

    expect(response.status()).toBe(403);
    expect(getErrorMessage(await response.json())).toContain(
      'An active membership is required to book a trainer',
    );
  });

  test('prevents concurrent overlapping create attempts from producing multiple blocking bookings', async () => {
    const slot = createSlot('THU', 10, 0, 60);

    const [firstResponse, secondResponse] = await Promise.all([
      memberApi.post('trainer-bookings', {
        data: {
          trainerId: freeTrainerUser.id,
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
        },
      }),
      otherMemberApi.post('trainer-bookings', {
        data: {
          trainerId: freeTrainerUser.id,
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
        },
      }),
    ]);

    const statuses = [firstResponse.status(), secondResponse.status()].sort();
    expect(statuses).toEqual([201, 400]);

    const blockingBookings = await prisma.trainerBooking.findMany({
      where: {
        trainerId: freeTrainerUser.id,
        startAt: slot.startAt,
        endAt: slot.endAt,
        status: {
          in: [
            TrainerBookingStatus.PENDING_REVIEW,
            TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT,
            TrainerBookingStatus.CONFIRMED,
          ],
        },
      },
    });

    expect(blockingBookings).toHaveLength(1);
  });

  test('accepts a booking, blocks checkout for other members, and confirms after payment success', async () => {
    const booking = await createBookingRequest(
      memberApi,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );

    await waitForNotificationTitles(booking.id, [
      'Trainer booking requested',
      'New trainer booking request',
    ]);

    const acceptResponse = await freeTrainerApi.post(
      `trainer-bookings/${booking.id}/accept`,
    );
    expect(acceptResponse.status()).toBe(201);

    const forbiddenCheckoutResponse = await otherMemberApi.post(
      'payments/checkout',
      {
        data: {
          targetType: 'TRAINER_BOOKING',
          targetId: booking.id,
        },
      },
    );
    expect(forbiddenCheckoutResponse.status()).toBe(403);

    const checkoutResponse = await memberApi.post('payments/checkout', {
      data: {
        targetType: 'TRAINER_BOOKING',
        targetId: booking.id,
      },
    });
    expect(checkoutResponse.status()).toBe(201);

    const checkoutBody = (await checkoutResponse.json()) as {
      data?: { checkoutUrl?: string };
      checkoutUrl?: string;
    };
    const checkoutUrl =
      checkoutBody.data?.checkoutUrl ?? checkoutBody.checkoutUrl ?? '';
    expect(checkoutUrl).toContain('http');

    const payment = await getPaymentForBooking(booking.id);
    expect(Number(payment.amount)).toBe(350000);
    expect(payment.currency).toBe('VND');

    await triggerStripeWebhook({
      id: `evt_trainer_booking_success_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: payment.providerSessionId,
          payment_intent: `pi_trainer_booking_success_${Date.now()}`,
        },
      },
    });

    await expect
      .poll(
        async () =>
          (
            await prisma.trainerBooking.findUnique({
              where: { id: booking.id },
              select: { status: true },
            })
          )?.status ?? null,
        { timeout: 10000 },
      )
      .toBe(TrainerBookingStatus.CONFIRMED);

    await waitForNotificationTitles(booking.id, [
      'Trainer booking requested',
      'New trainer booking request',
      'Trainer booking accepted',
      'Trainer booking confirmed',
    ]);
  });

  test('blocks checkout after a trainer rejects the booking', async () => {
    const booking = await createBookingRequest(
      memberApi,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );

    const rejectResponse = await freeTrainerApi.post(
      `trainer-bookings/${booking.id}/reject`,
      {
        data: { reason: 'Unavailable' },
      },
    );

    expect(rejectResponse.status()).toBe(201);

    const checkoutResponse = await memberApi.post('payments/checkout', {
      data: {
        targetType: 'TRAINER_BOOKING',
        targetId: booking.id,
      },
    });

    expect(checkoutResponse.status()).toBe(400);
  });

  test('marks payment failure as terminal and releases the slot for a new request', async () => {
    const slot = createSlot('WED', 10, 0, 60);
    const booking = await createAcceptedBooking(
      memberApi,
      freeTrainerUser.id,
      slot,
    );

    const checkoutResponse = await memberApi.post('payments/checkout', {
      data: {
        targetType: 'TRAINER_BOOKING',
        targetId: booking.id,
      },
    });
    expect(checkoutResponse.status()).toBe(201);

    const payment = await getPaymentForBooking(booking.id);

    await triggerStripeWebhook({
      id: `evt_trainer_booking_failed_${Date.now()}`,
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: `pi_trainer_booking_failed_${Date.now()}`,
          metadata: {
            paymentId: payment.id,
          },
        },
      },
    });

    await expect
      .poll(
        async () =>
          (
            await prisma.trainerBooking.findUnique({
              where: { id: booking.id },
              select: { status: true },
            })
          )?.status ?? null,
        { timeout: 10000 },
      )
      .toBe(TrainerBookingStatus.PAYMENT_FAILED);

    await waitForNotificationTitles(booking.id, [
      'Trainer booking requested',
      'New trainer booking request',
      'Trainer booking accepted',
      'Payment failed',
    ]);

    const retriedBooking = await createBookingRequest(
      memberApi,
      freeTrainerUser.id,
      slot,
    );
    expect(retriedBooking.status).toBe(TrainerBookingStatus.PENDING_REVIEW);
  });

  test('allows member cancellation only when confirmed bookings are at least 24 hours away', async () => {
    const futureBooking = await createConfirmedBooking(
      memberApi,
      freeTrainerUser.id,
      createSlot('THU', 10, 0, 60),
    );

    const allowedResponse = await memberApi.post(
      `trainer-bookings/${futureBooking.id}/cancel`,
      {
        data: {},
      },
    );

    expect(allowedResponse.status()).toBe(201);
    const allowedBody = (await allowedResponse.json()) as {
      data: { status: TrainerBookingStatus };
    };
    expect(allowedBody.data.status).toBe(TrainerBookingStatus.CANCELLED);

    const nearStart = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const nearEnd = new Date(nearStart.getTime() + 60 * 60 * 1000);
    const blockedBooking = await prisma.trainerBooking.create({
      data: {
        memberId: memberUser.id,
        trainerId: freeTrainerUser.id,
        startAt: nearStart,
        endAt: nearEnd,
        status: TrainerBookingStatus.CONFIRMED,
        price: 350000,
        currency: 'VND',
      },
    });

    const blockedResponse = await memberApi.post(
      `trainer-bookings/${blockedBooking.id}/cancel`,
      {
        data: {},
      },
    );

    expect(blockedResponse.status()).toBe(400);
    expect(getErrorMessage(await blockedResponse.json())).toContain(
      'Confirmed bookings can only be cancelled at least 24 hours before the session',
    );
  });

  test('requires a reason when a trainer cancels a confirmed booking', async () => {
    const booking = await createConfirmedBooking(
      memberApi,
      freeTrainerUser.id,
      createSlot('THU', 10, 0, 60),
    );

    const missingReasonResponse = await freeTrainerApi.post(
      `trainer-bookings/${booking.id}/cancel`,
      {
        data: {},
      },
    );

    expect(missingReasonResponse.status()).toBe(400);
    expect(getErrorMessage(await missingReasonResponse.json())).toContain(
      'A cancellation reason is required when a trainer cancels a confirmed booking',
    );

    const withReasonResponse = await freeTrainerApi.post(
      `trainer-bookings/${booking.id}/cancel`,
      {
        data: { reason: 'Emergency schedule change' },
      },
    );

    expect(withReasonResponse.status()).toBe(201);
    const withReasonBody = (await withReasonResponse.json()) as {
      data: { status: TrainerBookingStatus; cancelReason: string };
    };
    expect(withReasonBody.data.status).toBe(TrainerBookingStatus.CANCELLED);
    expect(withReasonBody.data.cancelReason).toBe('Emergency schedule change');
  });

  test('allows the trainer to complete a confirmed booking', async () => {
    const booking = await createConfirmedBooking(
      memberApi,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );

    const completeResponse = await freeTrainerApi.post(
      `trainer-bookings/${booking.id}/complete`,
    );

    expect(completeResponse.status()).toBe(201);
    const completeBody = (await completeResponse.json()) as {
      data: { status: TrainerBookingStatus };
    };
    expect(completeBody.data.status).toBe(TrainerBookingStatus.COMPLETED);
  });

  test('rejects booking creation when the trainer has an active class schedule at that time', async () => {
    const slot = createSlot('TUE', 9, 0, 60);
    const response = await memberApi.post('trainer-bookings', {
      data: {
        trainerId: classConflictTrainerUser.id,
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
      },
    });

    expect(response.status()).toBe(400);
    expect(getErrorMessage(await response.json())).toContain(
      'The trainer already has an active class scheduled during this time',
    );
  });

  test('rejects booking creation when the member already has a class booking at that time', async () => {
    const slot = createSlot('TUE', 9, 0, 60);
    await prisma.classBooking.create({
      data: {
        userId: memberUser.id,
        classScheduleId: conflictScheduleId,
        bookingStartDate: getNextDayOfWeek('TUE'),
        bookingEndDate: addDays(getNextDayOfWeek('TUE'), 7),
        status: 'confirmed',
      },
    });

    const response = await memberApi.post('trainer-bookings', {
      data: {
        trainerId: freeTrainerUser.id,
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
      },
    });

    expect(response.status()).toBe(400);
    expect(getErrorMessage(await response.json())).toContain(
      'The member already has a class booking during this time',
    );
  });

  test('rechecks trainer-side cross-domain conflicts at accept time', async () => {
    const slot = createSlot('WED', 10, 0, 60);
    const booking = await createBookingRequest(memberApi, freeTrainerUser.id, slot);
    const temporaryClass = await prisma.gymClass.create({
      data: {
        className: `${suiteKey}-accept-conflict-class`,
        description: 'accept-time trainer conflict',
        difficultyLevel: 'Beginner',
        category: 'Testing',
        isActive: true,
      },
    });

    const temporarySchedule = await prisma.classSchedule.create({
      data: {
        classId: temporaryClass.id,
        trainerId: freeTrainerUser.id,
        dayOfWeek: 'WED',
        startTime: buildClockTime(10, 0),
        endTime: buildClockTime(11, 0),
        capacity: 5,
        isActive: true,
        location: 'Studio Accept Conflict',
        validFrom: getNextDayOfWeek('WED'),
        validUntil: addDays(getNextDayOfWeek('WED'), 7),
      },
    });

    try {
      const acceptResponse = await freeTrainerApi.post(
        `trainer-bookings/${booking.id}/accept`,
      );

      expect(acceptResponse.status()).toBe(400);
      expect(getErrorMessage(await acceptResponse.json())).toContain(
        'The trainer already has an active class scheduled during this time',
      );
    } finally {
      await prisma.classSchedule.deleteMany({
        where: { id: temporarySchedule.id },
      });
      await prisma.gymClass.deleteMany({
        where: { id: temporaryClass.id },
      });
    }
  });

  test('rechecks member-side class conflicts at accept time', async () => {
    const slot = createSlot('TUE', 9, 0, 60);
    const booking = await createBookingRequest(memberApi, freeTrainerUser.id, slot);

    await prisma.classBooking.create({
      data: {
        userId: memberUser.id,
        classScheduleId: conflictScheduleId,
        bookingStartDate: getNextDayOfWeek('TUE'),
        bookingEndDate: addDays(getNextDayOfWeek('TUE'), 7),
        status: 'confirmed',
      },
    });

    const acceptResponse = await freeTrainerApi.post(
      `trainer-bookings/${booking.id}/accept`,
    );

    expect(acceptResponse.status()).toBe(400);
    expect(getErrorMessage(await acceptResponse.json())).toContain(
      'The member already has a class booking during this time',
    );
  });

  test('releases a stale pending-review slot through lazy expiry', async () => {
    const slot = createSlot('THU', 11, 0, 60);
    await prisma.trainerBooking.create({
      data: {
        memberId: memberUser.id,
        trainerId: freeTrainerUser.id,
        startAt: slot.startAt,
        endAt: slot.endAt,
        status: TrainerBookingStatus.PENDING_REVIEW,
        price: 350000,
        currency: 'VND',
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });

    const freshBooking = await createBookingRequest(
      memberApi,
      freeTrainerUser.id,
      slot,
    );
    expect(freshBooking.status).toBe(TrainerBookingStatus.PENDING_REVIEW);

    const expiredBookings = await prisma.trainerBooking.findMany({
      where: {
        trainerId: freeTrainerUser.id,
        startAt: slot.startAt,
        status: TrainerBookingStatus.EXPIRED,
      },
    });
    expect(expiredBookings).toHaveLength(1);
  });

  async function setupBaseFixtures(): Promise<void> {
    const hashedPassword = String(await bcrypt.hash(TEST_PASSWORD, 10));

    const memberRole = await ensureRole('MEMBER');
    const adminRole = await ensureRole('ADMIN');
    const trainerRole = await ensureRole('TRAINER');
    const memberRoleId = String(memberRole.id);
    const adminRoleId = String(adminRole.id);
    const trainerRoleId = String(trainerRole.id);

    memberUser = await createUser(
      `${suiteKey}-member@test.local`,
      'Member',
      memberRoleId,
      hashedPassword,
    );
    otherMemberUser = await createUser(
      `${suiteKey}-other-member@test.local`,
      'Other Member',
      memberRoleId,
      hashedPassword,
    );
    adminUser = await createUser(
      `${suiteKey}-admin@test.local`,
      'Admin',
      adminRoleId,
      hashedPassword,
    );
    freeTrainerUser = await createUser(
      `${suiteKey}-free-trainer@test.local`,
      'Free Trainer',
      trainerRoleId,
      hashedPassword,
    );
    classConflictTrainerUser = await createUser(
      `${suiteKey}-class-trainer@test.local`,
      'Class Trainer',
      trainerRoleId,
      hashedPassword,
    );

    membershipId = await ensureMembershipTier();
    await grantActiveMembership(memberUser.id);
    await grantActiveMembership(otherMemberUser.id);

    await configureTrainerProfile(freeTrainerUser.id, 'Strength');
    await configureTrainerProfile(classConflictTrainerUser.id, 'Mobility');

    await reseedTrainerAvailabilityFixtures();

    const conflictClass = await prisma.gymClass.create({
      data: {
        className: `${suiteKey}-conflict-class`,
        description: 'Trainer booking cross-domain conflict class',
        difficultyLevel: 'Beginner',
        category: 'Testing',
        isActive: true,
      },
    });
    conflictClassId = conflictClass.id;

    const conflictTuesday = getNextDayOfWeek('TUE');
    const schedule = await prisma.classSchedule.create({
      data: {
        classId: conflictClass.id,
        trainerId: classConflictTrainerUser.id,
        dayOfWeek: 'TUE',
        startTime: buildClockTime(9, 0),
        endTime: buildClockTime(10, 0),
        capacity: 5,
        isActive: true,
        location: 'Studio TB',
        validFrom: conflictTuesday,
        validUntil: addDays(conflictTuesday, 30),
      },
    });
    conflictScheduleId = schedule.id;
  }

  async function createUser(
    email: string,
    label: string,
    roleId: string,
    hashedPassword: string,
  ): Promise<TestUser> {
    const user = await prisma.user.create({
      data: {
        firstName: `PW ${label}`,
        lastName: 'API',
        email,
        password: hashedPassword,
        status: 'active',
        userRole: {
          create: {
            roleId,
          },
        },
      },
    });

    return {
      id: user.id,
      email: user.email,
      password: TEST_PASSWORD,
    };
  }

  async function ensureRole(name: string): Promise<{ id: string }> {
    return prisma.role.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: `${name} role`,
      },
    });
  }

  async function ensureMembershipTier() {
    const membership = await prisma.membership.create({
      data: {
        name: `${suiteKey}-membership`,
        description: 'Trainer booking Playwright membership',
        minPrice: 100000,
        purchasePrice: 100000,
        level: 'BASIC',
      },
    });

    return membership.id;
  }

  async function grantActiveMembership(userId: string) {
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    const now = new Date();

    await prisma.userMembership.create({
      data: {
        userId,
        membershipId,
        membershipName: membership.name,
        membershipDescription: membership.description ?? '',
        status: 'normal',
        level: membership.level,
        startDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  async function configureTrainerProfile(userId: string, specialization: string) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        trainerSpecialization: specialization,
        trainerExperienceYears: 5,
        trainerBiography: `${specialization} trainer profile`,
        trainerCertifications: ['NASM'],
        trainerAreasOfExpertise: [specialization],
        ptSessionPrice30: 200000,
        ptSessionPrice60: 350000,
        ptSessionPrice90: 500000,
      },
    });
  }

  async function seedTrainerAvailability(
    trainerId: string,
    dayOfWeek: number,
    startHour: number,
    startMinute: number,
    endHour: number,
    endMinute: number,
  ) {
    await prisma.trainerAvailability.create({
      data: {
        trainerId,
        dayOfWeek,
        startTime: buildClockTime(startHour, startMinute),
        endTime: buildClockTime(endHour, endMinute),
        isAvailable: true,
      },
    });
  }

  async function reseedTrainerAvailabilityFixtures() {
    await prisma.trainerAvailability.deleteMany({
      where: {
        trainerId: {
          in: [freeTrainerUser.id, classConflictTrainerUser.id],
        },
      },
    });

    for (const slot of freeTrainerAvailabilitySeed) {
      await seedTrainerAvailability(
        freeTrainerUser.id,
        slot.dayOfWeek,
        slot.startHour,
        slot.startMinute,
        slot.endHour,
        slot.endMinute,
      );
    }

    for (const slot of classConflictTrainerAvailabilitySeed) {
      await seedTrainerAvailability(
        classConflictTrainerUser.id,
        slot.dayOfWeek,
        slot.startHour,
        slot.startMinute,
        slot.endHour,
        slot.endMinute,
      );
    }
  }

  function createSlot(
    dayOfWeek: 'TUE' | 'WED' | 'THU',
    hour: number,
    minute: number,
    durationMinutes: number,
  ) {
    const day = getNextDayOfWeek(dayOfWeek);
    const startAt = new Date(day);
    startAt.setUTCHours(hour, minute, 0, 0);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
    return { startAt, endAt };
  }

  function buildClockTime(hour: number, minute: number) {
    return new Date(Date.UTC(1970, 0, 1, hour, minute, 0, 0));
  }

  async function createBookingRequest(
    api: APIRequestContext,
    trainerId: string,
    slot: { startAt: Date; endAt: Date },
  ) {
    const response = await api.post('trainer-bookings', {
      data: {
        trainerId,
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
        notes: 'Playwright trainer booking request',
      },
    });

    expect(response.status()).toBe(201);
    const body = (await response.json()) as {
      data: {
        id: string;
        status: TrainerBookingStatus;
      };
    };
    return body.data;
  }

  async function createAcceptedBooking(
    api: APIRequestContext,
    trainerId: string,
    slot: { startAt: Date; endAt: Date },
  ) {
    const booking = await createBookingRequest(api, trainerId, slot);
    const trainerApi =
      trainerId === freeTrainerUser.id ? freeTrainerApi : classConflictTrainerApi;

    const acceptResponse = await trainerApi.post(
      `trainer-bookings/${booking.id}/accept`,
    );
    expect(acceptResponse.status()).toBe(201);

    const acceptBody = (await acceptResponse.json()) as {
      data: { id: string; status: TrainerBookingStatus };
    };
    return acceptBody.data;
  }

  async function createConfirmedBooking(
    api: APIRequestContext,
    trainerId: string,
    slot: { startAt: Date; endAt: Date },
  ) {
    const booking = await createAcceptedBooking(api, trainerId, slot);
    const checkoutResponse = await api.post('payments/checkout', {
      data: {
        targetType: 'TRAINER_BOOKING',
        targetId: booking.id,
      },
    });
    expect(checkoutResponse.status()).toBe(201);

    const payment = await getPaymentForBooking(booking.id);
    await triggerStripeWebhook({
      id: `evt_${booking.id}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: payment.providerSessionId,
          payment_intent: `pi_${booking.id}`,
        },
      },
    });

    await expect
      .poll(
        async () =>
          (
            await prisma.trainerBooking.findUnique({
              where: { id: booking.id },
              select: { status: true },
            })
          )?.status ?? null,
        { timeout: 10000 },
      )
      .toBe(TrainerBookingStatus.CONFIRMED);

    return prisma.trainerBooking.findUniqueOrThrow({
      where: { id: booking.id },
    });
  }

  async function getPaymentForBooking(bookingId: string) {
    return prisma.payment.findFirstOrThrow({
      where: {
        targetType: 'TRAINER_BOOKING',
        targetId: bookingId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async function triggerStripeWebhook(event: Record<string, unknown>) {
    const { body, signature } = createStripeWebhookEvent(event);
    const response = await anonymousApi.post('payments/webhook/stripe', {
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      data: body,
    });

    expect(response.status()).toBe(200);
  }

  async function waitForNotificationTitles(
    referenceId: string,
    expectedTitles: string[],
  ) {
    await expect
      .poll(
        async () => {
          const notifications = await prisma.notification.findMany({
            where: { referenceId },
            select: { title: true },
          });
          return notifications.map((item) => item.title);
        },
        { timeout: 10000 },
      )
      .toEqual(expect.arrayContaining(expectedTitles));
  }

  async function clearPerTestState() {
    const userIds = [
      memberUser.id,
      otherMemberUser.id,
      adminUser.id,
      freeTrainerUser.id,
      classConflictTrainerUser.id,
    ];

    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.payment.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.trainerBooking.deleteMany({
      where: {
        OR: [
          { memberId: { in: userIds } },
          { trainerId: { in: userIds } },
        ],
      },
    });
    await prisma.classBooking.deleteMany({
      where: {
        OR: [
          { userId: { in: [memberUser.id, otherMemberUser.id] } },
          { classScheduleId: conflictScheduleId },
        ],
      },
    });
    await prisma.userMembership.deleteMany({
      where: {
        userId: { in: [memberUser.id, otherMemberUser.id] },
      },
    });

    await reseedTrainerAvailabilityFixtures();
    await grantActiveMembership(memberUser.id);
    await grantActiveMembership(otherMemberUser.id);
  }

  async function cleanupSuiteState() {
    const conflictClasses = await prisma.gymClass.findMany({
      where: {
        className: {
          startsWith: suitePrefix,
        },
      },
      select: { id: true },
    });
    const conflictClassIds = conflictClasses.map((item) => item.id);
    const conflictSchedules = conflictClassIds.length
      ? await prisma.classSchedule.findMany({
          where: {
            classId: { in: conflictClassIds },
          },
          select: { id: true },
        })
      : [];
    const conflictScheduleIds = conflictSchedules.map((item) => item.id);
    const existingUsers = await prisma.user.findMany({
      where: {
        email: {
          startsWith: suitePrefix,
        },
      },
      select: { id: true },
    });
    const userIds = existingUsers.map((user) => user.id);

    if (conflictScheduleIds.length > 0) {
      await prisma.classBooking.deleteMany({
        where: { classScheduleId: { in: conflictScheduleIds } },
      });
      await prisma.scheduleException.deleteMany({
        where: { scheduleId: { in: conflictScheduleIds } },
      });
      await prisma.scheduleDay.deleteMany({
        where: { scheduleId: { in: conflictScheduleIds } },
      });
      await prisma.classSchedule.deleteMany({
        where: { id: { in: conflictScheduleIds } },
      });
    }

    if (conflictClassIds.length > 0) {
      await prisma.gymClass.deleteMany({
        where: { id: { in: conflictClassIds } },
      });
    }

    if (userIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.payment.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.trainerBooking.deleteMany({
        where: {
          OR: [
            { memberId: { in: userIds } },
            { trainerId: { in: userIds } },
          ],
        },
      });
      await prisma.classBooking.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.trainerAvailability.deleteMany({
        where: { trainerId: { in: userIds } },
      });
      await prisma.userMembership.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.session.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.userRole.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }

    if (membershipId) {
      await prisma.membership.deleteMany({
        where: { id: membershipId },
      });
    } else {
      await prisma.membership.deleteMany({
        where: { name: { startsWith: suitePrefix } },
      });
    }

    conflictScheduleId = '';
    conflictClassId = '';
    membershipId = '';
  }
});
