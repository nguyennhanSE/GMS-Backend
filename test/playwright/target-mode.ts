export type PlaywrightTarget = 'local' | 'deployed';

const DEFAULT_PORT = process.env.PLAYWRIGHT_API_PORT ?? '3015';
const LOCAL_API_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}/api/v1/`;

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function resolveTarget(): PlaywrightTarget {
  const target = normalize(process.env.PLAYWRIGHT_TARGET);

  if (!target || target === 'local') {
    return 'local';
  }

  if (target === 'deployed') {
    return 'deployed';
  }

  throw new Error(
    `Unsupported PLAYWRIGHT_TARGET "${process.env.PLAYWRIGHT_TARGET}". Use "local" or "deployed".`,
  );
}

function resolveDeploymentEnv() {
  return normalize(process.env.PLAYWRIGHT_DEPLOY_ENV);
}

function resolveApiBaseUrl(target: PlaywrightTarget) {
  if (target === 'local') {
    return LOCAL_API_BASE_URL;
  }

  const baseUrl = process.env.API_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error(
      'API_BASE_URL is required when PLAYWRIGHT_TARGET=deployed.',
    );
  }

  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function resolveDatabaseUrl(target: PlaywrightTarget) {
  if (target !== 'deployed') {
    return '';
  }

  const databaseUrl = process.env.PLAYWRIGHT_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      'PLAYWRIGHT_DATABASE_URL is required when PLAYWRIGHT_TARGET=deployed so Prisma seeding and cleanup use the same database as the deployed API.',
    );
  }

  return databaseUrl;
}

function validate(target: PlaywrightTarget, deploymentEnv: string) {
  if (target !== 'deployed') {
    return;
  }

  if (!deploymentEnv) {
    throw new Error(
      'PLAYWRIGHT_DEPLOY_ENV is required when PLAYWRIGHT_TARGET=deployed. Use a non-production value such as "staging" or "test".',
    );
  }

  if (deploymentEnv === 'production' || deploymentEnv === 'prod') {
    throw new Error(
      'PLAYWRIGHT_TARGET=deployed is blocked for production environments.',
    );
  }
}

export const PLAYWRIGHT_TARGET = resolveTarget();
export const PLAYWRIGHT_DEPLOY_ENV = resolveDeploymentEnv();

validate(PLAYWRIGHT_TARGET, PLAYWRIGHT_DEPLOY_ENV);

export const PLAYWRIGHT_API_BASE_URL = resolveApiBaseUrl(PLAYWRIGHT_TARGET);
export const PLAYWRIGHT_DATABASE_URL = resolveDatabaseUrl(PLAYWRIGHT_TARGET);
export const IS_DEPLOYED_PLAYWRIGHT_TARGET =
  PLAYWRIGHT_TARGET === 'deployed';

export function isDeployedTarget() {
  return IS_DEPLOYED_PLAYWRIGHT_TARGET;
}

export function usesLocalPlaywrightServer() {
  return !IS_DEPLOYED_PLAYWRIGHT_TARGET;
}
