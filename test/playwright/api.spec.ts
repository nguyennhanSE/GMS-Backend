import {
  test,
  expect,
  type APIRequestContext,
} from '@playwright/test';
import {
  assignMembershipToUser,
  clearMembershipsForUser,
  cleanupApiTestData,
  cleanupGeneratedApiTestData,
  createApiRole,
  createApiContext,
  createMembershipPayload,
  createEmailVerificationToken,
  createRegisterPayload,
  createUserPayload,
  createStripeWebhookEvent,
  decodeJwtPayload,
  disconnectDatabase,
  findMembershipRecordByPaymentId,
  findMembershipPaymentForUser,
  findUserByEmail,
  getLatestSessionForUser,
  getUserRoleNames,
  hashRefreshToken,
  loginAs,
  seedApiUsers,
  startTemporaryApiServer,
  updateUserStatus,
  countSessionsForUser,
  listMembershipRecordsForUser,
  type SeededUsers,
} from './api-helpers';
import { isDeployedTarget } from './target-mode';

test.describe('Playwright API E2E', () => {
  let seededUsers: SeededUsers;
  let anonymousApi: APIRequestContext;
  let adminApi: APIRequestContext;
  let memberApi: APIRequestContext;

  test.beforeAll(async () => {
    seededUsers = await seedApiUsers();
    anonymousApi = await createApiContext();

    const adminLogin = await loginAs(
      anonymousApi,
      seededUsers.admin.email,
      seededUsers.admin.password,
    );

    adminApi = await createApiContext(adminLogin.accessToken);

    const memberLogin = await loginAs(
      anonymousApi,
      seededUsers.member.email,
      seededUsers.member.password,
    );

    memberApi = await createApiContext(memberLogin.accessToken);
  });

  test.afterEach(async () => {
    await Promise.all([
      clearMembershipsForUser(seededUsers.member.id),
      updateUserStatus(seededUsers.member.id, 'active'),
      updateUserStatus(seededUsers.admin.id, 'active'),
      cleanupGeneratedApiTestData(),
    ]);
  });

  test.afterAll(async () => {
    await Promise.all([
      anonymousApi?.dispose(),
      adminApi?.dispose(),
      memberApi?.dispose(),
    ]);
    await cleanupApiTestData();
    await disconnectDatabase();
  });

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

  test('returns a public health response', async () => {
    const response = await anonymousApi.get('health');

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      status: string;
      service: string;
      statusCode: number;
    };

    expect(body.status).toBe('ok');
    expect(body.service).toBe('gms-backend');
    expect(body.statusCode).toBe(200);
  });

  test('logs in an active user', async () => {
    const response = await anonymousApi.post('auth/login', {
      data: {
        username: seededUsers.member.email,
        password: seededUsers.member.password,
      },
    });

    expect(response.status()).toBe(201);

    const body = (await response.json()) as {
      data: {
        accessToken: string;
        refreshToken: string;
        user: { email: string };
      };
    };

    expect(body.data.user.email).toBe(seededUsers.member.email);
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toBeTruthy();
  });

  test('rejects login with invalid credentials', async () => {
    const response = await anonymousApi.post('auth/login', {
      data: {
        username: seededUsers.member.email,
        password: 'WrongPassword@123',
      },
    });

    expect(response.status()).toBe(401);
  });

  test('rejects login for an inactive user', async () => {
    const sessionCountBefore = await countSessionsForUser(seededUsers.member.id);
    await updateUserStatus(seededUsers.member.id, 'inactive');

    const response = await anonymousApi.post('auth/login', {
      data: {
        username: seededUsers.member.email,
        password: seededUsers.member.password,
      },
    });

    expect(response.status()).toBe(401);

    const body = (await response.json()) as {
      data?: {
        accessToken?: string;
        refreshToken?: string;
      };
    };

    expect(body.data?.accessToken).toBeFalsy();
    expect(body.data?.refreshToken).toBeFalsy();
    expect(await countSessionsForUser(seededUsers.member.id)).toBe(
      sessionCountBefore,
    );
  });

  test('wipes member sessions immediately when an admin deactivates the user via HTTP', async () => {
    await loginAs(
      anonymousApi,
      seededUsers.member.email,
      seededUsers.member.password,
    );

    expect(await countSessionsForUser(seededUsers.member.id)).toBeGreaterThan(0);

    const response = await adminApi.patch(`user/${seededUsers.member.id}`, {
      data: {
        status: 'inactive',
      },
    });

    expect(response.status()).toBe(200);

    await expect
      .poll(() => countSessionsForUser(seededUsers.member.id), {
        timeout: 10000,
      })
      .toBe(0);
  });

  test('stores refresh tokens hashed instead of plaintext', async () => {
    const login = await loginAs(
      anonymousApi,
      seededUsers.member.email,
      seededUsers.member.password,
    );

    const session = await getLatestSessionForUser(seededUsers.member.id);

    expect(session).not.toBeNull();
    expect(session?.refreshToken).not.toBe(login.refreshToken);
    expect(session?.refreshToken).toBe(hashRefreshToken(login.refreshToken));
  });

  test('refreshes a valid refresh token', async () => {
    const login = await loginAs(
      anonymousApi,
      seededUsers.member.email,
      seededUsers.member.password,
    );

    const response = await anonymousApi.post('auth/refresh-token', {
      data: {
        refreshToken: login.refreshToken,
      },
    });

    expect(response.status()).toBe(201);

    const body = (await response.json()) as {
      data: {
        accessToken: string;
        newRefreshToken: string;
      };
    };

    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.newRefreshToken).toBeTruthy();
  });

  test('rejects replayed refresh tokens and wipes active sessions', async () => {
    const login = await loginAs(
      anonymousApi,
      seededUsers.member.email,
      seededUsers.member.password,
    );

    const firstRefresh = await anonymousApi.post('auth/refresh-token', {
      data: {
        refreshToken: login.refreshToken,
      },
    });

    expect(firstRefresh.status()).toBe(201);

    const replayResponse = await anonymousApi.post('auth/refresh-token', {
      data: {
        refreshToken: login.refreshToken,
      },
    });

    expect(replayResponse.status()).toBe(401);
    expect(await countSessionsForUser(seededUsers.member.id)).toBe(0);

    const firstRefreshBody = (await firstRefresh.json()) as {
      data: { newRefreshToken: string };
    };
    const wipedSessionRefresh = await anonymousApi.post('auth/refresh-token', {
      data: {
        refreshToken: firstRefreshBody.data.newRefreshToken,
      },
    });

    expect(wipedSessionRefresh.status()).toBeGreaterThanOrEqual(401);
  });

  test('rejects an invalid refresh token', async () => {
    const response = await anonymousApi.post('auth/refresh-token', {
      data: {
        refreshToken: 'invalid.refresh.token',
      },
    });

    const body = (await response.json()) as {
      data?: {
        accessToken?: string;
        newRefreshToken?: string;
      };
      statusCode?: number;
    };

    expect(response.status()).toBe(401);
    expect(body.data?.accessToken).toBeFalsy();
    expect(body.data?.newRefreshToken).toBeFalsy();
  });

  test('rejects refresh for an inactive user and revokes sessions', async () => {
    const login = await loginAs(
      anonymousApi,
      seededUsers.member.email,
      seededUsers.member.password,
    );

    await updateUserStatus(seededUsers.member.id, 'inactive');

    const response = await anonymousApi.post('auth/refresh-token', {
      data: {
        refreshToken: login.refreshToken,
      },
    });

    expect(response.status()).toBe(401);
    expect(await countSessionsForUser(seededUsers.member.id)).toBe(0);
  });

  test('issues a longer refresh-token lifetime when rememberMe is enabled', async () => {
    const normalLogin = await anonymousApi.post('auth/login', {
      data: {
        username: seededUsers.member.email,
        password: seededUsers.member.password,
        rememberMe: false,
      },
    });
    expect(normalLogin.status()).toBe(201);

    const normalBody = (await normalLogin.json()) as {
      data: { refreshToken: string };
    };

    const rememberLogin = await anonymousApi.post('auth/login', {
      data: {
        username: seededUsers.member.email,
        password: seededUsers.member.password,
        rememberMe: true,
      },
    });
    expect(rememberLogin.status()).toBe(201);

    const rememberBody = (await rememberLogin.json()) as {
      data: { refreshToken: string };
    };

    const normalPayload = decodeJwtPayload<{ iat: number; exp: number }>(
      normalBody.data.refreshToken,
    );
    const rememberPayload = decodeJwtPayload<{ iat: number; exp: number }>(
      rememberBody.data.refreshToken,
    );

    expect(rememberPayload.exp - rememberPayload.iat).toBeGreaterThan(
      normalPayload.exp - normalPayload.iat,
    );
  });

  test('logs out and invalidates the refresh token', async () => {
    const login = await loginAs(
      anonymousApi,
      seededUsers.member.email,
      seededUsers.member.password,
    );

    const logoutResponse = await anonymousApi.post('auth/logout', {
      data: {
        refreshToken: login.refreshToken,
      },
    });

    expect(logoutResponse.status()).toBe(201);

    const refreshResponse = await anonymousApi.post('auth/refresh-token', {
      data: {
        refreshToken: login.refreshToken,
      },
    });

    expect([401, 404]).toContain(refreshResponse.status());
  });

  test('registers a public member, keeps them pending, and allows login after verification', async () => {
    const payload = createRegisterPayload();

    const registerResponse = await anonymousApi.post('auth/register', {
      data: payload,
    });

    expect(registerResponse.status()).toBe(201);

    const registerBody = (await registerResponse.json()) as {
      data: { id: string; email: string; status: string };
    };

    expect(registerBody.data.email).toBe(payload.email);
    expect(registerBody.data.status).toBe('pending_verification');

    const createdUser = await findUserByEmail(payload.email);
    expect(createdUser).not.toBeNull();
    expect(await getUserRoleNames(createdUser!.id)).toEqual(['MEMBER']);

    const blockedLogin = await anonymousApi.post('auth/login', {
      data: {
        username: payload.email,
        password: payload.password,
      },
    });
    expect(blockedLogin.status()).toBe(401);

    const verificationToken = await createEmailVerificationToken({
      userId: createdUser!.id,
      email: createdUser!.email,
      mode: 'activate_only',
    });

    const verifyResponse = await anonymousApi.post('user/verify-email', {
      data: { token: verificationToken },
    });
    expect(verifyResponse.status()).toBe(200);

    const verifiedLogin = await anonymousApi.post('auth/login', {
      data: {
        username: payload.email,
        password: payload.password,
      },
    });
    expect(verifiedLogin.status()).toBe(201);
  });

  test.describe('user module API', () => {
    async function createManagedUser(
      overrides: Parameters<typeof createUserPayload>[0] = {},
    ) {
      const payload = createUserPayload(overrides);
      const response = await adminApi.post('user/create', {
        data: payload,
      });

      expect(response.status()).toBe(201);

      const body = (await response.json()) as {
        data: {
          id: string;
          email: string;
          status: string;
          roles: Array<{ name: string }>;
        };
      };

      const createdUser = await findUserByEmail(body.data.email);
      expect(createdUser).not.toBeNull();

      return {
        payload,
        responseBody: body,
        user: createdUser!,
      };
    }

    test('allows admins to create a pending-verification user with the default member role', async () => {
      const rawEmail = `  ${createUserPayload().email.toUpperCase()}  `;
      const response = await adminApi.post('user/create', {
        data: createUserPayload({
          email: rawEmail,
        }),
      });

      expect(response.status()).toBe(201);

      const body = (await response.json()) as {
        data: {
          id: string;
          email: string;
          status: string;
          password?: string;
        };
      };

      expect(body.data.email).toBe(rawEmail.trim().toLowerCase());
      expect(body.data.status).toBe('pending_verification');
      expect(body.data.password).toBeUndefined();
      expect(await getUserRoleNames(body.data.id)).toEqual(['MEMBER']);
    });

    test('rejects create-user requests that try to set a password directly', async () => {
      const response = await adminApi.post('user/create', {
        data: {
          ...createUserPayload(),
          password: 'ShouldNotPass@123',
        },
      });

      expect(response.status()).toBe(400);
    });

    test('rejects create-user requests that try to set status directly', async () => {
      const response = await adminApi.post('user/create', {
        data: {
          ...createUserPayload(),
          status: 'active',
        },
      });

      expect(response.status()).toBe(400);
    });

    test('rejects create-user requests with legacy role names', async () => {
      const response = await adminApi.post('user/create', {
        data: {
          ...createUserPayload(),
          role: 'member',
        },
      });

      expect(response.status()).toBe(400);
    });

    test('rejects create-user requests with duplicate email addresses', async () => {
      const payload = createUserPayload();
      const firstResponse = await adminApi.post('user/create', {
        data: payload,
      });
      expect(firstResponse.status()).toBe(201);

      const duplicateResponse = await adminApi.post('user/create', {
        data: {
          ...createUserPayload(),
          email: payload.email,
        },
      });

      expect(duplicateResponse.status()).toBe(400);
    });

  test('rolls the user back when verification email delivery fails during create-user', async () => {
      test.skip(
        isDeployedTarget(),
        'This scenario requires a temporary local server with per-process email env overrides.',
      );

      const temporaryServer = await startTemporaryApiServer({
        EMAIL_USER: '',
        EMAIL_PASSWORD: '',
      });
      const tempAnonymousApi = await createApiContext(
        undefined,
        temporaryServer.baseURL,
      );

      try {
        const adminLogin = await loginAs(
          tempAnonymousApi,
          seededUsers.admin.email,
          seededUsers.admin.password,
        );
        const tempAdminApi = await createApiContext(
          adminLogin.accessToken,
          temporaryServer.baseURL,
        );
        const payload = createUserPayload();

        try {
          const response = await tempAdminApi.post('user/create', {
            data: payload,
          });

          expect(response.status()).toBe(500);
          expect(await findUserByEmail(payload.email)).toBeNull();
        } finally {
          await tempAdminApi.dispose();
        }
      } finally {
        await tempAnonymousApi.dispose();
        await temporaryServer.stop();
      }
    });

    test('forbids members from creating users', async () => {
      const response = await memberApi.post('user/create', {
        data: createUserPayload(),
      });

      expect(response.status()).toBe(403);
    });

    test('renders setup-password fields on the verification landing page for admin-created users', async () => {
      const { user } = await createManagedUser();
      const token = await createEmailVerificationToken({
        userId: user.id,
        email: user.email,
        mode: 'setup_password',
      });

      const response = await anonymousApi.get(
        `user/verify-email?token=${encodeURIComponent(token)}`,
      );

      expect(response.status()).toBe(200);

      const body = (await response.json()) as Record<string, string | number>;
      const html = Object.keys(body)
        .filter((key) => /^\d+$/.test(key))
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => body[key])
        .join('');

      expect(html).toContain('Set Password and Activate Account');
      expect(html).toContain('name="password"');
      expect(html).toContain('name="confirmPassword"');
    });

    test('activates an admin-created user after email verification with password setup', async () => {
      const { user } = await createManagedUser();
      const password = 'VerifiedUser@123';
      const token = await createEmailVerificationToken({
        userId: user.id,
        email: user.email,
        mode: 'setup_password',
      });

      const verifyResponse = await anonymousApi.post('user/verify-email', {
        data: {
          token,
          password,
          confirmPassword: password,
        },
      });

      expect(verifyResponse.status()).toBe(200);

      const verifyBody = (await verifyResponse.json()) as {
        data: { id: string; status: string; email: string };
      };
      expect(verifyBody.data.id).toBe(user.id);
      expect(verifyBody.data.status).toBe('active');
      expect(verifyBody.data.email).toBe(user.email);

      const loginResponse = await anonymousApi.post('auth/login', {
        data: {
          username: user.email,
          password,
        },
      });

      expect(loginResponse.status()).toBe(201);
    });

    test('rejects setup-password verification when the password fields are missing', async () => {
      const { user } = await createManagedUser();
      const token = await createEmailVerificationToken({
        userId: user.id,
        email: user.email,
        mode: 'setup_password',
      });

      const response = await anonymousApi.post('user/verify-email', {
        data: { token },
      });

      expect(response.status()).toBe(400);
    });

    test('rejects invalid verification tokens', async () => {
      const response = await anonymousApi.post('user/verify-email', {
        data: {
          token: 'not-a-valid-token',
        },
      });

      expect(response.status()).toBe(401);
    });

    test('lists users for admins with role and search filters', async () => {
      await createManagedUser({
        email: `playwright-user-list-member-${Date.now()}@test.local`,
      });
      const { user } = await createManagedUser({
        email: `playwright-user-list-admin-${Date.now()}@test.local`,
        role: 'ADMIN',
      });

      const response = await adminApi.get(
        `user/list?role=ADMIN&searchField=email&q=list-admin&limit=1&page=1&counted=true`,
      );

      expect(response.status()).toBe(200);

      const body = (await response.json()) as {
        data: {
          docs: Array<{
            id: string;
            email: string;
            roles: Array<{ name: string }>;
          }>;
          docsCount: number;
          totalDocs: number;
          currentPage: number;
          limit: number;
        };
      };

      expect(body.data.currentPage).toBe(1);
      expect(body.data.limit).toBe(1);
      expect(body.data.docsCount).toBe(1);
      expect(body.data.totalDocs).toBe(1);
      expect(body.data.docs[0]?.id).toBe(user.id);
      expect(body.data.docs[0]?.email).toBe(user.email);
      expect(body.data.docs[0]?.roles.map((role) => role.name)).toContain(
        'ADMIN',
      );
    });

    test('returns a user by id for admins', async () => {
      const { user } = await createManagedUser();

      const response = await adminApi.get(`user/${user.id}`);

      expect(response.status()).toBe(200);

      const body = (await response.json()) as {
        data: {
          id: string;
          email: string;
          password?: string;
        };
      };

      expect(body.data.id).toBe(user.id);
      expect(body.data.email).toBe(user.email);
      expect(body.data.password).toBeUndefined();
    });

    test('updates user fields and switches the user role for admins', async () => {
      const { user } = await createManagedUser();

      const response = await adminApi.patch(`user/${user.id}`, {
        data: {
          firstName: 'Updated',
          phone: '010-9999-8888',
          status: 'inactive',
          role: 'ADMIN',
        },
      });

      expect(response.status()).toBe(200);

      const body = (await response.json()) as {
        data: {
          id: string;
          firstName: string;
          phone: string;
          status: string;
          roles: Array<{ name: string }>;
        };
      };

      expect(body.data.id).toBe(user.id);
      expect(body.data.firstName).toBe('Updated');
      expect(body.data.phone).toBe('010-9999-8888');
      expect(body.data.status).toBe('inactive');
      expect(body.data.roles.map((role) => role.name)).toEqual(['ADMIN']);
      expect(await getUserRoleNames(user.id)).toEqual(['ADMIN']);
    });

    test('banning a user invalidates sessions and blocks login within the user module flow', async () => {
      await loginAs(
        anonymousApi,
        seededUsers.member.email,
        seededUsers.member.password,
      );

      expect(await countSessionsForUser(seededUsers.member.id)).toBeGreaterThan(0);

      const response = await adminApi.patch(`user/${seededUsers.member.id}`, {
        data: {
          status: 'inactive',
        },
      });

      expect(response.status()).toBe(200);

      await expect
        .poll(() => countSessionsForUser(seededUsers.member.id), {
          timeout: 10000,
        })
        .toBe(0);

      const blockedLogin = await anonymousApi.post('auth/login', {
        data: {
          username: seededUsers.member.email,
          password: seededUsers.member.password,
        },
      });

      expect(blockedLogin.status()).toBe(401);
    });

    test('deletes users for admins', async () => {
      const { user } = await createManagedUser();

      const deleteResponse = await adminApi.delete(`user/${user.id}`);

      expect(deleteResponse.status()).toBe(200);

      const getResponse = await adminApi.get(`user/${user.id}`);
      expect(getResponse.status()).toBe(404);
      expect(await findUserByEmail(user.email)).toBeNull();
    });

    test('allows members to read their own roles but blocks them from reading another user roles', async () => {
      const ownRolesResponse = await memberApi.get(
        `user/${seededUsers.member.id}/roles`,
      );

      expect(ownRolesResponse.status()).toBe(200);

      const ownRolesBody = (await ownRolesResponse.json()) as {
        data: {
          userId: string;
          roles: Array<{ name: string }>;
        };
      };

      expect(ownRolesBody.data.userId).toBe(seededUsers.member.id);
      expect(ownRolesBody.data.roles.map((role) => role.name)).toContain(
        'MEMBER',
      );

      const forbiddenResponse = await memberApi.get(
        `user/${seededUsers.admin.id}/roles`,
      );

      expect(forbiddenResponse.status()).toBe(403);
    });

    test('assigns, lists, and removes roles through the user role endpoints', async () => {
      const { user } = await createManagedUser();
      const customRole = await createApiRole();

      const assignResponse = await adminApi.post(`user/${user.id}/roles`, {
        data: {
          roleIds: [customRole.id],
        },
      });

      expect(assignResponse.status()).toBe(201);

      const assignBody = (await assignResponse.json()) as {
        data: {
          userId: string;
          assignedRoles: number;
        };
      };
      expect(assignBody.data.userId).toBe(user.id);
      expect(assignBody.data.assignedRoles).toBe(1);

      const rolesResponse = await adminApi.get(`user/${user.id}/roles`);
      expect(rolesResponse.status()).toBe(200);

      const rolesBody = (await rolesResponse.json()) as {
        data: {
          roles: Array<{ name: string }>;
        };
      };
      expect(rolesBody.data.roles.map((role) => role.name)).toEqual(
        expect.arrayContaining(['MEMBER', customRole.name]),
      );

      const usersByRoleResponse = await adminApi.get(
        `user/by-role/${customRole.id}`,
      );
      expect(usersByRoleResponse.status()).toBe(200);

      const usersByRoleBody = (await usersByRoleResponse.json()) as {
        data: {
          users: Array<{ id: string; email: string }>;
        };
      };
      expect(
        usersByRoleBody.data.users.some((candidate) => candidate.id === user.id),
      ).toBe(true);

      const removeResponse = await adminApi.delete(
        `user/${user.id}/roles/${customRole.id}`,
      );
      expect(removeResponse.status()).toBe(200);
      expect(await getUserRoleNames(user.id)).toEqual(['MEMBER']);
    });

    test('returns composed user names and mapped phoneNumber in role-based user listings', async () => {
      const customRole = await createApiRole();
      const { user, payload } = await createManagedUser({
        firstName: 'Role',
        lastName: 'Listing',
        phone: '010-7777-2222',
      });

      const assignResponse = await adminApi.post(`user/${user.id}/roles`, {
        data: {
          roleIds: [customRole.id],
        },
      });
      expect(assignResponse.status()).toBe(201);

      const response = await adminApi.get(`roles/${customRole.id}/users`);

      expect(response.status()).toBe(200);

      const body = (await response.json()) as {
        data: {
          users: Array<{
            id: string;
            name: string;
            email: string;
            phoneNumber: string | null;
          }>;
        };
      };

      const listedUser = body.data.users.find((candidate) => candidate.id === user.id);

      expect(listedUser).toBeDefined();
      expect(listedUser?.name).toBe(`${payload.firstName} ${payload.lastName}`);
      expect(listedUser?.email).toBe(payload.email);
      expect(listedUser?.phoneNumber).toBe(payload.phone);
    });

    test('returns composed user names in role detail responses', async () => {
      const customRole = await createApiRole();
      const { user, payload } = await createManagedUser({
        firstName: 'Role',
        lastName: 'Detail',
      });

      const assignResponse = await adminApi.post(`user/${user.id}/roles`, {
        data: {
          roleIds: [customRole.id],
        },
      });
      expect(assignResponse.status()).toBe(201);

      const response = await adminApi.get(`roles/${customRole.id}`);

      expect(response.status()).toBe(200);

      const body = (await response.json()) as {
        data: {
          id: string;
          users: Array<{
            id: string;
            name: string;
            email: string;
          }>;
        };
      };

      const detailedUser = body.data.users.find((candidate) => candidate.id === user.id);

      expect(body.data.id).toBe(customRole.id);
      expect(detailedUser).toBeDefined();
      expect(detailedUser?.name).toBe(`${payload.firstName} ${payload.lastName}`);
      expect(detailedUser?.email).toBe(payload.email);
    });

    test('rejects unsupported avatar file uploads', async () => {
      const response = await memberApi.patch('user/avatar', {
        multipart: {
          file: {
            name: 'avatar.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('not-an-image'),
          },
        },
      });

      expect(response.status()).toBe(400);
    });
  });

  test('creates a membership tier', async () => {
    const payload = createMembershipPayload();
    const response = await adminApi.post('memberships', {
      data: payload,
    });

    expect(response.status()).toBe(201);

    const body = (await response.json()) as {
      id: string;
      name: string;
      purchasePrice: number;
      level: string;
      statusCode: number;
    };

    expect(body.id).toBeTruthy();
    expect(body.name).toBe(payload.name);
    expect(body.purchasePrice).toBe(payload.purchasePrice);
    expect(body.level).toBe(payload.level);
    expect(body.statusCode).toBe(201);
  });

  test('forbids member users from creating membership tiers', async () => {
    const response = await memberApi.post('memberships', {
      data: createMembershipPayload(),
    });

    expect(response.status()).toBe(403);
  });

  test('requires authentication for memberships/my', async () => {
    const response = await anonymousApi.get('memberships/my');
    expect(response.status()).toBe(401);
  });

  test('forbids member users from updating membership tiers', async () => {
    const created = await adminApi.post('memberships', {
      data: createMembershipPayload(),
    });
    const createdBody = (await created.json()) as { id: string };

    const response = await memberApi.patch(`memberships/${createdBody.id}`, {
      data: {
        description: 'Member should not update this',
      },
    });

    expect(response.status()).toBe(403);
  });

  test('forbids member users from deleting membership tiers', async () => {
    const created = await adminApi.post('memberships', {
      data: createMembershipPayload(),
    });
    const createdBody = (await created.json()) as { id: string };

    const response = await memberApi.delete(`memberships/${createdBody.id}`);

    expect(response.status()).toBe(403);
  });

  test('lists membership tiers', async () => {
    const created = await adminApi.post('memberships', {
      data: createMembershipPayload(),
    });
    const createdBody = (await created.json()) as { id: string };

    const response = await adminApi.get('memberships');

    expect(response.status()).toBe(200);

    const body = (await response.json()) as
      | Array<{ id: string }>
      | Record<string, { id?: string } | number | string>;
    const memberships = Array.isArray(body)
      ? body
      : Object.values(body).filter(
          (value): value is { id: string } =>
            typeof value === 'object' &&
            value !== null &&
            'id' in value &&
            typeof value.id === 'string',
        );

    expect(
      memberships.some((membership) => membership.id === createdBody.id),
    ).toBe(true);
  });

  test('returns null when the current member has no active membership', async () => {
    const response = await memberApi.get('memberships/my');

    expect(response.status()).toBe(200);

    const body = (await response.json()) as { statusCode: number };
    expect(body).toEqual({ statusCode: 200 });
  });

  test('gets a membership tier by id', async () => {
    const payload = createMembershipPayload();
    const created = await adminApi.post('memberships', {
      data: payload,
    });
    const createdBody = (await created.json()) as { id: string };

    const response = await adminApi.get(`memberships/${createdBody.id}`);

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      id: string;
      name: string;
    };

    expect(body.id).toBe(createdBody.id);
    expect(body.name).toBe(payload.name);
  });

  test('returns the active membership for the current member', async () => {
    const payload = createMembershipPayload();
    const created = await adminApi.post('memberships', {
      data: payload,
    });
    const createdBody = (await created.json()) as { id: string };

    await assignMembershipToUser(seededUsers.member.id, createdBody.id);

    const response = await memberApi.get('memberships/my');

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      userId: string;
      membershipId: string;
      membershipName: string;
      status: string;
      membership: { id: string; name: string };
    };

    expect(body.userId).toBe(seededUsers.member.id);
    expect(body.membershipId).toBe(createdBody.id);
    expect(body.membershipName).toBe(payload.name);
    expect(body.status).toBe('normal');
    expect(body.membership.id).toBe(createdBody.id);
    expect(body.membership.name).toBe(payload.name);
  });

  test('requires authentication for membership checkout', async () => {
    const created = await adminApi.post('memberships', {
      data: createMembershipPayload(),
    });
    const createdBody = (await created.json()) as { id: string };

    const response = await anonymousApi.post(
      `memberships/${createdBody.id}/checkout`,
    );

    expect(response.status()).toBe(401);
  });

  test('creates a pending checkout session without activating membership before payment success', async () => {
    const created = await adminApi.post('memberships', {
      data: createMembershipPayload(),
    });
    const createdBody = (await created.json()) as { id: string };

    const response = await memberApi.post(
      `memberships/${createdBody.id}/checkout`,
    );

    expect(response.status()).toBe(201);

    const body = (await response.json()) as { checkoutUrl: string };
    expect(body.checkoutUrl).toBeTruthy();
    expect(body.checkoutUrl).toContain('http');

    const payment = await findMembershipPaymentForUser(
      seededUsers.member.id,
      createdBody.id,
    );

    expect(payment).not.toBeNull();
    expect(payment?.status).toBe('PENDING');

    const membershipResponse = await memberApi.get('memberships/my');
    expect(membershipResponse.status()).toBe(200);
    expect(await membershipResponse.json()).toEqual({ statusCode: 200 });
  });

  test('activates membership after a successful payment webhook', async () => {
    const created = await adminApi.post('memberships', {
      data: createMembershipPayload(),
    });
    const createdBody = (await created.json()) as { id: string };

    const checkout = await memberApi.post(`memberships/${createdBody.id}/checkout`);
    expect(checkout.status()).toBe(201);

    const payment = await findMembershipPaymentForUser(
      seededUsers.member.id,
      createdBody.id,
    );
    expect(payment?.providerSessionId).toBeTruthy();

    const paymentIntentId = `pi_membership_success_${Date.now()}`;
    await triggerStripeWebhook({
      id: `evt_membership_success_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: payment!.providerSessionId,
          payment_intent: paymentIntentId,
        },
      },
    });

    await expect
      .poll(
        async () =>
          (
            await findMembershipPaymentForUser(
              seededUsers.member.id,
              createdBody.id,
            )
          )?.status ?? null,
        { timeout: 10000 },
      )
      .toBe('SUCCESS');

    await expect
      .poll(
        async () => {
          const response = await memberApi.get('memberships/my');
          const body = (await response.json()) as { membershipId?: string };
          return body.membershipId ?? null;
        },
        { timeout: 10000 },
      )
      .toBe(createdBody.id);

    const membershipRecord = await findMembershipRecordByPaymentId(payment!.id);
    expect(membershipRecord?.status).toBe('normal');
  });

  test('marks payment failed without activating a membership', async () => {
    const created = await adminApi.post('memberships', {
      data: createMembershipPayload(),
    });
    const createdBody = (await created.json()) as { id: string };

    const checkout = await memberApi.post(`memberships/${createdBody.id}/checkout`);
    expect(checkout.status()).toBe(201);

    const payment = await findMembershipPaymentForUser(
      seededUsers.member.id,
      createdBody.id,
    );
    expect(payment).not.toBeNull();

    await triggerStripeWebhook({
      id: `evt_membership_failed_${Date.now()}`,
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: `pi_membership_failed_${Date.now()}`,
          metadata: {
            paymentId: payment!.id,
          },
        },
      },
    });

    await expect
      .poll(
        async () =>
          (
            await findMembershipPaymentForUser(
              seededUsers.member.id,
              createdBody.id,
            )
          )?.status ?? null,
        { timeout: 10000 },
      )
      .toBe('FAILED');

    const membershipResponse = await memberApi.get('memberships/my');
    expect(membershipResponse.status()).toBe(200);
    expect(await membershipResponse.json()).toEqual({ statusCode: 200 });
    expect(await findMembershipRecordByPaymentId(payment!.id)).toBeNull();
  });

  test('deactivates an active membership after a refund webhook', async () => {
    const created = await adminApi.post('memberships', {
      data: createMembershipPayload(),
    });
    const createdBody = (await created.json()) as { id: string };

    const checkout = await memberApi.post(`memberships/${createdBody.id}/checkout`);
    expect(checkout.status()).toBe(201);

    const payment = await findMembershipPaymentForUser(
      seededUsers.member.id,
      createdBody.id,
    );
    expect(payment?.providerSessionId).toBeTruthy();

    const paymentIntentId = `pi_membership_refund_${Date.now()}`;
    await triggerStripeWebhook({
      id: `evt_membership_success_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: payment!.providerSessionId,
          payment_intent: paymentIntentId,
        },
      },
    });

    await expect
      .poll(
        async () => (await findMembershipRecordByPaymentId(payment!.id))?.status,
        { timeout: 10000 },
      )
      .toBe('normal');

    await triggerStripeWebhook({
      id: `evt_membership_refund_${Date.now()}`,
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: {
          payment_intent: paymentIntentId,
        },
      },
    });

    await expect
      .poll(
        async () =>
          (
            await findMembershipPaymentForUser(
              seededUsers.member.id,
              createdBody.id,
            )
          )?.status ?? null,
        { timeout: 10000 },
      )
      .toBe('REFUNDED');

    await expect
      .poll(
        async () => (await findMembershipRecordByPaymentId(payment!.id))?.status,
        { timeout: 10000 },
      )
      .toBe('expired');

    const membershipResponse = await memberApi.get('memberships/my');
    expect(membershipResponse.status()).toBe(200);
    expect(await membershipResponse.json()).toEqual({ statusCode: 200 });
  });

  test('time-stacks same-tier renewals after repeated successful payments', async () => {
    const created = await adminApi.post('memberships', {
      data: createMembershipPayload(),
    });
    const createdBody = (await created.json()) as { id: string };

    const firstCheckout = await memberApi.post(
      `memberships/${createdBody.id}/checkout`,
    );
    expect(firstCheckout.status()).toBe(201);

    const firstPayment = await findMembershipPaymentForUser(
      seededUsers.member.id,
      createdBody.id,
    );
    const firstIntentId = `pi_membership_stack_first_${Date.now()}`;
    await triggerStripeWebhook({
      id: `evt_membership_stack_first_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: firstPayment!.providerSessionId,
          payment_intent: firstIntentId,
        },
      },
    });

    const firstMembership = await expect
      .poll(
        async () => findMembershipRecordByPaymentId(firstPayment!.id),
        { timeout: 10000 },
      )
      .toBeTruthy();

    const initialMembership = await findMembershipRecordByPaymentId(firstPayment!.id);
    expect(initialMembership).not.toBeNull();
    const initialEndDate = new Date(initialMembership!.endDate);

    const secondCheckout = await memberApi.post(
      `memberships/${createdBody.id}/checkout`,
    );
    expect(secondCheckout.status()).toBe(201);

    const secondPayment = await findMembershipPaymentForUser(
      seededUsers.member.id,
      createdBody.id,
    );
    expect(secondPayment?.id).not.toBe(firstPayment?.id);

    await triggerStripeWebhook({
      id: `evt_membership_stack_second_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: secondPayment!.providerSessionId,
          payment_intent: `pi_membership_stack_second_${Date.now()}`,
        },
      },
    });

    await expect
      .poll(
        async () => (await findMembershipRecordByPaymentId(secondPayment!.id))?.id,
        { timeout: 10000 },
      )
      .toBe(initialMembership!.id);

    const renewedMembership = await findMembershipRecordByPaymentId(secondPayment!.id);
    expect(renewedMembership?.id).toBe(initialMembership!.id);

    const expectedRenewedEndDate = new Date(initialEndDate);
    expectedRenewedEndDate.setFullYear(expectedRenewedEndDate.getFullYear() + 1);
    expect(renewedMembership?.endDate.toISOString()).toBe(
      expectedRenewedEndDate.toISOString(),
    );
    expect(renewedMembership?.paymentId).toBe(secondPayment!.id);
  });

  test('soft-expires the old tier record when the member switches tiers after payment success', async () => {
    const basicCreated = await adminApi.post('memberships', {
      data: {
        ...createMembershipPayload(),
        level: 'BASIC',
      },
    });
    const premiumCreated = await adminApi.post('memberships', {
      data: {
        ...createMembershipPayload(),
        level: 'PREMIUM',
      },
    });
    const basicBody = (await basicCreated.json()) as { id: string };
    const premiumBody = (await premiumCreated.json()) as { id: string };

    const basicCheckout = await memberApi.post(`memberships/${basicBody.id}/checkout`);
    expect(basicCheckout.status()).toBe(201);
    const basicPayment = await findMembershipPaymentForUser(
      seededUsers.member.id,
      basicBody.id,
    );

    await triggerStripeWebhook({
      id: `evt_membership_basic_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: basicPayment!.providerSessionId,
          payment_intent: `pi_membership_basic_${Date.now()}`,
        },
      },
    });

    await expect
      .poll(
        async () => (await findMembershipRecordByPaymentId(basicPayment!.id))?.status,
        { timeout: 10000 },
      )
      .toBe('normal');

    const premiumCheckout = await memberApi.post(
      `memberships/${premiumBody.id}/checkout`,
    );
    expect(premiumCheckout.status()).toBe(201);
    const premiumPayment = await findMembershipPaymentForUser(
      seededUsers.member.id,
      premiumBody.id,
    );

    await triggerStripeWebhook({
      id: `evt_membership_premium_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: premiumPayment!.providerSessionId,
          payment_intent: `pi_membership_premium_${Date.now()}`,
        },
      },
    });

    await expect
      .poll(
        async () => {
          const response = await memberApi.get('memberships/my');
          const body = (await response.json()) as { membershipId?: string };
          return body.membershipId ?? null;
        },
        { timeout: 10000 },
      )
      .toBe(premiumBody.id);

    const membershipRecords = await listMembershipRecordsForUser(
      seededUsers.member.id,
    );
    const expiredBasic = membershipRecords.find(
      (record) => record.membershipId === basicBody.id && record.status === 'expired',
    );
    const activePremium = membershipRecords.find(
      (record) =>
        record.membershipId === premiumBody.id && record.status === 'normal',
    );

    expect(expiredBasic).toBeDefined();
    expect(activePremium).toBeDefined();
  });

  test('updates a membership tier', async () => {
    const created = await adminApi.post('memberships', {
      data: createMembershipPayload(),
    });
    const createdBody = (await created.json()) as { id: string };

    const response = await adminApi.patch(`memberships/${createdBody.id}`, {
      data: {
        description: 'Updated by Playwright',
        purchasePrice: 180_000,
      },
    });

    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      id: string;
      description: string;
      purchasePrice: number;
    };

    expect(body.id).toBe(createdBody.id);
    expect(body.description).toBe('Updated by Playwright');
    expect(body.purchasePrice).toBe(180_000);
  });

  test('deletes a membership tier', async () => {
    const created = await adminApi.post('memberships', {
      data: createMembershipPayload(),
    });
    const createdBody = (await created.json()) as { id: string };

    const deleteResponse = await adminApi.delete(`memberships/${createdBody.id}`);

    expect(deleteResponse.status()).toBe(200);

    const getResponse = await adminApi.get(`memberships/${createdBody.id}`);
    expect(getResponse.status()).toBe(404);
  });

  test('prevents deleting a tier that still has active memberships', async () => {
    const payload = createMembershipPayload();
    const created = await adminApi.post('memberships', {
      data: payload,
    });
    const createdBody = (await created.json()) as { id: string };

    await assignMembershipToUser(seededUsers.member.id, createdBody.id);

    const response = await adminApi.delete(`memberships/${createdBody.id}`);

    expect(response.status()).toBe(400);

    const getResponse = await adminApi.get(`memberships/${createdBody.id}`);
    expect(getResponse.status()).toBe(200);
  });
});
