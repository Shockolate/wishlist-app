import { Global, Module } from '@nestjs/common';
import { CLOCK, systemClock } from './clock.js';
import { ENV, parseEnv, type Env } from './env.js';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => parseEnv(process.env) },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [ENV, CLOCK],
})
export class CoreModule {}
