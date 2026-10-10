import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ChangePasswordRequestSchema,
  DeleteMeRequestSchema,
  UpdateMeRequestSchema,
  type ChangePasswordRequest,
  type DeleteMeRequest,
  type MeResponse,
  type UpdateMeRequest,
} from '@wishlist/contracts';
import type { Response } from 'express';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { AccountService } from './account.service.js';
import { clearSessionCookie } from './session-cookie.js';
import { CurrentAuth, SessionGuard, type AuthContext } from './session.guard.js';

/** The signed-in user. Unverified users may use all of it (spec §5). */
@Controller('me')
@UseGuards(SessionGuard)
export class MeController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentAuth() auth: AuthContext): MeResponse {
    return auth.user;
  }

  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(UpdateMeRequestSchema)) body: UpdateMeRequest,
  ): Promise<MeResponse> {
    return this.account.updateDisplayName(auth, body.displayName);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(ChangePasswordRequestSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.account.changePassword(auth, body);
  }

  @Delete()
  @HttpCode(204)
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(DeleteMeRequestSchema)) body: DeleteMeRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.account.deleteAccount(auth, body.password);
    clearSessionCookie(res);
  }
}
