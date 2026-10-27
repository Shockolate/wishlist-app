/**
 * A JPEG's pixel size, read from its start-of-frame header. `null` if the bytes aren't a JPEG or
 * no frame header is found.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    // Fill bytes between segments.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    // SOF0 to SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0);
      const width = ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0);
      return { width, height };
    }
    at += 2 + length;
  }
  return null;
}
