import { defineConfig } from '@playwright/test';

const port = process.env.PLAYWRIGHT_API_PORT ?? '3015';
const baseURL = process.env.API_BASE_URL ?? `http://127.0.0.1:${port}/api/v1/`;

export default defineConfig({
  testDir: './test/playwright',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },
  webServer: {
    command:
      'node -r ts-node/register/transpile-only -r tsconfig-paths/register test/playwright/server.ts',
    url: `${baseURL}health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
