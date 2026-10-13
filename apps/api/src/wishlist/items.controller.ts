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
  UseGuards,
} from '@nestjs/common';
import {
  CreateItemRequestSchema,
  ReorderItemsRequestSchema,
  UpdateItemRequestSchema,
  type CreateItemRequest,
  type Item,
  type ReorderItemsRequest,
  type UpdateItemRequest,
} from '@wishlist/contracts';
import { CurrentAuth, SessionGuard, type AuthContext } from '../auth/session.guard.js';
import { VerifiedGuard } from '../auth/verified.guard.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { ItemsService } from './items.service.js';

/**
 * The items on the owner's list (spec §5). An item ID that isn't on the session's own list gets
 * the same 404 as one that doesn't exist.
 */
@Controller('wishlist/items')
@UseGuards(SessionGuard, VerifiedGuard)
export class ItemsController {
  constructor(@Inject(ItemsService) private readonly items: ItemsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateItemRequestSchema)) body: CreateItemRequest,
  ): Promise<Item> {
    return this.items.create(auth.user.id, body);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateItemRequestSchema)) body: UpdateItemRequest,
  ): Promise<Item> {
    return this.items.update(auth.user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    await this.items.delete(auth.user.id, id);
  }

  @Put('order')
  @HttpCode(204)
  async reorder(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(ReorderItemsRequestSchema)) body: ReorderItemsRequest,
  ): Promise<void> {
    await this.items.reorder(auth.user.id, body.itemIds);
  }
}
