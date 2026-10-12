import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';
import { WishlistController } from './wishlist.controller.js';
import { WishlistService } from './wishlist.service.js';

/** The owner's list and its items (spec §5 Owner endpoints). */
@Module({
  imports: [AuthModule],
  controllers: [WishlistController, ItemsController],
  providers: [WishlistService, ItemsService],
})
export class WishlistModule {}
