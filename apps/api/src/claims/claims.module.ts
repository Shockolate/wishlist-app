import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SharedController } from './shared.controller.js';
import { SharedListService } from './shared-list.service.js';

/** Share links and claims (spec §5 Public endpoints, §5.1, §6.3). */
@Module({
  imports: [AuthModule],
  controllers: [SharedController],
  providers: [SharedListService],
})
export class ClaimsModule {}
