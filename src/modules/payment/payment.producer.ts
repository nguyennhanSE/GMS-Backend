import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PaymentEventPayload } from './dto/webhook-event.dto';
import { RMQ_CLIENT_TOKEN, ROUTING_KEYS } from './constants/payment.constants';

@Injectable()
export class PaymentProducer {
  private readonly logger = new Logger(PaymentProducer.name);

  constructor(
    @Inject(RMQ_CLIENT_TOKEN) private readonly rmqClient: ClientProxy,
  ) {}

  async onModuleInit() {
    await this.rmqClient.connect();
    this.logger.log('RabbitMQ client connected');
  }

  emitPaymentSuccess(payload: PaymentEventPayload) {
    this.rmqClient.emit(ROUTING_KEYS.SUCCESS, payload);
    this.logger.log(
      `Emitted ${ROUTING_KEYS.SUCCESS} for payment ${payload.paymentId}`,
    );
  }

  emitPaymentFailed(payload: PaymentEventPayload) {
    this.rmqClient.emit(ROUTING_KEYS.FAILED, payload);
    this.logger.log(
      `Emitted ${ROUTING_KEYS.FAILED} for payment ${payload.paymentId}`,
    );
  }

  emitPaymentRefunded(payload: PaymentEventPayload) {
    this.rmqClient.emit(ROUTING_KEYS.REFUNDED, payload);
    this.logger.log(
      `Emitted ${ROUTING_KEYS.REFUNDED} for payment ${payload.paymentId}`,
    );
  }
}
