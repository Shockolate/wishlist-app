import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  UpdateWishlistRequestSchema,
  type RotateShareTokenResponse,
  type UpdateWishlistRequest,
  type WishlistResponse,
  type WishlistSettingsResponse,
} from '@wishlist/contracts';
import { CurrentAuth, SessionGuard, type AuthContext } from '../auth/session.guard.js';
import { VerifiedGuard } from '../auth/verified.guard.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { WishlistService } from './wishlist.service.js';

/** The owner's list (spec §5). The list always comes from the session; no route takes its ID. */
@Controller('wishlist')
@UseGuards(SessionGuard, VerifiedGuard)
export class WishlistController {
  constructor(@Inject(WishlistService) private readonly wishlist: WishlistService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentAuth() auth: AuthContext): Promise<WishlistResponse> {
    return this.wishlist.get(auth.user.id);
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  rename(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(UpdateWishlistRequestSchema)) body: UpdateWishlistRequest,
  ): Promise<WishlistSettingsResponse> {
    return this.wishlist.rename(auth.user.id, body.title);
  }

  @Post('share-token/rotate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  rotate(@CurrentAuth() auth: AuthContext): Promise<RotateShareTokenResponse> {
    return this.wishlist.rotateShareToken(auth.user.id);
  }
}
