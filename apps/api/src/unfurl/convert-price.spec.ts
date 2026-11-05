import { describe, expect, it } from 'vitest';
import { convertToUsd } from './convert-price.js';

describe('convertToUsd (price conversion design §5.4)', () => {
  it('divides by the rate and rounds to cents', () => {
    expect(convertToUsd({ amount: '45000.00', currency: 'TRY' }, 50.025)).toBe('$899.55');
    expect(convertToUsd({ amount: '12000', currency: 'JPY' }, 153.2)).toBe('$78.33');
  });

  it('formats thousands with a separator', () => {
    expect(convertToUsd({ amount: '2500', currency: 'EUR' }, 0.5)).toBe('$5,000.00');
  });

  it('gives null when the result rounds to zero', () => {
    expect(convertToUsd({ amount: '0.001', currency: 'EUR' }, 0.9)).toBeNull();
    expect(convertToUsd({ amount: '0', currency: 'EUR' }, 0.9)).toBeNull();
  });

  it('gives null when the result is not a finite number above zero', () => {
    expect(convertToUsd({ amount: '1', currency: 'EUR' }, Infinity)).toBeNull();
    expect(convertToUsd({ amount: '1', currency: 'EUR' }, 0)).toBeNull();
    expect(convertToUsd({ amount: '1', currency: 'EUR' }, -2)).toBeNull();
    expect(convertToUsd({ amount: '1', currency: 'EUR' }, Number.NaN)).toBeNull();
  });

  it('gives null when the text is longer than the 50 character price cap', () => {
    const huge = '9'.repeat(60);
    expect(convertToUsd({ amount: huge, currency: 'EUR' }, 1)).toBeNull();
  });
});
