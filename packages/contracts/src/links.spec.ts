import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cleanLink } from './links.js';

describe('cleanLink (D118)', () => {
  it.each([
    ['https://shop.example/kettle?utm_source=ig&utm_medium=social', 'https://shop.example/kettle'],
    ['https://shop.example/kettle?color=blue&fbclid=abc', 'https://shop.example/kettle?color=blue'],
    ['https://shop.example/kettle?UTM_Campaign=x&size=m', 'https://shop.example/kettle?size=m'],
    ['https://youtu.be/abc?si=xyz&t=30', 'https://youtu.be/abc?t=30'],
  ])('removes global tracking from %s', (input, expected) => {
    expect(cleanLink(input)).toBe(expected);
  });

  it('keeps si where it is not a known share ID', () => {
    expect(cleanLink('https://shop.example/x?si=2')).toBe('https://shop.example/x?si=2');
  });

  it('cleans an Amazon product link, keeping the variant and seller', () => {
    expect(
      cleanLink(
        'https://www.amazon.com/Stagg-Kettle/dp/B08FK7B2SC/ref=sr_1_3?crid=2X&keywords=kettle&qid=17&sr=8-3&th=1&psc=1&smid=A1&tag=someone-20&pd_rd_w=Q&pf_rd_p=Z',
      ),
    ).toBe('https://www.amazon.com/Stagg-Kettle/dp/B08FK7B2SC?th=1&psc=1&smid=A1');
  });

  it('cleans an eBay item link, keeping var and hash', () => {
    expect(
      cleanLink(
        'https://www.ebay.com/itm/226447947273?var=525779043744&hash=item34b8&_trksid=p1&mkevt=1',
      ),
    ).toBe('https://www.ebay.com/itm/226447947273?var=525779043744&hash=item34b8');
  });

  it('cleans an Etsy listing link, keeping the variation', () => {
    expect(
      cleanLink(
        'https://www.etsy.com/listing/123/mug?ref=hp&click_key=a&ga_order=most&variation0=55',
      ),
    ).toBe('https://www.etsy.com/listing/123/mug?variation0=55');
  });

  it('keeps a Shopify variant', () => {
    expect(cleanLink('https://shop.example/products/mug?variant=4411&utm_source=x')).toBe(
      'https://shop.example/products/mug?variant=4411',
    );
  });

  it.each([
    'https://notamazon.com/dp/B08FK7B2SC/ref=x?tag=a-20',
    'https://amazon.com.evil.test/dp/B08FK7B2SC/ref=x?tag=a-20',
    'https://www.amazon.co.uk/dp/B08FK7B2SC/ref=x?tag=a-20',
    'https://shop.example/x?ref=friend',
  ])('applies Amazon’s rules only to Amazon’s hosts: %s (Review Focus 3)', (url) => {
    expect(cleanLink(url)).toBe(url);
  });

  it('keeps the kept parameters byte for byte (Review Focus 1)', () => {
    expect(cleanLink('https://shop.example/x?q=a%20b+c&utm_source=x&n=%E2%9C%93')).toBe(
      'https://shop.example/x?q=a%20b+c&n=%E2%9C%93',
    );
  });

  it('never touches the fragment (Review Focus 2)', () => {
    expect(cleanLink('https://shop.example/#/p?utm_source=x')).toBe(
      'https://shop.example/#/p?utm_source=x',
    );
    expect(cleanLink('https://shop.example/p?utm_source=x#reviews')).toBe(
      'https://shop.example/p#reviews',
    );
  });

  it('keeps segments it can’t read, and never throws (Review Focus 5)', () => {
    expect(cleanLink('https://shop.example/x?a=1&&gift&%zz=1&a=2&utm_id=9')).toBe(
      'https://shop.example/x?a=1&&gift&%zz=1&a=2',
    );
  });

  it.each([
    'HTTPS://Shop.example/K',
    'http://shop.example',
    'https://a.co/d/xyz',
    'not a url',
    'ftp://files.example/x?utm_source=a',
    'https://shop.example/x?',
  ])('returns %j unchanged when there is nothing to remove', (url) => {
    expect(cleanLink(url)).toBe(url);
  });
});

/** Parameters on no list for any host, so cleaning must never remove them. */
const UNLISTED = ['color', 'size', 'variant', 'var', 'th', 'psc', 'smid', 'hash', 'variation0'];
const LISTED = ['utm_source', 'fbclid', 'gclid', 'tag', 'ref', '_trksid', 'click_key', 'pd_rd_w'];
const value = fc.stringMatching(/^[a-zA-Z0-9%+._-]{0,8}$/);
const pair = (names: string[]) =>
  fc.tuple(fc.constantFrom(...names), value).map(([name, v]) => `${name}=${v}`);
const extraQuery = fc.array(fc.oneof(pair(UNLISTED), pair(LISTED)), { maxLength: 6 });
const link = fc
  .tuple(
    fc.oneof(
      fc.webUrl({ withQueryParameters: true, withFragments: false }),
      fc.constantFrom(
        'https://www.amazon.com/x/dp/B08FK7B2SC/ref=sr_1',
        'https://www.etsy.com/listing/1',
        'https://www.ebay.com/itm/226447947273',
      ),
    ),
    extraQuery,
    fc.option(fc.webFragments(), { nil: undefined }),
  )
  .map(([base, extra, fragment]) => {
    const query = extra.join('&');
    const joined = query ? `${base}${base.includes('?') ? '&' : '?'}${query}` : base;
    return fragment === undefined ? joined : `${joined}#${fragment}`;
  });

const fragmentOf = (url: string) => (url.includes('#') ? url.slice(url.indexOf('#')) : '');
const beforeQuery = (url: string) => url.split('#')[0]!.split('?')[0]!;
const queryNames = (url: string) =>
  (url.split('#')[0]!.split('?')[1] ?? '')
    .split('&')
    .map((segment) => segment.split('=')[0]!)
    .filter((name) => UNLISTED.includes(name));

describe('cleanLink properties (D118)', () => {
  it('cleaning twice is cleaning once', () => {
    fc.assert(
      fc.property(link, (url) => {
        expect(cleanLink(cleanLink(url))).toBe(cleanLink(url));
      }),
    );
  });

  it('never changes the fragment, or the path apart from Amazon’s /ref=', () => {
    fc.assert(
      fc.property(link, (url) => {
        const cleaned = cleanLink(url);
        expect(fragmentOf(cleaned)).toBe(fragmentOf(url));
        expect(beforeQuery(cleaned)).toBe(
          beforeQuery(url).replace(/^(https:\/\/www\.amazon\.com\/.*)\/ref=[^/?#]*/, '$1'),
        );
      }),
    );
  });

  it('never removes a parameter that isn’t on a list', () => {
    fc.assert(
      fc.property(link, (url) => {
        expect(queryNames(cleanLink(url))).toEqual(queryNames(url));
      }),
    );
  });

  it('never throws on any string', () => {
    fc.assert(fc.property(fc.string(), (text) => void cleanLink(text)));
  });
});
