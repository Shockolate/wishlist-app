// Draws a share link's preview image (Plan 12, design §3.1, layout A): the wordmark, the list's
// title and count on the left, and up to four photos in a square grid on the right.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { countLine, tilesFor, titleSizeFor, type Tile } from './share-preview';

export const PREVIEW_SIZE = { width: 1200, height: 630 } as const;

/** The finished JPEG's ceiling, well inside every chat app's limit (design §5.2). */
export const PREVIEW_MAX_BYTES = 307_200;

/** A four-photo preview of noisy fixture photos measured 55 KB at this quality, so it stays at 80. */
const JPEG_QUALITY = 80;

/** A photo larger than this is skipped before it's decoded. */
const PHOTO_MAX_PIXELS = 40_000_000;

const PADDING = 64;
/** The grid's side, and so the one-photo tile's (ruling 6). */
const GRID = PREVIEW_SIZE.height - 2 * PADDING;
const GAP = 12;
const RADIUS = 16;
/** Half the grid, less half the gap: a 2×2 tile's side. */
const CELL = (GRID - GAP) / 2;

// globals.css's tokens, as literals: next/og can't read CSS variables.
const BACKGROUND = '#fbf9f5';
const INK = '#1f1a17';
const MUTED = '#5c554e';

const SERIF = 'Instrument Serif';
const SANS = 'Geist';

/** What a photo may be (PREVIEW_PHOTO_TYPES), as `sharp` names the formats. */
const PHOTO_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);

/**
 * Shrinks a photo to the one-photo tile, cropped to fill it. `null` if `sharp` can't read it, if
 * its bytes are anything but a JPEG, PNG or WebP whatever its Content-Type said (so no SVG, TIFF
 * or GIF reaches a decoder), or if it has more than 40 million pixels, which `sharp` refuses from
 * the header without decoding.
 */
