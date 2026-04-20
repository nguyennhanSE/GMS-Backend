import * as dotenv from 'dotenv';
import {
  parseAppRuntimeRole,
  shouldRunBackgroundWorkers,
  shouldServeHttp,
} from './runtime-role';

export const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
dotenv.config({ path: envFile });

function readEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  return env[name]?.trim() || fallback;
}

function readRequiredEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  missingKeys: Set<string>,
): string {
  const value = env[name]?.trim();

  if (value) {
    return value;
  }

  missingKeys.add(name);
  return '';
}

function readEmailFromEnv(env: NodeJS.ProcessEnv): string {
  const emailFrom = env.EMAIL_FROM?.trim();
  if (emailFrom) {
    return emailFrom;
  }

  const emailUser = env.EMAIL_USER?.trim();
  if (emailUser) {
    return emailUser;
  }

  return 'noreply@gms.com';
}

function validateProductionConfig(
  nodeEnv: string,
  missingKeys: Set<string>,
): void {
  const isProduction = nodeEnv === 'production';

  if (!isProduction || missingKeys.size === 0) {
    return;
  }

  const missingList = Array.from(missingKeys).sort().join(', ');
  throw new Error(
    `Invalid production configuration from ${envFile}. Missing required variables: ${missingList}. Copy .env.prod.example to .env.prod and provide real production values.`,
  );
}

