import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SecurityModule } from '../security/security.module.js';
import { AuthEmails } from './auth-emails.js';
import { EmailGate } from './email-gate.js';
import { EmailTokensService } from './email-tokens.service.js';
import { LoginService } from './login.service.js';
import { MeController } from './me.controller.js';
import { SessionController } from './session.controller.js';
import { SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';
import { SignupController } from './signup.controller.js';
import { SignupService } from './signup.service.js';

/** Accounts and sessions (spec §5 Auth, §6.1–§6.6). */
@Module({
  imports: [RateLimitModule, SecurityModule, EmailModule],
  controllers: [SessionController, MeController, SignupController],
  providers: [
    SessionsService,
    SessionGuard,
    EmailTokensService,
    EmailGate,
    AuthEmails,
    SignupService,
    LoginService,
  ],
})
export class AuthModule {}
