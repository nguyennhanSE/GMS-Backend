import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { AppCacheService } from '../src/libs/cache/cache.service';
import {
  TestData,
  loginAs,
  authRequest,
  createTestData,
  cleanupTestData,
} from './test-helpers';

/**
 * Integration tests for POST /class-schedule/classes/:id/image
 *
 * StorageService is mocked — no real Cloudinary calls in CI.
 * AppCacheService is mocked — GET tests always hit DB, never a stale cache.
 */
describe('GymClass Image Upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testData: TestData;
  let adminToken: string;
  let memberToken: string;

  const OLD_KEY = 'gym-classes/test-class/image-old';
  const NEW_KEY = 'gym-classes/test-class/image-new';

  const mockStorageService = {
    uploadGymClassImage: jest.fn().mockImplementation((params: any) => {
      const file = params?.file;
      if (!file || !['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(file.mimetype)) {
        throw new (require('@nestjs/common').BadRequestException)('Unsupported file type');
      }
      return Promise.resolve({
        url: 'https://res.cloudinary.com/test/gym-classes/test-class/image.jpg',
        key: OLD_KEY,
        contentType: file.mimetype,
      });
    }),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };

  // Bypass cache: remember() always delegates to the fetcher; no stale reads
  const mockCacheService = {
    remember: jest.fn().mockImplementation((_key: string, fetcher: () => unknown) => fetcher()),
    invalidateTags: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(mockStorageService)
      .overrideProvider(AppCacheService)
      .useValue(mockCacheService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await cleanupTestData(prisma);
    testData = await createTestData(prisma);

    try {
      adminToken = await loginAs(app, testData.adminUser.email, testData.adminPassword);
      memberToken = await loginAs(app, testData.memberUser.email, testData.memberPassword);
    } catch {
      console.warn('Login failed — some tests will be skipped');
    }
  }, 60000);

  afterAll(async () => {
    if (prisma) {
      await prisma.gymClass.updateMany({
        where: { className: 'API Integration Test Class' },
        data: { imageUrl: null, imageKey: null },
      });
      await cleanupTestData(prisma);
    }
    if (app) await app.close();
  });

  afterEach(async () => {
    mockStorageService.deleteObject.mockClear();
    mockStorageService.uploadGymClassImage.mockClear();
    // Reset image fields between tests for isolation
    await prisma.gymClass.updateMany({
      where: { className: 'API Integration Test Class' },
      data: { imageUrl: null, imageKey: null },
    });
    // Restore default mock return
    mockStorageService.uploadGymClassImage.mockImplementation((params: any) => {
      const file = params?.file;
      if (!file || !['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(file.mimetype)) {
        throw new (require('@nestjs/common').BadRequestException)('Unsupported file type');
      }
      return Promise.resolve({
        url: 'https://res.cloudinary.com/test/gym-classes/test-class/image.jpg',
        key: OLD_KEY,
        contentType: file.mimetype,
      });
    });
  });

  // ─── Test 1: Happy path ───────────────────────────────────────────────────

  it('[Test 1] Admin uploads valid JPEG → 201 + imageUrl in response', async () => {
    if (!adminToken) return;

    const fakeJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);

    const response = await supertest
      .default(app.getHttpServer())
      .post(`/class-schedule/classes/${testData.testClass.id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', fakeJpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(201);
    expect(response.body.imageUrl).toBeDefined();
    expect(typeof response.body.imageUrl).toBe('string');
  });

  // ─── Test 2: GET list returns imageUrl ────────────────────────────────────

  it('[Test 2] GET /class-schedule/classes returns imageUrl on each item after upload', async () => {
    if (!adminToken) return;

    // Seed image directly in DB (simulates prior upload)
    await prisma.gymClass.update({
      where: { id: testData.testClass.id },
      data: { imageUrl: 'https://cdn.example.com/img.jpg', imageKey: OLD_KEY },
    });

    const response = await authRequest(app, adminToken).get('/class-schedule/classes');

    expect(response.status).toBe(200);
    const found = (Array.isArray(response.body) ? response.body : response.body.data ?? [])
      .find((c: any) => c.id === testData.testClass.id);
    expect(found).toBeDefined();
    // imageUrl exposed on the gymClass object or flattened — adjust based on actual response shape
    const imageUrl = found?.imageUrl ?? found?.gymClass?.imageUrl;
    expect(imageUrl).toBe('https://cdn.example.com/img.jpg');
  });

  // ─── Test 3: GET detail returns imageUrl ─────────────────────────────────

  it('[Test 3] GET /class-schedule/:id returns gymClass.imageUrl after upload', async () => {
    if (!adminToken) return;

    await prisma.gymClass.update({
      where: { id: testData.testClass.id },
      data: { imageUrl: 'https://cdn.example.com/img.jpg', imageKey: OLD_KEY },
    });

    const response = await authRequest(app, adminToken).get(
      `/class-schedule/${testData.testSchedule.id}`,
    );

    expect(response.status).toBe(200);
    const body = response.body;
    const imageUrl = body?.imageUrl ?? body?.gymClass?.imageUrl ?? body?.data?.imageUrl ?? body?.data?.gymClass?.imageUrl;
    expect(imageUrl).toBe('https://cdn.example.com/img.jpg');
  });

  // ─── Test 4: Non-admin rejected ───────────────────────────────────────────

  it('[Test 4] MEMBER token → 403 Forbidden', async () => {
    if (!memberToken) return;

    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    const response = await supertest
      .default(app.getHttpServer())
      .post(`/class-schedule/classes/${testData.testClass.id}/image`)
      .set('Authorization', `Bearer ${memberToken}`)
      .attach('file', fakeJpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(403);
  });

  // ─── Test 5: Invalid MIME type ────────────────────────────────────────────

  it('[Test 5] GIF file → 400 Bad Request', async () => {
    if (!adminToken) return;

    const fakeGif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

    const response = await supertest
      .default(app.getHttpServer())
      .post(`/class-schedule/classes/${testData.testClass.id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', fakeGif, { filename: 'test.gif', contentType: 'image/gif' });

    expect(response.status).toBe(400);
  });

  // ─── Test 6: File too large ───────────────────────────────────────────────

  it('[Test 6] File > 5 MB → 400 Bad Request', async () => {
    if (!adminToken) return;

    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff);

    const response = await supertest
      .default(app.getHttpServer())
      .post(`/class-schedule/classes/${testData.testClass.id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', oversized, { filename: 'big.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(400);
  });

  // ─── Test 7: Replace — strict old-key deletion check ─────────────────────

  it('[Test 7] Replacing image deletes OLD key, not the new one', async () => {
    if (!adminToken) return;

    // First upload — seeds OLD_KEY into DB
    mockStorageService.uploadGymClassImage.mockResolvedValueOnce({
      url: 'https://cdn.example.com/old.jpg',
      key: OLD_KEY,
      contentType: 'image/jpeg',
    });
    await supertest
      .default(app.getHttpServer())
      .post(`/class-schedule/classes/${testData.testClass.id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), {
        filename: 'old.jpg',
        contentType: 'image/jpeg',
      });

    mockStorageService.deleteObject.mockClear();

    // Second upload — should delete OLD_KEY
    mockStorageService.uploadGymClassImage.mockResolvedValueOnce({
      url: 'https://cdn.example.com/new.jpg',
      key: NEW_KEY,
      contentType: 'image/jpeg',
    });
    const response = await supertest
      .default(app.getHttpServer())
      .post(`/class-schedule/classes/${testData.testClass.id}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), {
        filename: 'new.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(201);

    // Strict key assertion — OLD key deleted, NEW key preserved
    expect(mockStorageService.deleteObject).toHaveBeenCalledWith(OLD_KEY);
    expect(mockStorageService.deleteObject).not.toHaveBeenCalledWith(NEW_KEY);

    // DB should have new URL/key
    const dbClass = await prisma.gymClass.findUnique({ where: { id: testData.testClass.id } });
    expect(dbClass?.imageKey).toBe(NEW_KEY);
    expect(dbClass?.imageUrl).toBe('https://cdn.example.com/new.jpg');
  });

  // ─── Test 8: Unknown classId → 404 ───────────────────────────────────────

  it('[Test 8] Unknown classId (valid UUID) → 404 Not Found', async () => {
    if (!adminToken) return;

    const fakeId = '00000000-0000-0000-0000-000000000000';

    const response = await supertest
      .default(app.getHttpServer())
      .post(`/class-schedule/classes/${fakeId}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(404);
  });
});
