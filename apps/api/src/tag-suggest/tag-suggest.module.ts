import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ENV, type Env } from '../core/env.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { TagSuggestController } from './tag-suggest.controller.js';
import { TagSuggestService } from './tag-suggest.service.js';
import {
  TAG_SUGGESTER,
  UNCONFIGURED_SUGGESTER,
  WorkersAiTagSuggester,
  type TagSuggester,
} from './tag-suggester.js';

/** Tag suggestions for the owner's item forms (design §5.2). */
@Module({
  imports: [AuthModule, RateLimitModule],
  controllers: [TagSuggestController],
  providers: [
    TagSuggestService,
    {
      provide: TAG_SUGGESTER,
      inject: [ENV],
      // Both values are set, or neither (env.ts). Unset means no suggestions, and no outside call.
      useFactory: (env: Env): TagSuggester => {
        const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_AI_TOKEN: token } = env;
        return accountId && token
          ? new WorkersAiTagSuggester(accountId, token)
          : UNCONFIGURED_SUGGESTER;
      },
    },
  ],
})
export class TagSuggestModule {}
