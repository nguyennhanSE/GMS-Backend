import { defineConfig } from '@playwright/test';
import {
  PLAYWRIGHT_API_BASE_URL,
  usesLocalPlaywrightServer,
} from './test/playwright/target-mode';

const config = defineConfig({
  testDir: './test/playwright',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: PLAYWRIGHT_API_BASE_URL,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },
});

if (usesLocalPlaywrightServer()) {
  config.webServer = {
    command:
      'node -r ts-node/register/transpile-only -r tsconfig-paths/register test/playwright/server.ts',
    url: `${PLAYWRIGHT_API_BASE_URL}health`,
    reuseExistingServer: false,
    timeout: 120_000,
  };
}

export default config;