export function buildConfig(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv: string = NODE_ENV,
) {
  const isProduction = nodeEnv === 'production';
  const appRuntimeRole = parseAppRuntimeRole(env.APP_RUNTIME_ROLE, nodeEnv);
  const missingProductionKeys = new Set<string>();
  const chatbotCohereEnabled =
    env.CHATBOT_COHERE_ENABLED === 'true' ||
    env.CHATBOT_COHERE_ENABLED === '1';
  const redisEnabled =
    env.REDIS_ENABLED === 'true' || env.REDIS_ENABLED === '1';

  const config = {
    // App Configuration
    APP_PORT: parseInt(env.PORT || env.APP_PORT || '3001', 10),
    APP_RUNTIME_ROLE: appRuntimeRole,
    SERVE_HTTP: shouldServeHttp(appRuntimeRole),
    RUN_BACKGROUND_WORKERS: shouldRunBackgroundWorkers(appRuntimeRole),
    APP_HOST: isProduction
      ? readRequiredEnv(env, 'APP_HOST', missingProductionKeys)
      : readEnv(env, 'APP_HOST', 'http://localhost:3001'),

    // Frontend Configuration
    FRONTEND_URL: isProduction
      ? readRequiredEnv(env, 'FRONTEND_URL', missingProductionKeys)
      : readEnv(env, 'FRONTEND_URL', 'http://localhost:3000'),
    FRONTEND_PORT: env.FRONTEND_PORT ?? 3000,

    // JWT Configuration
    JWT_SECRET_ACCESS_TOKEN: isProduction
      ? readRequiredEnv(env, 'JWT_SECRET_ACCESS_TOKEN', missingProductionKeys)
      : readEnv(env, 'JWT_SECRET_ACCESS_TOKEN', 'GMSAccessTokenSecret'),
    JWT_SECRET_REFRESH_TOKEN: isProduction
      ? readRequiredEnv(env, 'JWT_SECRET_REFRESH_TOKEN', missingProductionKeys)
      : readEnv(env, 'JWT_SECRET_REFRESH_TOKEN', 'GMSRefreshTokenSecret'),
    JWT_TOKEN_EXPIRATION_TIME: env.JWT_TOKEN_EXPIRATION_TIME ?? '1d',
    ACCESS_TOKEN_EXPIRES_IN: env.ACCESS_TOKEN_EXPIRES_IN ?? '15m',
    REFRESH_TOKEN_EXPIRES_IN: env.REFRESH_TOKEN_EXPIRES_IN ?? '24h',
    REFRESH_TOKEN_REMEMBER_EXPIRES_IN:
      env.REFRESH_TOKEN_REMEMBER_EXPIRES_IN ?? '30d',

    // Database Configuration
    DATABASE_USERNAME: env.DATABASE_USERNAME ?? 'postgres',
    DATABASE_PASSWORD: env.DATABASE_PASSWORD ?? 'postgres',
    DATABASE_HOST: env.DATABASE_HOST ?? 'localhost',
    DATABASE_PORT: env.DATABASE_PORT ?? 5432,
    DATABASE_NAME: env.DATABASE_NAME ?? 'postgres',
    DATABASE_SCHEMA: env.DATABASE_SCHEMA ?? 'public',
    DATABASE_URL: isProduction
      ? readRequiredEnv(env, 'DATABASE_URL', missingProductionKeys)
      : readEnv(
          env,
          'DATABASE_URL',
          'postgresql://postgres:123456@localhost:5540/postgres',
        ),

    // Email Configuration
    EMAIL_HOST: isProduction
      ? readRequiredEnv(env, 'EMAIL_HOST', missingProductionKeys)
      : readEnv(env, 'EMAIL_HOST', 'smtp.naver.com'),
    EMAIL_PORT: isProduction
      ? readRequiredEnv(env, 'EMAIL_PORT', missingProductionKeys)
      : env.EMAIL_PORT ?? 465,
    EMAIL_SECURE: isProduction
      ? readRequiredEnv(env, 'EMAIL_SECURE', missingProductionKeys)
      : env.EMAIL_SECURE ?? true,
    EMAIL_USER: isProduction
      ? readRequiredEnv(env, 'EMAIL_USER', missingProductionKeys)
      : env.EMAIL_USER ?? '',
    EMAIL_PASSWORD: isProduction
      ? readRequiredEnv(env, 'EMAIL_PASSWORD', missingProductionKeys)
      : env.EMAIL_PASSWORD ?? '',
    EMAIL_FROM: isProduction
      ? readRequiredEnv(env, 'EMAIL_FROM', missingProductionKeys)
      : readEmailFromEnv(env),

    // Cloudinary Configuration
    CLOUDINARY_CLOUD_NAME: env.CLOUDINARY_CLOUD_NAME ?? '',
    CLOUDINARY_API_KEY: env.CLOUDINARY_API_KEY ?? '',
    CLOUDINARY_API_SECRET: env.CLOUDINARY_API_SECRET ?? '',

    // Stripe Configuration
    STRIPE_SECRET_KEY: isProduction
      ? readRequiredEnv(env, 'STRIPE_SECRET_KEY', missingProductionKeys)
      : env.STRIPE_SECRET_KEY ?? '',
    STRIPE_WEBHOOK_SECRET: isProduction
      ? readRequiredEnv(env, 'STRIPE_WEBHOOK_SECRET', missingProductionKeys)
      : env.STRIPE_WEBHOOK_SECRET ?? '',
    STRIPE_SUCCESS_URL: isProduction
      ? readRequiredEnv(env, 'STRIPE_SUCCESS_URL', missingProductionKeys)
      : readEnv(env, 'STRIPE_SUCCESS_URL', 'http://localhost:3000/payment/success'),
    STRIPE_CANCEL_URL: isProduction
      ? readRequiredEnv(env, 'STRIPE_CANCEL_URL', missingProductionKeys)
      : readEnv(env, 'STRIPE_CANCEL_URL', 'http://localhost:3000/payment/cancel'),

    // Cohere / Chatbot Configuration
    COHERE_API_URL: readEnv(env, 'COHERE_API_URL', 'https://api.cohere.com/v2/chat'),
    COHERE_API_KEY:
      isProduction && chatbotCohereEnabled
        ? readRequiredEnv(env, 'COHERE_API_KEY', missingProductionKeys)
        : env.COHERE_API_KEY ?? '',
    COHERE_MODEL: readEnv(env, 'COHERE_MODEL', 'command-r'),
    CHATBOT_COHERE_ENABLED: chatbotCohereEnabled,
    CHATBOT_SESSION_TTL_HOURS: parseInt(
      env.CHATBOT_SESSION_TTL_HOURS ?? '24',
      10,
    ),
    CHATBOT_CONTEXT_PAIRS: parseInt(env.CHATBOT_CONTEXT_PAIRS ?? '5', 10),

    // RabbitMQ Configuration
    RABBITMQ_URL: isProduction
      ? readRequiredEnv(env, 'RABBITMQ_URL', missingProductionKeys)
      : readEnv(env, 'RABBITMQ_URL', 'amqp://localhost:5672'),

    // Redis Cache Configuration
    REDIS_ENABLED: redisEnabled,
    REDIS_HOST:
      isProduction && redisEnabled
        ? readRequiredEnv(env, 'REDIS_HOST', missingProductionKeys)
        : readEnv(env, 'REDIS_HOST', 'localhost'),
    REDIS_PORT: parseInt(
      isProduction && redisEnabled
        ? readRequiredEnv(env, 'REDIS_PORT', missingProductionKeys)
        : env.REDIS_PORT ?? '6379',
      10,
    ),
    REDIS_USERNAME: env.REDIS_USERNAME ?? '',
    REDIS_PASSWORD: env.REDIS_PASSWORD ?? '',
    REDIS_DB: parseInt(env.REDIS_DB ?? '0', 10),
    REDIS_TTL_SECONDS: parseInt(env.REDIS_TTL_SECONDS ?? '300', 10),
  };

  validateProductionConfig(nodeEnv, missingProductionKeys);

  return config;
}

export const config = buildConfig();
