import {
  Controller,
  Delete,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { ClaimLinkResponse } from '@wishlist/contracts';
import { CurrentAuth, SessionGuard, type AuthContext } from '../auth/session.guard.js';
import { VerifiedGuard } from '../auth/verified.guard.js';
import { ClientIp } from '../http/client-ip.js';
import { ClaimsService } from './claims.service.js';

/**
 * Putting a claim on Your gifts, and taking it off, through the claim's manage link (D77). A
 * separate controller from `ClaimsController`, which resolves the session optionally for every
 * route: these need a verified session, and stacking the two guards would resolve it twice.
 */
@Controller('claims/:manageToken/link')
@UseGuards(SessionGuard, VerifiedGuard)
export class ClaimLinksController {
  constructor(@Inject(ClaimsService) private readonly claims: ClaimsService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  link(
    @Param('manageToken') manageToken: string,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ): Promise<ClaimLinkResponse> {
    return this.claims.link(manageToken, auth.user, ip);
  }

  @Delete()
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async unlink(
    @Param('manageToken') manageToken: string,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.claims.unlink(manageToken, auth.user, ip);
  }
}
