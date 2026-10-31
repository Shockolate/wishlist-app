import { describe, expect, it } from 'vitest';
import {
  amazonProductOf,
  amazonProductUrl,
  ebayItemOf,
  etsyListingOf,
  isAmazonShortLink,
  isEtsyShortLink,
  retailerOf,
} from './retailers.js';

// Ted's links from the retailer-lookups spike (design §3).
const SPIKE_LINKS = [
  [
    'https://www.amazon.com/Cephalofair-Games-115005-Frosthaven-Surface/dp/B0D169YKJW/ref=sr_1_8?crid=14E9PM8D76PPR&keywords=frosthaven&sr=8-8',
    'B0D169YKJW',
  ],
  ['https://www.amazon.com/BGExpansions-Pack-Complet-Pour-Frosthaven/dp/B0CB96ZFL8', 'B0CB96ZFL8'],
  ['https://www.amazon.com/dp/B0CJV2TK6N?ref=ppx_yo2ov_dt_b_fed_asin_title', 'B0CJV2TK6N'],
  [
    'https://www.amazon.com/Cephalofair-Games-Frosthaven-Board-Game-dp-B08FK7B2SC/dp/B08FK7B2SC/ref=dp_ob_title_toy',
    'B08FK7B2SC',
  ],
] as const;

describe('amazonProductOf', () => {
  it.each(SPIKE_LINKS)('finds the ASIN in %s', (link, asin) => {
    expect(amazonProductOf(link)).toEqual({ asin });
    expect(retailerOf(link)).toBe('amazon');
  });

  it('reads /gp/product/ and a language prefix, and uppercases the ASIN', () => {
    expect(amazonProductOf('https://amazon.com/gp/product/b08fk7b2sc')).toEqual({
      asin: 'B08FK7B2SC',
    });
    expect(amazonProductOf('https://www.amazon.com/-/es/dp/B08FK7B2SC')).toEqual({
      asin: 'B08FK7B2SC',
    });
  });

  it.each([
    'https://amazon.com.evil.test/dp/B08FK7B2SC',
    'https://example.com/dp/B08FK7B2SC',
    'https://www.amazon.co.uk/dp/B08FK7B2SC',
  ])('is not fooled by a lookalike: %s (Review Focus 1)', (link) => {
    expect(amazonProductOf(link)).toBeNull();
    expect(retailerOf(link)).toBeNull();
  });

  it.each([
    'https://www.amazon.com/s?k=frosthaven',
    'https://www.amazon.com/dp/SHORT',
    'not a url',
  ])('finds no product in %s', (link) => {
    expect(amazonProductOf(link)).toBeNull();
  });

  it('accepts anything carrying an href, such as a URL', () => {
    expect(amazonProductOf({ href: 'https://www.amazon.com/dp/B0CB96ZFL8' })).toEqual({
      asin: 'B0CB96ZFL8',
    });
  });
});

describe('isAmazonShortLink', () => {
  it.each(['https://amzn.to/3xYz', 'https://a.co/d/abc'])('knows %s', (link) => {
    expect(isAmazonShortLink(link)).toBe(true);
    expect(retailerOf(link)).toBe('amazon');
  });

  it('is not fooled by a lookalike host', () => {
    expect(isAmazonShortLink('http://amzn.to.evil.test/x')).toBe(false);
    expect(retailerOf('http://amzn.to.evil.test/x')).toBeNull();
  });
});

describe('retailerOf', () => {
  it('is null for an Amazon page that is not a product', () => {
    expect(retailerOf('https://www.amazon.com/s?k=frosthaven')).toBeNull();
  });
});

describe('amazonProductUrl', () => {
  it('is the canonical product URL, with nothing of the pasted link', () => {
    expect(amazonProductUrl('B08FK7B2SC')).toBe('https://www.amazon.com/dp/B08FK7B2SC');
  });
});

