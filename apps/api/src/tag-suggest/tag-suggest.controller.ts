import { Body, Controller, Header, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  TagSuggestionsRequestSchema,
  type TagSuggestionsRequest,
  type TagSuggestionsResponse,
} from '@wishlist/contracts';
import { CurrentAuth, SessionGuard, type AuthContext } from '../auth/session.guard.js';
import { VerifiedGuard } from '../auth/verified.guard.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { TagSuggestService } from './tag-suggest.service.js';

/** Under `/wishlist` like the rest of the owner's list: the list comes from the session. */
@Controller('wishlist')
@UseGuards(SessionGuard, VerifiedGuard)
export class TagSuggestController {
  constructor(@Inject(TagSuggestService) private readonly suggestions: TagSuggestService) {}

  /** Optional help: always 200, with `[]` for every failure (design §5.2). */
  @Post('tag-suggestions')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  suggest(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(TagSuggestionsRequestSchema)) body: TagSuggestionsRequest,
  ): Promise<TagSuggestionsResponse> {
    return this.suggestions.suggest(auth.user.id, body);
  }
}
