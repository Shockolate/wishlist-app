import { Global, Module } from '@nestjs/common';
import { ENV, parseEnv, type Env } from './env.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => parseEnv(process.env) }],
  exports: [ENV],
})
export class CoreModule {}
