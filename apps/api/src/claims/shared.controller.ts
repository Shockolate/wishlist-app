import { Body, Controller, Get, Header, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  CreateClaimRequestSchema,
  type CreateClaimRequest,
  type CreateClaimResponse,
  type SharedWishlistResponse,
} from '@wishlist/contracts';
import { OptionalAuth, OptionalSessionGuard, type AuthContext } from '../auth/session.guard.js';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { ClaimsService } from './claims.service.js';
import { SharedListService } from './shared-list.service.js';

/** What anyone with a share link may do (spec §5 Public endpoints). */
@Controller('shared')
@UseGuards(OptionalSessionGuard)
export class SharedController {
  constructor(
    @Inject(SharedListService) private readonly lists: SharedListService,
    @Inject(ClaimsService) private readonly claims: ClaimsService,
  ) {}

  @Get(':shareToken')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('shareToken') shareToken: string,
    @OptionalAuth() auth: AuthContext | null,
  ): Promise<SharedWishlistResponse> {
    return this.lists.get(shareToken, auth?.user.id ?? null);
  }

  @Post(':shareToken/items/:itemId/claims')
  @Header('Cache-Control', 'no-store')
  create(
    @Param('shareToken') shareToken: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(CreateClaimRequestSchema)) body: CreateClaimRequest,
    @OptionalAuth() auth: AuthContext | null,
    @ClientIp() ip: string,
  ): Promise<CreateClaimResponse> {
    return this.claims.create(shareToken, itemId, body, auth?.user.id ?? null, ip);
  }
}
