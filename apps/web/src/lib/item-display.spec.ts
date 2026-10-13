import { describe, expect, it } from 'vitest';
import { shopName } from './item-display';

describe('shopName', () => {
  it('names the shop by its host, without www.', () => {
    expect(shopName('https://www.hearthware.example/products/kettle?ref=1')).toBe(
      'hearthware.example',
    );
    expect(shopName('http://trailpost.example/socks')).toBe('trailpost.example');
  });

  it('has nothing to say for an idea or a link it can’t read', () => {
    expect(shopName(null)).toBeNull();
    expect(shopName('not a link')).toBeNull();
  });
});
