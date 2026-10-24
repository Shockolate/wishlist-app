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
  UpdateClaimRequestSchema,
  type Claim,
  type ClaimDetailsResponse,
  type UpdateClaimRequest,
} from '@wishlist/contracts';
import { OptionalAuth, OptionalSessionGuard, type AuthContext } from '../auth/session.guard.js';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { ClaimsService } from './claims.service.js';

/**
 * One claim, through its private manage link (spec §5). The token is the only authorization. A
 * session is read only to refuse the list's own owner (D82); it never grants anything.
 */
@Controller('claims')
@UseGuards(OptionalSessionGuard)
export class ClaimsController {
  constructor(@Inject(ClaimsService) private readonly claims: ClaimsService) {}

  @Get(':manageToken')
  @Header('Cache-Control', 'no-store')
  details(
    @Param('manageToken') manageToken: string,
    @OptionalAuth() auth: AuthContext | null,
  ): Promise<ClaimDetailsResponse> {
    return this.claims.details(manageToken, auth?.user.id ?? null);
  }

  @Patch(':manageToken')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('manageToken') manageToken: string,
    @Body(new ZodValidationPipe(UpdateClaimRequestSchema)) body: UpdateClaimRequest,
    @OptionalAuth() auth: AuthContext | null,
    @ClientIp() ip: string,
  ): Promise<Claim> {
    return this.claims.update(manageToken, body, ip, auth?.user.id ?? null);
  }

  @Delete(':manageToken')
  @Header('Cache-Control', 'no-store')
  @HttpCode(204)
  async cancel(
    @Param('manageToken') manageToken: string,
    @OptionalAuth() auth: AuthContext | null,
  ): Promise<void> {
    await this.claims.cancel(manageToken, auth?.user.id ?? null);
  }
}
