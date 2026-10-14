import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
} from '@nestjs/common';
import {
  UpdateClaimRequestSchema,
  type Claim,
  type ClaimDetailsResponse,
  type UpdateClaimRequest,
} from '@wishlist/contracts';
import { ClientIp } from '../http/client-ip.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { ClaimsService } from './claims.service.js';

/** One claim, through its private manage link (spec §5). The token is the only authorization. */
@Controller('claims')
export class ClaimsController {
  constructor(@Inject(ClaimsService) private readonly claims: ClaimsService) {}

  @Get(':manageToken')
  @Header('Cache-Control', 'no-store')
  details(@Param('manageToken') manageToken: string): Promise<ClaimDetailsResponse> {
    return this.claims.details(manageToken);
  }

  @Patch(':manageToken')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('manageToken') manageToken: string,
    @Body(new ZodValidationPipe(UpdateClaimRequestSchema)) body: UpdateClaimRequest,
    @ClientIp() ip: string,
  ): Promise<Claim> {
    return this.claims.update(manageToken, body, ip);
  }

  @Delete(':manageToken')
  @HttpCode(204)
  async cancel(@Param('manageToken') manageToken: string): Promise<void> {
    await this.claims.cancel(manageToken);
  }
}