export async function preparePhoto(bytes: Uint8Array): Promise<Buffer | null> {
  try {
    const image = sharp(bytes, { limitInputPixels: PHOTO_MAX_PIXELS });
    const { format } = await image.metadata();
    if (!format || !PHOTO_FORMATS.has(format)) return null;
    return await image
      .rotate() // upright by its EXIF orientation, as a phone photo is shown on the page
      .resize(GRID, GRID, { fit: 'cover' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}

type Assets = {
  fonts: { name: string; data: Buffer; weight: 400; style: 'normal' }[];
  /** The code points each font has a glyph for, in the title's font order: SERIF, then SANS. */
  titleCoverage: Set<number>[];
  icon: string;
};

/** Paths are traced into the route by next.config.ts (ruling 8). */
async function readAssets(): Promise<Assets> {
  const root = process.cwd();
  const [serif, sans, icon] = await Promise.all([
    readFile(join(root, 'assets/fonts/InstrumentSerif-Regular.ttf')),
    readFile(join(root, 'assets/fonts/Geist-Regular.ttf')),
    readFile(join(root, 'src/app/icon.svg')),
  ]);
  return {
    fonts: [
      { name: SERIF, data: serif, weight: 400, style: 'normal' },
      { name: SANS, data: sans, weight: 400, style: 'normal' },
    ],
    titleCoverage: [codePoints(serif), codePoints(sans)],
    icon: `data:image/svg+xml;base64,${icon.toString('base64')}`,
  };
}

let assets: Promise<Assets> | undefined;

/** Read once per server instance; a failed read is tried again on the next render. */
function loadAssets(): Promise<Assets> {
  const loading =
    assets ??
    readAssets().catch((error: unknown) => {
      assets = undefined;
      throw error;
    });
  assets = loading;
  return loading;
}

/**
 * The code points a TrueType font maps to a glyph, read from its `cmap` table: the Windows Unicode
 * subtable, format 12 (full Unicode) if it has one, else format 4 (the Basic Multilingual Plane).
 */
function codePoints(font: Buffer): Set<number> {
  const found = new Set<number>();
  const tables = font.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (font.toString('latin1', record, record + 4) === 'cmap') {
      cmap = font.readUInt32BE(record + 8);
    }
  }
  if (cmap < 0) return found;

  const subtables = new Map<string, number>();
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const record = cmap + 4 + i * 8;
    const platform = font.readUInt16BE(record);
    const encoding = font.readUInt16BE(record + 2);
    subtables.set(`${platform}.${encoding}`, cmap + font.readUInt32BE(record + 4));
  }
  const full = subtables.get('3.10');
  const bmp = subtables.get('3.1');

  if (full !== undefined && font.readUInt16BE(full) === 12) {
    const groups = font.readUInt32BE(full + 12);
    for (let i = 0; i < groups; i++) {
      const group = full + 16 + i * 12;
      for (let c = font.readUInt32BE(group); c <= font.readUInt32BE(group + 4); c++) found.add(c);
    }
  } else if (bmp !== undefined && font.readUInt16BE(bmp) === 4) {
    const segments = font.readUInt16BE(bmp + 6) / 2;
    const ends = bmp + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    for (let s = 0; s < segments; s++) {
      const start = font.readUInt16BE(starts + s * 2);
      const end = font.readUInt16BE(ends + s * 2);
      const delta = font.readUInt16BE(deltas + s * 2);
      const rangeOffset = font.readUInt16BE(rangeOffsets + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph = c;
        if (rangeOffset !== 0) {
          glyph = font.readUInt16BE(rangeOffsets + s * 2 + rangeOffset + (c - start) * 2);
          if (glyph === 0) continue;
        }
        if ((glyph + delta) & 0xffff) found.add(c);
      }
    }
  }
  return found;
}

/**
 * The title with every grapheme next/og can't draw from its own fonts removed. next/og fetches a
 * font from Google or an emoji from a CDN for any grapheme it can't draw, and fails the whole
 * render if an emoji fetch fails, so it must never see one (Review Focus 2). A title wholly in
 * another script, as `فهرست آرزو`, is drawn empty, under its count line.
 *
 * This follows satori's rule: a grapheme is drawn from the first font, in the text's order (its
 * own family, then the others as loaded), that has the grapheme's first code point, and only if
 * that same font has every code point in it. So `W̶` is dropped: Instrument Serif has the W, and
 * only Geist has the stroke.
 */
export async function drawableText(text: string): Promise<string> {
  const { titleCoverage } = await loadAssets();
  const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(
    text.normalize('NFC'),
  );
  let kept = '';
  for (const { segment } of graphemes) {
    const codes = [...segment].map((char) => char.codePointAt(0)!);
    const font = titleCoverage.find((covered) => covered.has(codes[0]!));
    const drawable = font !== undefined && codes.every((code) => font.has(code));
    if (drawable || /^\s+$/.test(segment)) kept += segment;
  }
  return kept.replace(/\s+/g, ' ').trim();
}

/** A tile's box on the grid: `tilesFor` speaks CSS grid, which next/og can't lay out. */
function tileBox(tile: Tile) {
  const span = (cells: number) => cells * CELL + (cells - 1) * GAP;
  return {
    left: (tile.column - 1) * (CELL + GAP),
    top: (tile.row - 1) * (CELL + GAP),
    width: span(tile.columnSpan),
    height: span(tile.rowSpan),
  };
}

function Preview({
  title,
  itemCount,
  photos,
  icon,
}: {
  title: string;
  itemCount: number;
  photos: Buffer[];
  icon: string;
}) {
  const tiles = tilesFor(photos.length);
  const { fontSize, lineClamp } = titleSizeFor(title, tiles.length > 0);
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        padding: PADDING,
        gap: 56,
        backgroundColor: BACKGROUND,
        color: INK,
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og draws <img>, not next/image */}
          <img src={icon} width={44} height={44} alt="" />
          <div style={{ fontFamily: SERIF, fontSize: 40, lineHeight: 1 }}>Hanker</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'block',
              lineClamp,
              fontFamily: SERIF,
              fontSize,
              lineHeight: 1.05,
              // An unbroken run of letters wraps rather than running under the grid.
              wordBreak: 'break-word',
            }}
          >
            {title}
          </div>
          <div style={{ fontFamily: SANS, fontSize: 30, color: MUTED, marginTop: 20 }}>
            {countLine(itemCount)}
          </div>
        </div>
      </div>
      {tiles.length > 0 && (
        <div style={{ display: 'flex', position: 'relative', width: GRID, height: GRID }}>
          {tiles.map((tile) => {
            const box = tileBox(tile);
            return (
              // eslint-disable-next-line @next/next/no-img-element -- next/og draws <img>, not next/image
              <img
                key={tile.photo}
                src={`data:image/jpeg;base64,${photos[tile.photo]!.toString('base64')}`}
                width={box.width}
                height={box.height}
                alt=""
                style={{ position: 'absolute', ...box, objectFit: 'cover', borderRadius: RADIUS }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The preview as JPEG bytes. `photos` are `preparePhoto`'s tiles, in list order; at most four are
 * drawn.
 */
export async function renderSharePreview(input: {
  title: string;
  itemCount: number;
  photos: Buffer[];
}): Promise<Buffer> {
  const { fonts, icon } = await loadAssets();
  const title = await drawableText(input.title);
  const preview = <Preview {...input} title={title} icon={icon} />;
  // @vercel/og rasterises its SVG with sharp when it can import it (it can: sharp is a dependency
  // here), and with its bundled resvg wasm otherwise.
  const png = await new ImageResponse(preview, {
    ...PREVIEW_SIZE,
    fonts,
  }).arrayBuffer();
  return sharp(Buffer.from(png)).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}
