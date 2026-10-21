import {
  Body,
  Controller,
  Delete,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  CreateTagRequestSchema,
  RenameTagRequestSchema,
  type CreateTagRequest,
  type RenameTagRequest,
  type Tag,
} from '@wishlist/contracts';
import type { Response } from 'express';
import { CurrentAuth, SessionGuard, type AuthContext } from '../auth/session.guard.js';
import { VerifiedGuard } from '../auth/verified.guard.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { TagsService } from './tags.service.js';

/**
 * The tags on the owner's list (design §6). A tag or item ID that isn't on the session's own list
 * gets the same 404 as one that doesn't exist.
 */
@Controller('wishlist/tags')
@UseGuards(SessionGuard, VerifiedGuard)
export class TagsController {
  constructor(@Inject(TagsService) private readonly tags: TagsService) {}

  /** 201 for a new tag, 200 with the stored tag when the list already has that name (ruling 6). */
  @Post()
  @Header('Cache-Control', 'no-store')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateTagRequestSchema)) body: CreateTagRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Tag> {
    const { tag, created } = await this.tags.create(auth.user.id, body.name);
    res.status(created ? 201 : 200);
    return tag;
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  rename(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RenameTagRequestSchema)) body: RenameTagRequest,
  ): Promise<Tag> {
    return this.tags.rename(auth.user.id, id, body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async delete(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    await this.tags.delete(auth.user.id, id);
  }

  @Put(':id/items/:itemId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async tick(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<void> {
    await this.tags.tick(auth.user.id, id, itemId);
  }

  @Delete(':id/items/:itemId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async untick(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<void> {
    await this.tags.untick(auth.user.id, id, itemId);
  }
}
