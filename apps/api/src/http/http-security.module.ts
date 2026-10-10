import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard.js';

/** Request-level protections that apply to every route. */
@Module({ providers: [{ provide: APP_GUARD, useClass: CsrfGuard }] })
export class HttpSecurityModule {}