describe('etsyListingOf (retailer lookups §5.1)', () => {
  it.each([
    ['https://www.etsy.com/listing/1234567890/hand-thrown-mug?ref=hp_rv', '1234567890'],
    ['https://etsy.com/listing/1234567890', '1234567890'],
    ['https://www.etsy.com/uk/listing/1234567890/hand-thrown-mug', '1234567890'],
    ['https://www.etsy.com/en-gb/listing/987654321', '987654321'],
    ['https://WWW.ETSY.COM/listing/1234567890', '1234567890'],
  ])('reads the listing ID of %s (Review Focus 2)', (url, listingId) => {
    expect(etsyListingOf(url)).toEqual({ listingId });
  });

  it.each([
    'https://etsy.com.evil.test/listing/1234567890',
    'https://example.com/listing/1234567890',
    'https://www.etsy.com/shop/Maker',
    'https://www.etsy.com/search?q=listing/1234567890',
    'https://www.etsy.com/shop/Maker/listing/1234567890',
    'https://www.etsy.com/listing/0123456789',
    'https://www.etsy.com/listing/1234567890123456789', // 19 digits
    'https://m.etsy.com/listing/1234567890',
    'not a url',
  ])('is not an Etsy listing: %s (Review Focus 1)', (url) => {
    expect(etsyListingOf(url)).toBeNull();
  });

  it('knows etsy.me short links', () => {
    expect(isEtsyShortLink('https://etsy.me/3AbCdEf')).toBe(true);
    expect(isEtsyShortLink('https://etsy.me.evil.test/3AbCdEf')).toBe(false);
  });

  it('routes Etsy listings and short links to etsy, and leaves Amazon alone', () => {
    expect(retailerOf('https://www.etsy.com/listing/1234567890')).toBe('etsy');
    expect(retailerOf('https://etsy.me/3AbCdEf')).toBe('etsy');
    expect(retailerOf('https://www.etsy.com/shop/Maker')).toBeNull();
    expect(retailerOf('https://www.amazon.com/dp/B08FK7B2SC')).toBe('amazon');
  });
});

describe('ebayItemOf (eBay lookups §5.1)', () => {
  it.each([
    ['https://www.ebay.com/itm/366025273219', '366025273219'],
    [
      'https://ebay.com/itm/366025273219?_skw=steam+deck&hash=item34b9597609%3Ag%3AuOMAAOSwLjtninPj',
      '366025273219',
    ],
    ['https://www.ebay.com/itm/Valve-Steam-Deck-OLED/960110182451?mkcid=1', '960110182451'],
    ['https://WWW.EBAY.COM/itm/366025273219', '366025273219'],
  ])('reads the item number of %s (Review Focus 2)', (url, itemId) => {
    expect(ebayItemOf(url)).toEqual({ itemId });
  });

  it('reads the option number from ?var=', () => {
    expect(
      ebayItemOf('https://www.ebay.com/itm/226447947273?var=525635725002&itmmeta=01M69CBD2C7T'),
    ).toEqual({ itemId: '226447947273', variationId: '525635725002' });
  });

  it.each([
    'https://www.ebay.com/itm/226447947273?var=abc',
    'https://www.ebay.com/itm/226447947273?var=12345', // 5 digits
    'https://www.ebay.com/itm/226447947273?var=0123456',
    'https://www.ebay.com/itm/226447947273?var=525635725002&var=525635725003',
    'https://www.ebay.com/itm/226447947273?var=',
  ])('ignores a ?var= that is not exactly one option number, keeping the item: %s', (url) => {
    expect(ebayItemOf(url)).toEqual({ itemId: '226447947273' });
  });

  it.each([
    'https://ebay.com.evil.test/itm/366025273219',
    'https://www.ebay.co.uk/itm/366025273219',
    'https://www.ebay.com/sch/i.html?_nkw=itm/366025273219',
    'https://www.ebay.com/itm/0366025273219',
    'https://www.ebay.com/itm/3660252732190123', // 16 digits
    'https://www.ebay.com/itm/12345678', // 8 digits
    'https://www.ebay.com/usr/seller/itm/366025273219',
    'https://m.ebay.com/itm/366025273219',
    'https://ebay.us/abc123',
    'not a url',
  ])('is not an eBay item: %s (Review Focus 1)', (url) => {
    expect(ebayItemOf(url)).toBeNull();
    expect(retailerOf(url)).toBeNull();
  });

  it('routes eBay items to ebay, and leaves the other shops alone', () => {
    expect(retailerOf('https://www.ebay.com/itm/366025273219')).toBe('ebay');
    expect(retailerOf('https://www.etsy.com/listing/1234567890')).toBe('etsy');
    expect(retailerOf('https://www.amazon.com/dp/B08FK7B2SC')).toBe('amazon');
  });
});
