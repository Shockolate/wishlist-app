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
  UnfurlRequestSchema,
  UpdateWishlistRequestSchema,
  type RotateShareTokenResponse,
  type UnfurlRequest,
  type UnfurlResponse,
  type UpdateWishlistRequest,
  type WishlistResponse,
  type WishlistSettingsResponse,
} from '@wishlist/contracts';
import { CurrentAuth, SessionGuard, type AuthContext } from '../auth/session.guard.js';
import { VerifiedGuard } from '../auth/verified.guard.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { UnfurlService } from './unfurl.service.js';
import { WishlistService } from './wishlist.service.js';

/** The owner's list (spec §5). The list always comes from the session; no route takes its ID. */
@Controller('wishlist')
@UseGuards(SessionGuard, VerifiedGuard)
export class WishlistController {
  constructor(
    @Inject(WishlistService) private readonly wishlist: WishlistService,
    @Inject(UnfurlService) private readonly unfurls: UnfurlService,
  ) {}

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

  /** A prefill only: always 200, and a failure carries its reason (spec §5, §9). */
  @Post('unfurl')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  unfurl(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(UnfurlRequestSchema)) body: UnfurlRequest,
  ): Promise<UnfurlResponse> {
    return this.unfurls.unfurl(auth.user.id, body.url);
  }
}
