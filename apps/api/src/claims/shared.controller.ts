import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  CreateClaimRequestSchema,
  type CreateClaimRequest,
  type CreateClaimResponse,
  type SharedWishlistResponse,
  type SharePreviewResponse,
} from '@wishlist/contracts';
import { OptionalAuth, OptionalSessionGuard, type AuthContext } from '../auth/session.guard.js';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { ClaimsService } from './claims.service.js';
import { SharePreviewService } from './share-preview.service.js';
import { SharedListService } from './shared-list.service.js';

/** What anyone with a share link may do (spec §5 Public endpoints). */
@Controller('shared')
@UseGuards(OptionalSessionGuard)
export class SharedController {
  constructor(
    @Inject(SharedListService) private readonly lists: SharedListService,
    @Inject(ClaimsService) private readonly claims: ClaimsService,
    @Inject(SharePreviewService) private readonly previews: SharePreviewService,
  ) {}

  @Get(':shareToken')
  @Header('Cache-Control', 'no-store')
  get(
    @Param('shareToken') shareToken: string,
    @OptionalAuth() auth: AuthContext | null,
  ): Promise<SharedWishlistResponse> {
    return this.lists.get(shareToken, auth?.user ?? null);
  }

  /** What the link preview image is drawn from (Plan 12). The same for every viewer. */
  @Get(':shareToken/preview')
  @Header('Cache-Control', 'no-store')
  preview(@Param('shareToken') shareToken: string): Promise<SharePreviewResponse> {
    return this.previews.preview(shareToken);
  }

  /** One item's photo for the preview image, fetched by the API (Plan 12, design §5.1). */
  @Get(':shareToken/photos/:itemId')
  @Header('Cache-Control', 'no-store')
  // The bytes come from a shop; the type is the one we checked (design §5.1), never a browser's guess.
  @Header('X-Content-Type-Options', 'nosniff')
  async photo(
    @Param('shareToken') shareToken: string,
    @Param('itemId') itemId: string,
  ): Promise<StreamableFile> {
    const { bytes, contentType } = await this.previews.photo(shareToken, itemId);
    return new StreamableFile(bytes, { type: contentType });
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
    return this.claims.create(shareToken, itemId, body, auth?.user ?? null, ip);
  }
}
