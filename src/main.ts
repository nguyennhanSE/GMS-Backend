import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { config, NODE_ENV } from './libs/config';
import { TransformInterceptor } from './libs/interceptor/response.interceptor';
import { PAYMENT_QUEUE } from './modules/payment/constants/payment.constants';

function configureHttp(app: INestApplication) {
  let swaggerConfig: Omit<OpenAPIObject, 'paths'> | undefined;

  if (NODE_ENV === 'development') {
    swaggerConfig = new DocumentBuilder()
      .addBearerAuth()
      .setTitle('GMS Backend API')
      .setDescription(
        'API of GMS Backend with authentication and role-based authorization',
      )
      .setVersion('1.0')
      .addServer(
        `http://localhost:${config.APP_PORT}/api/v1`,
        'Development server',
      )
      .build();
  } else if (NODE_ENV === 'production') {
    swaggerConfig = new DocumentBuilder()
      .addBearerAuth()
      .setTitle('GMS Backend API')
      .setDescription(
        'API of GMS Backend with authentication and role-based authorization',
      )
      .setVersion('1.0')
      .addServer(`${config.APP_HOST}/api/v1`, 'Production server')
      .build();
  }

  if (swaggerConfig) {
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/v1/docs', app, document);
  }

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Requested-With',
    ],
  });

  app.setGlobalPrefix('/api/v1');
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const shouldServeHttp = config.SERVE_HTTP;
  const shouldRunBackgroundWorkers = config.RUN_BACKGROUND_WORKERS;

  configureHttp(app);

  if (shouldRunBackgroundWorkers) {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [config.RABBITMQ_URL],
        queue: PAYMENT_QUEUE,
        queueOptions: {
          durable: true,
          deadLetterExchange: 'payment.events.dlx',
          deadLetterRoutingKey: 'payment.dlq.booking',
          messageTtl: 86400000,
        },
        noAck: false,
      },
    });
  }

  if (!shouldServeHttp) {
    await app.init();

    if (shouldRunBackgroundWorkers) {
      await app.startAllMicroservices();
      console.log('Background worker is listening (RabbitMQ)');
    }

    console.log(
      `Background worker started with APP_RUNTIME_ROLE=${config.APP_RUNTIME_ROLE}`,
    );
    return;
  }

  if (shouldRunBackgroundWorkers) {
    await app.startAllMicroservices();
    console.log('Microservice is listening (RabbitMQ)');
  }

  await app.listen(config.APP_PORT, '0.0.0.0');
  console.log(`Listening on Port ${config.APP_PORT}`);
  console.log(`Runtime role: ${config.APP_RUNTIME_ROLE}`);
  console.log(`Swagger documentation available at /api/v1/docs`);
}

void bootstrap().catch((error) => {
  console.error('Application bootstrap failed', error);
  process.exit(1);
});
