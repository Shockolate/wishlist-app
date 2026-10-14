import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ClaimsModule } from './claims/claims.module.js';
import { CoreModule } from './core/core.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { HttpSecurityModule } from './http/http-security.module.js';
import { OpsModule } from './ops/ops.module.js';
import { WishlistModule } from './wishlist/wishlist.module.js';

@Module({
  imports: [
    CoreModule,
    DatabaseModule,
    HttpSecurityModule,
    HealthModule,
    AuthModule,
    WishlistModule,
    ClaimsModule,
    OpsModule,
  ],
})
export class AppModule {}
