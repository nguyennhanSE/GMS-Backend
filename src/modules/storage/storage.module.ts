import { Module } from '@nestjs/common';
import { LoggerModule } from '../../libs/logger/logger.module';
import { StorageService } from './storage.service';

@Module({
  imports: [LoggerModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
