import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import {
  PasswordResetConfirmRequestSchema,
  PasswordResetRequestSchema,
  type PasswordResetConfirmRequest,
  type PasswordResetRequest,
} from '@wishlist/contracts';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { PasswordResetService } from './password-reset.service.js';

@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(@Inject(PasswordResetService) private readonly resets: PasswordResetService) {}

  @Post('request')
  @HttpCode(202)
  async request(
    @Body(new ZodValidationPipe(PasswordResetRequestSchema)) body: PasswordResetRequest,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.resets.request(body, ip);
  }

  @Post('confirm')
  @HttpCode(204)
  async confirm(
    @Body(new ZodValidationPipe(PasswordResetConfirmRequestSchema))
    body: PasswordResetConfirmRequest,
  ): Promise<void> {
    await this.resets.confirm(body);
  }
}
