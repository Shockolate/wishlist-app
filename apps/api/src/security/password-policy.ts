import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@wishlist/contracts';
import { AppError } from '../http/app-error.js';
import { BREACHED_PASSWORD_CHECKER, type BreachedPasswordChecker } from './breached-passwords.js';

export const passwordBreached = (): AppError =>
  new AppError(
    400,
    ErrorCode.PASSWORD_BREACHED,
    'This password has appeared in a data breach. Choose a different one.',
  );

/** Spec §6.4: checked on signup, reset and change. The contract schemas enforce length. */
@Injectable()
export class PasswordPolicy {
  constructor(
    @Inject(BREACHED_PASSWORD_CHECKER) private readonly breaches: BreachedPasswordChecker,
  ) {}

  async assertNotBreached(password: string): Promise<void> {
    if (await this.breaches.isBreached(password)) throw passwordBreached();
  }
}
