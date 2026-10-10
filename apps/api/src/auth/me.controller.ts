import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { MeResponse } from '@wishlist/contracts';
import { CurrentAuth, SessionGuard, type AuthContext } from './session.guard.js';

/** The signed-in user. Unverified users may use it too (spec §5). */
@Controller('me')
@UseGuards(SessionGuard)
export class MeController {
  @Get()
  @Header('Cache-Control', 'no-store')
  get(@CurrentAuth() auth: AuthContext): MeResponse {
    return auth.user;
  }
}
