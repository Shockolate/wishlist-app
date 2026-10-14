import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { SecurityModule } from '../security/security.module.js';
import { AccountService } from './account.service.js';
import { AuthEmails } from './auth-emails.js';
import { EmailGate } from './email-gate.js';
import { EmailTokensService } from './email-tokens.service.js';
import { LoginService } from './login.service.js';
import { MeController } from './me.controller.js';
import { PasswordResetController } from './password-reset.controller.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionController } from './session.controller.js';
import { OptionalSessionGuard, SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';
import { SignupController } from './signup.controller.js';
import { SignupService } from './signup.service.js';
import { VerifiedGuard } from './verified.guard.js';

/** Accounts and sessions (spec §5 Auth, §6.1–§6.6). */
@Module({
  imports: [RateLimitModule, SecurityModule, EmailModule],
  controllers: [SessionController, MeController, SignupController, PasswordResetController],
  providers: [
    SessionsService,
    SessionGuard,
    OptionalSessionGuard,
    VerifiedGuard,
    EmailTokensService,
    EmailGate,
    AuthEmails,
    SignupService,
    LoginService,
    PasswordResetService,
    AccountService,
  ],
  exports: [SessionsService, SessionGuard, OptionalSessionGuard, VerifiedGuard],
})
export class AuthModule {}
