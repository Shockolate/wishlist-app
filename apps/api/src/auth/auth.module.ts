import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SecurityModule } from '../security/security.module.js';
import { MeController } from './me.controller.js';
import { SessionController } from './session.controller.js';
import { SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';

/** Accounts and sessions (spec §5 Auth, §6.1–§6.6). */
@Module({
  imports: [RateLimitModule, SecurityModule, EmailModule],
  controllers: [SessionController, MeController],
  providers: [SessionsService, SessionGuard],
})
export class AuthModule {}
