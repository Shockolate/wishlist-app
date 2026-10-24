import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  UpdateGiftRequestSchema,
  type Gift,
  type GiftsResponse,
  type UpdateGiftRequest,
} from '@wishlist/contracts';
import { CurrentAuth, SessionGuard, type AuthContext } from '../auth/session.guard.js';
import { VerifiedGuard } from '../auth/verified.guard.js';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { GiftsService } from './gifts.service.js';

/**
 * Your gifts (design §5.9): a verified gifter's claims across lists. The session is the
 * authorization, and a link ID that isn't the session's is as unknown as any other. Never cached:
 * it carries claimer names and the private Bought tick.
 */
@Controller('me/gifts')
@UseGuards(SessionGuard, VerifiedGuard)
export class GiftsController {
  constructor(@Inject(GiftsService) private readonly gifts: GiftsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentAuth() auth: AuthContext): Promise<GiftsResponse> {
    return this.gifts.list(auth.user);
  }

  @Patch(':linkId')
  @Header('Cache-Control', 'no-store')
  change(
    @Param('linkId') linkId: string,
    @Body(new ZodValidationPipe(UpdateGiftRequestSchema)) body: UpdateGiftRequest,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ): Promise<Gift> {
    return this.gifts.change(auth.user, linkId, body, ip);
  }

  @Delete(':linkId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async remove(
    @Param('linkId') linkId: string,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.gifts.remove(auth.user, linkId, ip);
  }
}
