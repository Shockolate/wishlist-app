import { Controller, Get, Header, Inject, Param, UseGuards } from '@nestjs/common';
import type { SharedWishlistResponse } from '@wishlist/contracts';
import { OptionalAuth, OptionalSessionGuard, type AuthContext } from '../auth/session.guard.js';
import { SharedListService } from './shared-list.service.js';

/** What anyone with a share link may do (spec §5 Public endpoints). */
@Controller('shared')
@UseGuards(OptionalSessionGuard)
export class SharedController {
  constructor(@Inject(SharedListService) private readonly lists: SharedListService) {}

  @Get(':shareToken')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('shareToken') shareToken: string,
    @OptionalAuth() auth: AuthContext | null,
  ): Promise<SharedWishlistResponse> {
    return this.lists.get(shareToken, auth?.user.id ?? null);
  }
}
