import { PriceTextSchema } from '@wishlist/contracts';
import { describe, expect, it } from 'vitest';
import { extractMetadata, formatPrice, productMetadata } from './metadata.js';

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

  it("skips a title that is only the site's host, as on a bot check's page", () => {
    const amazon = new URL('https://www.amazon.com/dp/B07C3FBNQ4');
    expect(extractMetadata('<title dir="ltr">Amazon.com</title>', amazon)).toEqual({});
    expect(extractMetadata('<title>SHOP.EXAMPLE</title>', SHOP)).toEqual({});
  });

  it("skips a title that is only the site's og:site_name, and tries the next source", () => {
    const html = `<meta property="og:site_name" content="Kettle Co">
<meta property="og:title" content="kettle co">
<script type="application/ld+json">{"@type":"Product","name":"Stovetop Kettle"}</script>`;
    expect(extractMetadata(html, SHOP)).toEqual({ title: 'Stovetop Kettle' });
  });

  it('keeps a title that names the product as well as the site', () => {
    const amazon = new URL('https://www.amazon.com/dp/B07C3FBNQ4');
    expect(extractMetadata('<title>Amazon.com: Garmin Approach CT10</title>', amazon)).toEqual({
      title: 'Amazon.com: Garmin Approach CT10',
    });
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
    ['24.99', 'ABC', '24.99 ABC'],
    ['24.99', 'TBD', '24.99 TBD'],
    ['', 'USD', undefined],
    [undefined, 'USD', undefined],
    ['9'.repeat(60), 'USD', undefined],
  ])('formats %j %j as %j', (amount, currency, expected) => {
    expect(formatPrice(amount, currency)).toBe(expected);
  });
});

