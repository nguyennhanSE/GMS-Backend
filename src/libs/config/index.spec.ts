import { buildConfig } from './index';

describe('production config validation', () => {
  it('throws when required production variables are missing', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      CHATBOT_COHERE_ENABLED: 'false',
      REDIS_ENABLED: 'false',
    };

    expect(() => buildConfig(env, 'production')).toThrow(
      /Missing required variables/,
    );
  });

  it('loads production config when required variables are provided', () => {
    const env: NodeJS.ProcessEnv = {
      APP_RUNTIME_ROLE: 'web',
      APP_HOST: 'https://api.example.com',
      FRONTEND_URL: 'https://app.example.com',
      JWT_SECRET_ACCESS_TOKEN: 'access-secret',
      JWT_SECRET_REFRESH_TOKEN: 'refresh-secret',
      DATABASE_URL: 'postgresql://postgres:password@db.internal:5432/gms',
      EMAIL_HOST: 'smtp.gmail.com',
      EMAIL_PORT: '465',
      EMAIL_SECURE: 'true',
      EMAIL_USER: 'notifications@example.com',
      EMAIL_PASSWORD: 'app-password',
      EMAIL_FROM: 'GMS <notifications@example.com>',
      STRIPE_SECRET_KEY: 'sk_live_example',
      STRIPE_WEBHOOK_SECRET: 'whsec_example',
      STRIPE_SUCCESS_URL: 'https://app.example.com/payment/success',
      STRIPE_CANCEL_URL: 'https://app.example.com/payment/cancel',
      RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
      CHATBOT_COHERE_ENABLED: 'false',
      REDIS_ENABLED: 'false',
    };

    const loadedConfig = buildConfig(env, 'production');

    expect(loadedConfig.APP_HOST).toBe('https://api.example.com');
    expect(loadedConfig.APP_RUNTIME_ROLE).toBe('web');
    expect(loadedConfig.SERVE_HTTP).toBe(true);
    expect(loadedConfig.RUN_BACKGROUND_WORKERS).toBe(false);
    expect(loadedConfig.STRIPE_SECRET_KEY).toBe('sk_live_example');
    expect(loadedConfig.RABBITMQ_URL).toBe('amqp://guest:guest@localhost:5672');
  });

  it('rejects APP_RUNTIME_ROLE=all in production', () => {
    const env: NodeJS.ProcessEnv = {
      APP_RUNTIME_ROLE: 'all',
      APP_HOST: 'https://api.example.com',
      FRONTEND_URL: 'https://app.example.com',
      JWT_SECRET_ACCESS_TOKEN: 'access-secret',
      JWT_SECRET_REFRESH_TOKEN: 'refresh-secret',
      DATABASE_URL: 'postgresql://postgres:password@db.internal:5432/gms',
      EMAIL_HOST: 'smtp.gmail.com',
      EMAIL_PORT: '465',
      EMAIL_SECURE: 'true',
      EMAIL_USER: 'notifications@example.com',
      EMAIL_PASSWORD: 'app-password',
      EMAIL_FROM: 'GMS <notifications@example.com>',
      STRIPE_SECRET_KEY: 'sk_live_example',
      STRIPE_WEBHOOK_SECRET: 'whsec_example',
      STRIPE_SUCCESS_URL: 'https://app.example.com/payment/success',
      STRIPE_CANCEL_URL: 'https://app.example.com/payment/cancel',
      RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
      CHATBOT_COHERE_ENABLED: 'false',
      REDIS_ENABLED: 'false',
    };

    expect(() => buildConfig(env, 'production')).toThrow(
      /Invalid APP_RUNTIME_ROLE "all" in production/,
    );
  });
});
