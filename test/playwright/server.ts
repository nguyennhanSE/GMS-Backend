import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from '../../src/app.module';
import { config } from '../../src/libs/config';
import { TransformInterceptor } from '../../src/libs/interceptor/response.interceptor';
import { PAYMENT_QUEUE } from '../../src/modules/payment/constants/payment.constants';

async function bootstrap() {
  const port = parseInt(process.env.PLAYWRIGHT_API_PORT ?? '3015', 10);

  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('/api/v1');
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

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

  await app.startAllMicroservices();
  await app.listen(port, '127.0.0.1');

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
