import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import {
  ResendVerificationRequestSchema,
  SignupRequestSchema,
  VerifyEmailRequestSchema,
  type ResendVerificationRequest,
  type SignupRequest,
  type VerifyEmailRequest,
} from '@wishlist/contracts';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { SignupService } from './signup.service.js';

@Controller('auth')
export class SignupController {
  constructor(@Inject(SignupService) private readonly service: SignupService) {}

  /** 202 whether or not the address already had an account (spec §5). */
  @Post('signup')
  @HttpCode(202)
  async signup(
    @Body(new ZodValidationPipe(SignupRequestSchema)) body: SignupRequest,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.service.signup(body, ip);
  }

  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailRequestSchema)) body: VerifyEmailRequest,
  ): Promise<void> {
    await this.service.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(202)
  async resendVerification(
    @Body(new ZodValidationPipe(ResendVerificationRequestSchema)) body: ResendVerificationRequest,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.service.resendVerification(body, ip);
  }
}
