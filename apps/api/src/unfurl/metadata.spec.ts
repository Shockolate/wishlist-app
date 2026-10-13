import { describe, expect, it } from 'vitest';
import { extractMetadata, formatPrice } from './metadata.js';

const SHOP = new URL('https://shop.example/products/kettle');

/** A Shopify-style page: Open Graph and product tags, plus JSON-LD that says something else. */
const OPEN_GRAPH = `<!doctype html><html><head>
<meta property="og:title" content="Stovetop Kettle &amp; Lid">
<meta property="og:image" content="https://cdn.shop.example/kettle.jpg">
<meta property="product:price:amount" content="40.00">
<meta property="product:price:currency" content="USD">
<script type="application/ld+json">{"@type":"Product","name":"Not this name","offers":{"price":"99","priceCurrency":"USD"}}</script>
<title>Kettle – Shop</title></head><body></body></html>`;

/** A WooCommerce-style page: no Open Graph, a broken block, then a Product inside @graph. */
const JSON_LD_GRAPH = `<html><head>
<script type="application/ld+json">{ this is not json </script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"BreadcrumbList","itemListElement":[]},
  {"@type":["Product","Thing"],"name":"Linen Throw &amp; Pillow",
   "image":[{"@type":"ImageObject","url":"https://cdn.shop.example/throw.jpg"}],
   "offers":[{"@type":"AggregateOffer","lowPrice":19,"priceCurrency":"EUR"}]}
]}</script>
<title>Not used when JSON-LD has a name</title></head></html>`;

const TITLE_ONLY = `<html><head><title>
   Tea   &amp;
   Cake  </title></head><body></body></html>`;

const image = (src: string, page = SHOP) =>
  extractMetadata(`<meta property="og:image" content="${src}">`, page).imageUrl;

describe('extractMetadata (spec §6.8, Plan 3a rule 11)', () => {
  it('reads Open Graph first, ahead of JSON-LD and <title>', () => {
    expect(extractMetadata(OPEN_GRAPH, SHOP)).toEqual({
      title: 'Stovetop Kettle & Lid',
      imageUrl: 'https://cdn.shop.example/kettle.jpg',
      priceText: '$40.00',
    });
  });

  it('finds a Product inside @graph, past a broken block, with its image and lowest offer', () => {
    expect(extractMetadata(JSON_LD_GRAPH, SHOP)).toEqual({
      title: 'Linen Throw & Pillow',
      imageUrl: 'https://cdn.shop.example/throw.jpg',
      priceText: '€19.00',
    });
  });

  it('accepts a schema.org URL as the type', () => {
    const html = `<script type="application/ld+json">{"@type":"http://schema.org/Product","name":"Mug"}</script>`;
    expect(extractMetadata(html, SHOP)).toEqual({ title: 'Mug' });
  });

  it('falls back to <title>, decoded and with its whitespace collapsed', () => {
    expect(extractMetadata(TITLE_ONLY, SHOP)).toEqual({ title: 'Tea & Cake' });
  });

  it('ignores an icon title inside <svg>', () => {
    const html = '<html><body><svg><title>Logo</title></svg><h1>Hi</h1></body></html>';
    expect(extractMetadata(html, SHOP)).toEqual({});
  });

  it('returns nothing for a page with nothing to say', () => {
    expect(extractMetadata('<p>Hello</p>', SHOP)).toEqual({});
  });

  it('cuts a long title to 200 characters without splitting an emoji', () => {
    const title = `${'a'.repeat(199)}😀b`;
    expect(extractMetadata(`<title>${title}</title>`, SHOP).title).toBe('a'.repeat(199));
  });
});

describe('images (Plan 3a Review Focus 4)', () => {
  it.each([
    ['/img/kettle.jpg', 'https://shop.example/img/kettle.jpg'],
    ['//cdn.example/kettle.jpg', 'https://cdn.example/kettle.jpg'],
    ['http://cdn.example/kettle.jpg', undefined],
    ['data:image/png;base64,AAAA', undefined],
    ['', undefined],
  ])('turns %j into %j', (src, expected) => {
    expect(image(src)).toBe(expected);
  });

  it('cannot make an https image from a protocol-relative URL on an http page', () => {
    expect(image('//cdn.example/kettle.jpg', new URL('http://shop.example/'))).toBeUndefined();
  });

  it('prefers og:image:secure_url, and falls through an http og:image to JSON-LD', () => {
    const secure = `<meta property="og:image" content="https://cdn.example/a.jpg"><meta property="og:image:secure_url" content="https://cdn.example/b.jpg">`;
    expect(extractMetadata(secure, SHOP).imageUrl).toBe('https://cdn.example/b.jpg');
    const fallThrough = `<meta property="og:image" content="http://cdn.example/a.jpg">
<script type="application/ld+json">{"@type":"Product","name":"K","image":"https://cdn.example/c.jpg"}</script>`;
    expect(extractMetadata(fallThrough, SHOP).imageUrl).toBe('https://cdn.example/c.jpg');
  });
});

describe('formatPrice (spec §2: prices are display strings)', () => {
  it.each([
    ['24.99', 'USD', '$24.99'],
    [1299, 'USD', '$1,299.00'],
    ['19', 'EUR', '€19.00'],
    ['24.99', 'usd', '$24.99'],
    ['24.99', undefined, '24.99'],
    ['about 20', 'USD', 'about 20 USD'],
    ['24.99', 'XX', '24.99 XX'],
    ['', 'USD', undefined],
    [undefined, 'USD', undefined],
    ['9'.repeat(60), 'USD', undefined],
  ])('formats %j %j as %j', (amount, currency, expected) => {
    expect(formatPrice(amount, currency)).toBe(expected);
  });
});