// A prefill becomes an item's title and price, so every string must be one the contracts accept
// and Postgres stores unchanged: no NUL (Postgres refuses it) and no lone surrogate (stored as
// U+FFFD, so it would not read back as it was sent).
describe('a prefill is always storable (final review I1)', () => {
  const productPage = (fields: string) =>
    `<script type="application/ld+json">{"@type":"Product",${fields}}</script>`;
  const nameOf = (name: string) => extractMetadata(productPage(`"name":"${name}"`), SHOP).title;

  it('strips a NUL from a JSON-LD name', () => {
    expect(nameOf('Ket\\u0000tle')).toBe('Kettle');
  });

  it('strips a raw NUL from an og:title', () => {
    const html = `<meta property="og:title" content="Ket\u0000tle">`;
    expect(extractMetadata(html, SHOP).title).toBe('Kettle');
  });

  it('strips a raw NUL from <title>', () => {
    expect(extractMetadata('<title>Ket\u0000tle</title>', SHOP).title).toBe('Kettle');
  });

  it('strips other control characters, and keeps the spaces that were whitespace', () => {
    expect(nameOf('Ket\\u0001tle\\u007f\\tand\\nlid')).toBe('Kettle and lid');
  });

  it('strips a NUL from a JSON-LD price', () => {
    const { priceText } = extractMetadata(productPage('"offers":{"price":"4\\u00000"}'), SHOP);
    expect(priceText).toBe('40');
  });

  it('strips a NUL from an og price and its currency', () => {
    const html = `<meta property="og:price:amount" content="4\u00000"><meta property="og:price:currency" content="U\u0000SD">`;
    expect(extractMetadata(html, SHOP).priceText).toBe('$40.00');
  });

  it('strips format characters from a title, so it passes the item contract (D35)', () => {
    const html = `<meta property="og:title" content="Ket\u200Btle\u202E">`;
    expect(extractMetadata(html, SHOP).title).toBe('Kettle');
  });

  it('strips format characters from a price and its currency, so it passes the item contract (D36)', () => {
    const html = `<meta property="og:price:amount" content="4\u200B0"><meta property="og:price:currency" content="U\u202ESD">`;
    expect(extractMetadata(html, SHOP).priceText).toBe('$40.00');
    const { priceText } = extractMetadata(
      productPage('"offers":{"price":"\\u202e40\\u200b"}'),
      SHOP,
    );
    expect(priceText).toBe('40');
  });

  it('has no price when nothing visible is left', () => {
    expect(formatPrice('\u200B', 'USD')).toBeUndefined();
    expect(formatPrice('\u200D \u200D', undefined)).toBeUndefined();
  });

  it.each([
    ...Intl.supportedValuesOf('currency').map((code) => [code, '1234.5', code]),
    ['a code Intl lacks', '1234.5', 'ABC'],
    ['words', 'about 20', 'USD'],
    ['a right-to-left override', '\u202E40', 'USD'],
    ['a soft hyphen', '4\u00AD0', 'XYZ'],
    ['isolates and a zero-width space', '\u2066 40 \u2069', '\u200BEUR'],
  ])('formats a price the contract stores unchanged: %s (D36)', (_label, amount, currency) => {
    const price = formatPrice(amount, currency);
    expect(price).toBeDefined();
    expect(PriceTextSchema.parse(price)).toBe(price);
  });

  it('keeps the joiners an emoji or Persian needs', () => {
    expect(nameOf('\\ud83d\\udc69\\u200d\\ud83c\\udf73 Chef')).toBe(
      '\u{1F469}\u200D\u{1F373} Chef',
    );
  });

  it('has no title when nothing visible is left, and falls through to the next source', () => {
    const hidden = `<meta property="og:title" content="\u200B \u202E">`;
    expect(extractMetadata(hidden, SHOP).title).toBeUndefined();
    expect(extractMetadata(`${hidden}<title>Kettle</title>`, SHOP).title).toBe('Kettle');
    const joinersOnly = `<meta property="og:title" content="\u200D \u200D">`;
    expect(extractMetadata(joinersOnly, SHOP).title).toBeUndefined();
  });

  it('turns a numeric entity for a surrogate into U+FFFD, as HTML does', () => {
    expect(nameOf('A&#xD800;B')).toBe('A\uFFFDB');
    expect(nameOf('A&#57343;B')).toBe('A\uFFFDB');
  });

  it('makes a lone surrogate from a JSON escape well-formed', () => {
    const title = nameOf('A\\ud800B');
    expect(title).toBe('A\uFFFDB');
    expect(title?.isWellFormed()).toBe(true);
  });

  it('decodes ordinary numeric entities', () => {
    expect(nameOf('Tom&#39;s &#x26; Jerry&#x27;s')).toBe("Tom's & Jerry's");
  });

  it('keeps a character outside the BMP whole', () => {
    expect(nameOf('Kettle \\ud83e\\uded6')).toBe('Kettle \u{1FAD6}');
  });
});

describe('productMetadata (retailer lookups §5.2)', () => {
  const AMAZON = new URL('https://www.amazon.com/dp/B08FK7B2SC');
  const IMAGE = 'https://m.media-amazon.com/images/I/81huEJXkxfL._AC_SL1500_.jpg';

  it('cleans a lookup service’s fields as a page’s are cleaned', () => {
    expect(
      productMetadata(
        {
          title: '  Cephalofair Games:​ Frosthaven ',
          imageUrl: IMAGE,
          amount: 240,
          currency: 'USD',
        },
        AMAZON,
      ),
    ).toEqual({ title: 'Cephalofair Games: Frosthaven', imageUrl: IMAGE, priceText: '$240.00' });
  });

  it('drops an http image and a missing price', () => {
    expect(
      productMetadata(
        { title: 'Kettle', imageUrl: 'http://x.example/k.jpg', amount: null },
        AMAZON,
      ),
    ).toEqual({ title: 'Kettle' });
  });

  it('cuts a long title to 200 characters', () => {
    expect(productMetadata({ title: 'a'.repeat(250) }, AMAZON).title).toHaveLength(200);
  });

  it('ignores fields that aren’t strings', () => {
    expect(productMetadata({ title: 42, imageUrl: ['https://x.example/k.jpg'] }, AMAZON)).toEqual(
      {},
    );
  });
});
