import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TrainerBookingStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import { UserEmailService } from '../src/modules/email/email.service';
import { PaymentProducer } from '../src/modules/payment/payment.producer';
import { StripeService } from '../src/modules/payment/stripe.service';
import { TrainerBookingPaymentConsumer } from '../src/modules/trainer-booking/trainer-booking.consumer';
import { TrainerBookingService } from '../src/modules/trainer-booking/trainer-booking.service';
import {
  addDays,
  authRequest,
  getNextDayOfWeek,
  loginAs,
} from './test-helpers';

type TestUser = {
  id: string;
  email: string;
  password: string;
};

describe('Trainer Booking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let trainerBookingService: TrainerBookingService;
  let trainerBookingPaymentConsumer: TrainerBookingPaymentConsumer;

  let memberUser: TestUser;
  let otherMemberUser: TestUser;
  let adminUser: TestUser;
  let freeTrainerUser: TestUser;
  let classConflictTrainerUser: TestUser;

  let memberToken: string;
  let otherMemberToken: string;
  let adminToken: string;
  let freeTrainerToken: string;
  let classConflictTrainerToken: string;

  let membershipId: string;
  let conflictClassId: string;
  let conflictScheduleId: string;

  const suiteKey = `trainer-booking-e2e-${Date.now()}`;
  const userEmails = {
    member: `${suiteKey}-member@test.local`,
    otherMember: `${suiteKey}-other-member@test.local`,
    admin: `${suiteKey}-admin@test.local`,
    freeTrainer: `${suiteKey}-free-trainer@test.local`,
    classTrainer: `${suiteKey}-class-trainer@test.local`,
  };

  let stripeSessionCounter = 0;
  let nextWebhookEvent: any = null;

  const mockUserEmailService = {
    sendEmail: jest.fn().mockResolvedValue(true),
    sendNotificationEmail: jest.fn().mockResolvedValue(true),
  };

  const mockStripeService = {
    createCheckoutSession: jest.fn().mockImplementation(() => {
      stripeSessionCounter += 1;
      return {
        id: `cs_test_trainer_booking_${stripeSessionCounter}`,
        url: `https://checkout.stripe.com/trainer-booking-${stripeSessionCounter}`,
      };
    }),
    verifyWebhookSignature: jest.fn().mockImplementation(() => nextWebhookEvent),
  };

  const mockPaymentProducer = {
    emitPaymentSuccess: jest.fn((payload) =>
      trainerBookingPaymentConsumer.handlePaymentSuccess(
        payload,
        createRmqContextStub() as any,
      ),
    ),
    emitPaymentFailed: jest.fn((payload) =>
      trainerBookingPaymentConsumer.handlePaymentFailed(
        payload,
        createRmqContextStub() as any,
      ),
    ),
    emitPaymentRefunded: jest.fn((payload) =>
      trainerBookingPaymentConsumer.handlePaymentRefunded(
        payload,
        createRmqContextStub() as any,
      ),
    ),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StripeService)
      .useValue(mockStripeService)
      .overrideProvider(PaymentProducer)
      .useValue(mockPaymentProducer)
      .overrideProvider(UserEmailService)
      .useValue(mockUserEmailService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    trainerBookingService = app.get(TrainerBookingService);
    trainerBookingPaymentConsumer = app.get(TrainerBookingPaymentConsumer);

    await cleanupSuiteState();
    await setupBaseFixtures();

    memberToken = await loginAs(app, memberUser.email, memberUser.password);
    otherMemberToken = await loginAs(
      app,
      otherMemberUser.email,
      otherMemberUser.password,
    );
    adminToken = await loginAs(app, adminUser.email, adminUser.password);
    freeTrainerToken = await loginAs(
      app,
      freeTrainerUser.email,
      freeTrainerUser.password,
    );
    classConflictTrainerToken = await loginAs(
      app,
      classConflictTrainerUser.email,
      classConflictTrainerUser.password,
    );
  }, 60000);

  afterEach(async () => {
    await clearPerTestState();
    mockStripeService.createCheckoutSession.mockClear();
    mockStripeService.verifyWebhookSignature.mockClear();
    mockPaymentProducer.emitPaymentSuccess.mockClear();
    mockPaymentProducer.emitPaymentFailed.mockClear();
    mockPaymentProducer.emitPaymentRefunded.mockClear();
    mockUserEmailService.sendEmail.mockClear();
    mockUserEmailService.sendNotificationEmail.mockClear();
    nextWebhookEvent = null;
  });

  afterAll(async () => {
    await cleanupSuiteState();
    if (app) {
      await app.close();
    }
  });

  it('creates a trainer booking successfully and exposes authorized list/detail views', async () => {
    const bookingA = await createBookingRequest(
      memberToken,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );
    const bookingB = await createBookingRequest(
      otherMemberToken,
      freeTrainerUser.id,
      createSlot('WED', 11, 0, 60),
    );

    expect(bookingA.status).toBe(TrainerBookingStatus.PENDING_REVIEW);
    expect(bookingB.status).toBe(TrainerBookingStatus.PENDING_REVIEW);

    const memberList = await authRequest(app, memberToken)
      .get('/trainer-bookings/me')
      .send();

    expect(memberList.status).toBe(200);
    expect(memberList.body.data).toHaveLength(1);
    expect(memberList.body.data[0].id).toBe(bookingA.id);

    const trainerList = await authRequest(app, freeTrainerToken)
      .get('/trainer-bookings/trainer/me')
      .send();

    expect(trainerList.status).toBe(200);
    expect(trainerList.body.data.map((item: { id: string }) => item.id).sort()).toEqual(
      [bookingA.id, bookingB.id].sort(),
    );

    const memberDetail = await authRequest(app, memberToken)
      .get(`/trainer-bookings/${bookingA.id}`)
      .send();
    expect(memberDetail.status).toBe(200);
    expect(memberDetail.body.data.id).toBe(bookingA.id);

    const trainerDetail = await authRequest(app, freeTrainerToken)
      .get(`/trainer-bookings/${bookingA.id}`)
      .send();
    expect(trainerDetail.status).toBe(200);

    const adminDetail = await authRequest(app, adminToken)
      .get(`/trainer-bookings/${bookingA.id}`)
      .send();
    expect(adminDetail.status).toBe(200);

    const unauthorizedDetail = await authRequest(app, otherMemberToken)
      .get(`/trainer-bookings/${bookingA.id}`)
      .send();
    expect(unauthorizedDetail.status).toBe(403);
  });

  it('lists trainers, returns trainer booking profile details, and exposes slot lookup', async () => {
    const slotDay = getNextDayOfWeek('WED');

    const trainersResponse = await authRequest(app, memberToken)
      .get('/trainer-bookings/trainers')
      .query({
        specialization: 'Strength',
        availableOnly: 'true',
        date: slotDay.toISOString(),
      })
      .send();

    expect(trainersResponse.status).toBe(200);
    const listedTrainer = trainersResponse.body.data.find(
      (item: { id: string }) => item.id === freeTrainerUser.id,
    );
    expect(listedTrainer).toEqual(
      expect.objectContaining({
        id: freeTrainerUser.id,
        specialization: 'Strength',
        experience: 5,
        canBook: true,
      }),
    );
    expect(listedTrainer.pricing['60']).toBe(350000);

    const trainerProfileResponse = await authRequest(app, memberToken)
      .get(`/trainer-bookings/trainers/${freeTrainerUser.id}`)
      .send();

    expect(trainerProfileResponse.status).toBe(200);
    expect(trainerProfileResponse.body.data).toEqual(
      expect.objectContaining({
        id: freeTrainerUser.id,
        specialization: 'Strength',
        biography: 'Strength trainer profile',
        certifications: ['NASM'],
        areasOfExpertise: ['Strength'],
      }),
    );

    const slotsResponse = await authRequest(app, memberToken)
      .get(`/trainer-bookings/trainers/${freeTrainerUser.id}/slots`)
      .query({
        from: slotDay.toISOString(),
        to: addDays(slotDay, 1).toISOString(),
      })
      .send();

    expect(slotsResponse.status).toBe(200);
    expect(Array.isArray(slotsResponse.body.data)).toBe(true);
    expect(slotsResponse.body.data.length).toBeGreaterThan(0);
    expect(slotsResponse.body.data[0]).toEqual(
      expect.objectContaining({
        startAt: expect.any(String),
        endAt: expect.any(String),
        durations: expect.arrayContaining([30, 60]),
      }),
    );
  });

  it('filters member slot lookup by the member own cross-domain conflicts', async () => {
    const slotDay = getNextDayOfWeek('TUE');
    await prisma.classBooking.create({
      data: {
        userId: memberUser.id,
        classScheduleId: conflictScheduleId,
        bookingStartDate: slotDay,
        bookingEndDate: addDays(slotDay, 7),
        status: 'confirmed',
      },
    });

    const slotsResponse = await authRequest(app, memberToken)
      .get(`/trainer-bookings/trainers/${freeTrainerUser.id}/slots`)
      .query({
        from: slotDay.toISOString(),
        to: slotDay.toISOString(),
      })
      .send();

    expect(slotsResponse.status).toBe(200);
    expect(slotsResponse.body.data).toHaveLength(1);
    expect(slotsResponse.body.data[0].startAt).toBe(
      `${slotDay.toISOString().slice(0, 10)}T10:00:00.000Z`,
    );
    expect(slotsResponse.body.data[0].endAt).toBe(
      `${slotDay.toISOString().slice(0, 10)}T13:00:00.000Z`,
    );
  });

  it('prevents concurrent overlapping create attempts from producing multiple blocking bookings', async () => {
    const slot = createSlot('THU', 10, 0, 60);

    const [first, second] = await Promise.all([
      authRequest(app, memberToken).post('/trainer-bookings').send({
        trainerId: freeTrainerUser.id,
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
      }),
      authRequest(app, otherMemberToken).post('/trainer-bookings').send({
        trainerId: freeTrainerUser.id,
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
      }),
    ]);

    const statuses = [first.status, second.status].sort();
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

  it('allows trainer acceptance and member payment checkout through the existing payment endpoint', async () => {
    const booking = await createBookingRequest(
      memberToken,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );

    const acceptResponse = await authRequest(app, freeTrainerToken)
      .post(`/trainer-bookings/${booking.id}/accept`)
      .send();

    expect(acceptResponse.status).toBe(201);
    expect(acceptResponse.body.data.status).toBe(
      TrainerBookingStatus.ACCEPTED_PENDING_PAYMENT,
    );

    const checkoutResponse = await startTrainerBookingCheckout(
      memberToken,
      booking.id,
    );

    expect(checkoutResponse.status).toBe(201);
    const checkoutUrl =
      checkoutResponse.body?.data?.checkoutUrl ?? checkoutResponse.body?.checkoutUrl;

    expect(checkoutUrl).toContain(
      'https://checkout.stripe.com/trainer-booking-',
    );
    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'TRAINER_BOOKING',
        targetId: booking.id,
        amount: 350000,
        currency: 'VND',
      }),
    );

    const payment = await getPaymentForBooking(booking.id);
    expect(Number(payment.amount)).toBe(350000);
    expect(payment.currency).toBe('VND');
  });

  it('persists lifecycle notifications for trainer-booking request, reject, confirm, and cancel flows', async () => {
    const rejectedBooking = await createBookingRequest(
      memberToken,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );
    await waitForNotificationTitles(rejectedBooking.id, [
      'Trainer booking requested',
      'New trainer booking request',
    ]);

    const rejectResponse = await authRequest(app, freeTrainerToken)
      .post(`/trainer-bookings/${rejectedBooking.id}/reject`)
      .send({ reason: 'Unavailable' });

    expect(rejectResponse.status).toBe(201);
    await waitForNotificationTitles(rejectedBooking.id, [
      'Trainer booking requested',
      'New trainer booking request',
      'Trainer booking rejected',
    ]);

    const confirmedBooking = await createConfirmedBooking(
      memberToken,
      freeTrainerUser.id,
      createSlot('THU', 10, 0, 60),
    );
    await waitForNotificationTitles(confirmedBooking.id, [
      'Trainer booking requested',
      'New trainer booking request',
      'Trainer booking accepted',
      'Trainer booking confirmed',
    ]);

    const cancelResponse = await authRequest(app, adminToken)
      .post(`/trainer-bookings/${confirmedBooking.id}/cancel`)
      .send({});

    expect(cancelResponse.status).toBe(201);
    await waitForNotificationTitles(confirmedBooking.id, [
      'Trainer booking requested',
      'New trainer booking request',
      'Trainer booking accepted',
      'Trainer booking confirmed',
      'Trainer booking cancelled',
    ]);
  });

  it("rejects payment initiation for another member's trainer booking", async () => {
    const booking = await createAcceptedBooking(
      memberToken,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );

    const response = await startTrainerBookingCheckout(
      otherMemberToken,
      booking.id,
    );

    expect(response.status).toBe(403);
  });

  it('blocks payment after a trainer rejects the booking', async () => {
    const booking = await createBookingRequest(
      memberToken,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );

    const rejectResponse = await authRequest(app, freeTrainerToken)
      .post(`/trainer-bookings/${booking.id}/reject`)
      .send({ reason: 'Unavailable' });

    expect(rejectResponse.status).toBe(201);
    expect(rejectResponse.body.data.status).toBe(TrainerBookingStatus.REJECTED);

    const checkoutResponse = await startTrainerBookingCheckout(
      memberToken,
      booking.id,
    );
    expect(checkoutResponse.status).toBe(400);
  });

  it('confirms the booking after payment success', async () => {
    const booking = await createAcceptedBooking(
      memberToken,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );

    await startTrainerBookingCheckout(memberToken, booking.id);
    const payment = await getPaymentForBooking(booking.id);

    await triggerStripeWebhook({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: payment.providerSessionId,
          payment_intent: 'pi_trainer_booking_success',
        },
      },
    });

    await waitForBookingStatus(booking.id, TrainerBookingStatus.CONFIRMED);

    const refreshedBooking = await prisma.trainerBooking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(refreshedBooking.status).toBe(TrainerBookingStatus.CONFIRMED);
    expect(mockPaymentProducer.emitPaymentSuccess).toHaveBeenCalledTimes(1);
  });

  it('allows the trainer to complete a confirmed booking', async () => {
    const booking = await createConfirmedBooking(
      memberToken,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );

    const completeResponse = await authRequest(app, freeTrainerToken)
      .post(`/trainer-bookings/${booking.id}/complete`)
      .send();

    expect(completeResponse.status).toBe(201);
    expect(completeResponse.body.data.status).toBe(
      TrainerBookingStatus.COMPLETED,
    );
  });

  it('marks payment failure as terminal and releases the slot for a new request', async () => {
    const slot = createSlot('WED', 10, 0, 60);
    const booking = await createAcceptedBooking(
      memberToken,
      freeTrainerUser.id,
      slot,
    );

    await startTrainerBookingCheckout(memberToken, booking.id);
    const payment = await getPaymentForBooking(booking.id);

    await triggerStripeWebhook({
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_trainer_booking_failed',
          metadata: {
            paymentId: payment.id,
          },
        },
      },
    });

    await waitForBookingStatus(booking.id, TrainerBookingStatus.PAYMENT_FAILED);
    await waitForNotificationTitles(booking.id, [
      'Trainer booking requested',
      'New trainer booking request',
      'Trainer booking accepted',
      'Payment failed',
    ]);

    const retriedBooking = await createBookingRequest(
      memberToken,
      freeTrainerUser.id,
      slot,
    );
    expect(retriedBooking.status).toBe(TrainerBookingStatus.PENDING_REVIEW);
  });

  it('releases a stale pending-review slot through lazy expiry', async () => {
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
      memberToken,
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

  it('sends upcoming session reminders only for eligible confirmed sessions and dedupes repeats', async () => {
    const now = new Date();
    const eligibleBooking = await prisma.trainerBooking.create({
      data: {
        memberId: memberUser.id,
        trainerId: freeTrainerUser.id,
        startAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() + 3 * 60 * 60 * 1000),
        status: TrainerBookingStatus.CONFIRMED,
        price: 350000,
        currency: 'VND',
      },
    });
    await prisma.trainerBooking.create({
      data: {
        memberId: memberUser.id,
        trainerId: freeTrainerUser.id,
        startAt: new Date(now.getTime() + 30 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() + 31 * 60 * 60 * 1000),
        status: TrainerBookingStatus.CONFIRMED,
        price: 350000,
        currency: 'VND',
      },
    });
    await prisma.trainerBooking.create({
      data: {
        memberId: memberUser.id,
        trainerId: freeTrainerUser.id,
        startAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() + 3 * 60 * 60 * 1000),
        status: TrainerBookingStatus.CANCELLED,
        price: 350000,
        currency: 'VND',
      },
    });

    const firstRunCount = await trainerBookingService.sendUpcomingReminders(now);
    expect(firstRunCount).toBe(2);
    await waitForNotificationTitles(eligibleBooking.id, [
      'Upcoming trainer session reminder',
    ]);

    const secondRunCount = await trainerBookingService.sendUpcomingReminders(now);
    expect(secondRunCount).toBe(0);

    const reminderNotifications = await prisma.notification.findMany({
      where: {
        referenceId: eligibleBooking.id,
        title: 'Upcoming trainer session reminder',
      },
    });
    expect(reminderNotifications).toHaveLength(2);
  });

  it('lets a member cancel their own eligible booking but not another member booking', async () => {
    const ownBooking = await createBookingRequest(
      memberToken,
      freeTrainerUser.id,
      createSlot('WED', 10, 0, 60),
    );

    const ownCancelResponse = await authRequest(app, memberToken)
      .post(`/trainer-bookings/${ownBooking.id}/cancel`)
      .send({});

    expect(ownCancelResponse.status).toBe(201);
    expect(ownCancelResponse.body.data.status).toBe(
      TrainerBookingStatus.CANCELLED,
    );

    const otherBooking = await createBookingRequest(
      otherMemberToken,
      freeTrainerUser.id,
      createSlot('WED', 11, 0, 60),
    );

    const unauthorizedCancel = await authRequest(app, memberToken)
      .post(`/trainer-bookings/${otherBooking.id}/cancel`)
      .send({});

    expect(unauthorizedCancel.status).toBe(403);
  });

  it('allows member cancellation of a confirmed booking only before the 24-hour cutoff', async () => {
    const cancellableBooking = await createConfirmedBooking(
      memberToken,
      freeTrainerUser.id,
      createSlot('THU', 10, 0, 60),
    );

    const allowedResponse = await authRequest(app, memberToken)
      .post(`/trainer-bookings/${cancellableBooking.id}/cancel`)
      .send({});

    expect(allowedResponse.status).toBe(201);
    expect(allowedResponse.body.data.status).toBe(
      TrainerBookingStatus.CANCELLED,
    );

    const urgentStartAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const urgentEndAt = new Date(urgentStartAt.getTime() + 60 * 60 * 1000);
    const urgentBooking = await prisma.trainerBooking.create({
      data: {
        memberId: memberUser.id,
        trainerId: freeTrainerUser.id,
        startAt: urgentStartAt,
        endAt: urgentEndAt,
        status: TrainerBookingStatus.CONFIRMED,
        price: 350000,
        currency: 'VND',
      },
    });

    const blockedResponse = await authRequest(app, memberToken)
      .post(`/trainer-bookings/${urgentBooking.id}/cancel`)
      .send({});

    expect(blockedResponse.status).toBe(400);
    expect(getErrorMessage(blockedResponse.body)).toContain(
      'Confirmed bookings can only be cancelled at least 24 hours before the session',
    );
  });

  it('matches trainer and admin cancellation policy for active bookings', async () => {
    const trainerCancelledBooking = await createAcceptedBooking(
      memberToken,
      freeTrainerUser.id,
      createSlot('THU', 10, 0, 60),
    );

    const trainerCancelResponse = await authRequest(app, freeTrainerToken)
      .post(`/trainer-bookings/${trainerCancelledBooking.id}/cancel`)
      .send({});

    expect(trainerCancelResponse.status).toBe(201);
    expect(trainerCancelResponse.body.data.status).toBe(
      TrainerBookingStatus.CANCELLED,
    );

    const adminCancelledBooking = await createAcceptedBooking(
      memberToken,
      freeTrainerUser.id,
      createSlot('THU', 11, 0, 60),
    );

    const adminCancelResponse = await authRequest(app, adminToken)
      .post(`/trainer-bookings/${adminCancelledBooking.id}/cancel`)
      .send({});

    expect(adminCancelResponse.status).toBe(201);
    expect(adminCancelResponse.body.data.status).toBe(
      TrainerBookingStatus.CANCELLED,
    );
  });

  it('requires a reason when a trainer cancels a confirmed booking', async () => {
    const booking = await createConfirmedBooking(
      memberToken,
      freeTrainerUser.id,
      createSlot('THU', 10, 0, 60),
    );

    const missingReasonResponse = await authRequest(app, freeTrainerToken)
      .post(`/trainer-bookings/${booking.id}/cancel`)
      .send({});

    expect(missingReasonResponse.status).toBe(400);
    expect(getErrorMessage(missingReasonResponse.body)).toContain(
      'A cancellation reason is required when a trainer cancels a confirmed booking',
    );

    const withReasonResponse = await authRequest(app, freeTrainerToken)
      .post(`/trainer-bookings/${booking.id}/cancel`)
      .send({ reason: 'Emergency schedule change' });

    expect(withReasonResponse.status).toBe(201);
    expect(withReasonResponse.body.data.status).toBe(
      TrainerBookingStatus.CANCELLED,
    );
    expect(withReasonResponse.body.data.cancelReason).toBe(
      'Emergency schedule change',
    );
  });

  it('rejects booking creation when the trainer has an active class schedule at that time', async () => {
    const slot = createSlot('TUE', 9, 0, 60);

    const response = await authRequest(app, memberToken)
      .post('/trainer-bookings')
      .send({
        trainerId: classConflictTrainerUser.id,
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
      });

    expect(response.status).toBe(400);
    expect(getErrorMessage(response.body)).toContain(
      'The trainer already has an active class scheduled during this time',
    );
  });

  it('rejects booking creation when the member already has a non-cancelled class booking at that time', async () => {
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

    const response = await authRequest(app, memberToken)
      .post('/trainer-bookings')
      .send({
        trainerId: freeTrainerUser.id,
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
      });

    expect(response.status).toBe(400);
    expect(getErrorMessage(response.body)).toContain(
      'The member already has a class booking during this time',
    );
  });

  it('rechecks trainer-side cross-domain conflicts at accept time', async () => {
    const slot = createSlot('WED', 10, 0, 60);
    const booking = await createBookingRequest(memberToken, freeTrainerUser.id, slot);
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
      const acceptResponse = await authRequest(app, freeTrainerToken)
        .post(`/trainer-bookings/${booking.id}/accept`)
        .send();

      expect(acceptResponse.status).toBe(400);
      expect(getErrorMessage(acceptResponse.body)).toContain(
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

  it('rechecks member-side class conflicts at accept time', async () => {
    const slot = createSlot('TUE', 9, 0, 60);
    const booking = await createBookingRequest(memberToken, freeTrainerUser.id, slot);

    await prisma.classBooking.create({
      data: {
        userId: memberUser.id,
        classScheduleId: conflictScheduleId,
        bookingStartDate: getNextDayOfWeek('TUE'),
        bookingEndDate: addDays(getNextDayOfWeek('TUE'), 7),
        status: 'confirmed',
      },
    });

    const acceptResponse = await authRequest(app, freeTrainerToken)
      .post(`/trainer-bookings/${booking.id}/accept`)
      .send();

    expect(acceptResponse.status).toBe(400);
    expect(getErrorMessage(acceptResponse.body)).toContain(
      'The member already has a class booking during this time',
    );
  });

  async function setupBaseFixtures(): Promise<void> {
    const password = 'Test@12345';
    const hashedPassword = await bcrypt.hash(password, 10);

    const memberRole = await ensureRole('MEMBER');
    const adminRole = await ensureRole('ADMIN');
    const trainerRole = await ensureRole('TRAINER');

    memberUser = await createUser(
      userEmails.member,
      'Member',
      memberRole.id,
      hashedPassword,
      password,
    );
    otherMemberUser = await createUser(
      userEmails.otherMember,
      'Other Member',
      memberRole.id,
      hashedPassword,
      password,
    );
    adminUser = await createUser(
      userEmails.admin,
      'Admin',
      adminRole.id,
      hashedPassword,
      password,
    );
    freeTrainerUser = await createUser(
      userEmails.freeTrainer,
      'Free Trainer',
      trainerRole.id,
      hashedPassword,
      password,
    );
    classConflictTrainerUser = await createUser(
      userEmails.classTrainer,
      'Class Trainer',
      trainerRole.id,
      hashedPassword,
      password,
    );

    membershipId = await ensureMembershipTier();
    await grantActiveMembership(memberUser.id);
    await grantActiveMembership(otherMemberUser.id);

    await configureTrainerProfile(freeTrainerUser.id, 'Strength');
    await configureTrainerProfile(classConflictTrainerUser.id, 'Mobility');

    await seedTrainerAvailability(freeTrainerUser.id, 2, 9, 0, 13, 0);
    await seedTrainerAvailability(freeTrainerUser.id, 3, 9, 0, 13, 0);
    await seedTrainerAvailability(freeTrainerUser.id, 4, 9, 0, 13, 0);

    await seedTrainerAvailability(classConflictTrainerUser.id, 2, 9, 0, 12, 0);

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
    password: string,
  ): Promise<TestUser> {
    const user = await prisma.user.create({
      data: {
        firstName: `TB ${label}`,
        lastName: 'E2E',
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
      password,
    };
  }

  async function ensureRole(name: string) {
    return prisma.role.upsert({
      where: { name },
      update: {},
      create: {
        name,
        description: `${name} role`,
      },
    });
  }

  async function ensureMembershipTier(): Promise<string> {
    const membership = await prisma.membership.create({
      data: {
        name: `${suiteKey}-membership`,
        description: 'Trainer booking E2E membership',
        minPrice: 100000,
        purchasePrice: 100000,
        level: 'BASIC',
      },
    });

    return membership.id;
  }

  async function grantActiveMembership(userId: string): Promise<void> {
    const now = new Date();
    await prisma.userMembership.create({
      data: {
        userId,
        membershipId,
        membershipName: `${suiteKey}-membership`,
        membershipDescription: 'Trainer booking E2E membership',
        status: 'normal',
        level: 'BASIC',
        startDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  async function configureTrainerProfile(
    userId: string,
    specialization: string,
  ): Promise<void> {
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
  ): Promise<void> {
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

  function createSlot(
    dayOfWeek: 'TUE' | 'WED' | 'THU',
    hour: number,
    minute: number,
    durationMinutes: number,
  ) {
    const day = getNextDayOfWeek(dayOfWeek);
    const startAt = setUtcTime(day, hour, minute);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
    return { startAt, endAt };
  }

  function setUtcTime(date: Date, hour: number, minute: number) {
    const value = new Date(date);
    value.setUTCHours(hour, minute, 0, 0);
    return value;
  }

  function buildClockTime(hour: number, minute: number) {
    return new Date(
      Date.UTC(1970, 0, 1, hour, minute, 0, 0),
    );
  }

  async function createBookingRequest(
    token: string,
    trainerId: string,
    slot: { startAt: Date; endAt: Date },
  ) {
    const response = await authRequest(app, token).post('/trainer-bookings').send({
      trainerId,
      startAt: slot.startAt.toISOString(),
      endAt: slot.endAt.toISOString(),
      notes: 'Trainer booking E2E request',
    });

    expect(response.status).toBe(201);
    return response.body.data;
  }

  async function createAcceptedBooking(
    token: string,
    trainerId: string,
    slot: { startAt: Date; endAt: Date },
  ) {
    const booking = await createBookingRequest(token, trainerId, slot);
    const trainerToken = getTrainerToken(trainerId);

    const response = await authRequest(app, trainerToken)
      .post(`/trainer-bookings/${booking.id}/accept`)
      .send();

    expect(response.status).toBe(201);
    return response.body.data;
  }

  async function createConfirmedBooking(
    token: string,
    trainerId: string,
    slot: { startAt: Date; endAt: Date },
  ) {
    const booking = await createAcceptedBooking(token, trainerId, slot);
    await startTrainerBookingCheckout(token, booking.id);
    const payment = await getPaymentForBooking(booking.id);

    await triggerStripeWebhook({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: payment.providerSessionId,
          payment_intent: `pi_${booking.id}`,
        },
      },
    });

    await waitForBookingStatus(booking.id, TrainerBookingStatus.CONFIRMED);

    return prisma.trainerBooking.findUniqueOrThrow({
      where: { id: booking.id },
    });
  }

  async function startTrainerBookingCheckout(token: string, bookingId: string) {
    return authRequest(app, token).post('/payments/checkout').send({
      targetType: 'TRAINER_BOOKING',
      targetId: bookingId,
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

  async function triggerStripeWebhook(event: any) {
    nextWebhookEvent = event;

    const response = await supertest
      .default(app.getHttpServer())
      .post('/payments/webhook/stripe')
      .set('stripe-signature', 'sig_test_trainer_booking')
      .send(Buffer.from(JSON.stringify({ ok: true })));

    expect(response.status).toBe(200);
  }

  async function waitForBookingStatus(
    bookingId: string,
    status: TrainerBookingStatus,
  ) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const booking = await prisma.trainerBooking.findUnique({
        where: { id: bookingId },
      });

      if (booking?.status === status) {
        return booking;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(
      `Trainer booking ${bookingId} did not reach ${status} in time`,
    );
  }

  async function waitForNotificationTitles(
    referenceId: string,
    expectedTitles: string[],
  ) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const titles = await getNotificationTitles(referenceId);
      const hasAllTitles = expectedTitles.every((title) => titles.includes(title));

      if (hasAllTitles) {
        return titles;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const finalTitles = await getNotificationTitles(referenceId);
    throw new Error(
      `Notifications for ${referenceId} did not reach expected titles. Actual: ${finalTitles.join(', ')}`,
    );
  }

  async function getNotificationTitles(referenceId: string) {
    const titles = await prisma.notification.findMany({
      where: {
        referenceId,
      },
      select: {
        title: true,
      },
    });

    return titles.map((item) => item.title);
  }

  async function clearPerTestState(): Promise<void> {
    const userIds = [
      memberUser?.id,
      otherMemberUser?.id,
      adminUser?.id,
      freeTrainerUser?.id,
      classConflictTrainerUser?.id,
    ].filter((value): value is string => Boolean(value));

    if (userIds.length === 0) {
      return;
    }

    await prisma.notification.deleteMany({
      where: {
        userId: { in: userIds },
      },
    });

    await prisma.payment.deleteMany({
      where: {
        userId: { in: userIds },
      },
    });

    await prisma.trainerBooking.deleteMany({
      where: {
        OR: [
          { memberId: { in: userIds } },
          { trainerId: { in: userIds } },
        ],
      },
    });

    if (conflictScheduleId) {
      await prisma.classBooking.deleteMany({
        where: {
          OR: [
            { userId: { in: userIds } },
            { classScheduleId: conflictScheduleId },
          ],
        },
      });
    }
  }

  async function cleanupSuiteState(): Promise<void> {
    await clearPerTestState();

    const userIds = await prisma.user.findMany({
      where: {
        email: {
          in: Object.values(userEmails),
        },
      },
      select: { id: true },
    });
    const resolvedUserIds = userIds.map((user) => user.id);

    if (conflictScheduleId) {
      await prisma.scheduleException.deleteMany({
        where: { scheduleId: conflictScheduleId },
      });
      await prisma.scheduleDay.deleteMany({
        where: { scheduleId: conflictScheduleId },
      });
    }

    if (conflictScheduleId) {
      await prisma.classSchedule.deleteMany({
        where: { id: conflictScheduleId },
      });
    }

    if (conflictClassId) {
      await prisma.gymClass.deleteMany({
        where: { id: conflictClassId },
      });
    }

    if (resolvedUserIds.length > 0) {
      await prisma.trainerAvailability.deleteMany({
        where: {
          trainerId: { in: resolvedUserIds },
        },
      });

      await prisma.userMembership.deleteMany({
        where: { userId: { in: resolvedUserIds } },
      });

      await prisma.session.deleteMany({
        where: { userId: { in: resolvedUserIds } },
      });

      await prisma.payment.deleteMany({
        where: { userId: { in: resolvedUserIds } },
      });

      await prisma.userRole.deleteMany({
        where: { userId: { in: resolvedUserIds } },
      });

      await prisma.user.deleteMany({
        where: { id: { in: resolvedUserIds } },
      });
    }

    if (membershipId) {
      await prisma.membership.deleteMany({
        where: { id: membershipId },
      });
    } else {
      await prisma.membership.deleteMany({
        where: { name: `${suiteKey}-membership` },
      });
    }

    conflictScheduleId = '';
    conflictClassId = '';
    membershipId = '';
  }

  function getErrorMessage(body: any): string {
    const message = body?.error?.message ?? body?.message;
    if (Array.isArray(message)) {
      return message.join(' ');
    }
    return String(message ?? '');
  }

  function getTrainerToken(trainerId: string): string {
    if (trainerId === freeTrainerUser.id) {
      return freeTrainerToken;
    }
    if (trainerId === classConflictTrainerUser.id) {
      return classConflictTrainerToken;
    }

    throw new Error(`No trainer token configured for trainer ${trainerId}`);
  }

  function createRmqContextStub() {
    const channel = {
      ack: jest.fn(),
      nack: jest.fn(),
    };

    return {
      getChannelRef: () => channel,
      getMessage: () => ({ content: Buffer.from('trainer-booking-test') }),
    };
  }
});
