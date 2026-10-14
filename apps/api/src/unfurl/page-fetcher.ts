import { isIP, type LookupFunction } from 'node:net';
import { pipeline, Transform, type Readable, type TransformCallback } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { UnfurlFailureReason } from '@wishlist/contracts';
import { Agent, request } from 'undici';
import { PUBLIC_WEB, type AddressPolicy } from './address-policy.js';
import { createCaresResolve, type Resolve } from './dns.js';

export type { Resolve };

/** The default: c-ares, at most 4 lookups at once per process (spec §6.8, Plan 4a). */
export const resolveAll: Resolve = createCaresResolve();

/** How unfurl introduces itself (D34): honestly, with a page to read about it. */
export const USER_AGENT = 'Mozilla/5.0 (compatible; Hanker/1.0; +https://hanker.dev)';

// No Accept-Encoding: we'd rather receive plain bytes (Plan 3a rule 8).
const REQUEST_HEADERS = { 'user-agent': USER_AGENT, accept: 'text/html', 'accept-language': 'en' };

export interface PageFetcherOptions {
  policy?: AddressPolicy;
  resolve?: Resolve;
  timeoutMs?: number;
  maxBytes?: number;
  maxRawBytes?: number;
  maxRedirects?: number;
}

/**
 * A page, or why there isn't one. `truncated` means the page went on past `maxBytes`, and `html` is
 * its start.
 */
export type FetchedPage =
  | { ok: true; url: URL; html: string; truncated: boolean }
  | { ok: false; reason: UnfurlFailureReason; host?: string };

/** A failure with a known reason. fetch() throws these internally and returns them as results. */
class FetchFailure extends Error {
  constructor(readonly reason: UnfurlFailureReason) {
    super(reason);
    this.name = 'FetchFailure';
  }
}

/**
 * Fetches one HTML page for unfurl, under spec §6.8's rules:
 * - Every hop is checked before connecting: http or https, no userinfo, an allowed port, and every
 *   address the host resolves to allowed by the policy.
 * - The connection goes to an address that was checked, through undici's `connect.lookup`, so
 *   DNS can't change between the check and the connection (rebinding).
 * - Redirects are followed by hand, each hop checked again.
 * - One deadline covers every hop: DNS, connect, TLS, headers and body, and the result comes back
 *   within it. undici ignores an abort until the socket connects, so `untilAborted` enforces it;
 *   a connection that began just before the deadline is then closed by the connector's own timeout,
 *   set to the same value, so it can live up to `timeoutMs` past the deadline. That is bounded; it
 *   only delays releasing the socket, not the answer.
 * - Reading stops at `maxBytes`, counted after decompression. A longer page comes back as its
 *   start, marked `truncated`: a product page's metadata is in its <head>. A compressed body also
 *   stops at `maxRawBytes` before decompression, so a stream that decodes to almost nothing can't
 *   keep us reading until the deadline (Plan 4a).
 */
export class PageFetcher {
  private readonly policy: AddressPolicy;
  private readonly resolve: Resolve;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRawBytes: number;
  private readonly maxRedirects: number;

  constructor(options: PageFetcherOptions = {}) {
    this.policy = options.policy ?? PUBLIC_WEB;
    this.resolve = options.resolve ?? resolveAll;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxBytes = options.maxBytes ?? 1_048_576;
    this.maxRawBytes = options.maxRawBytes ?? 1_048_576;
    this.maxRedirects = options.maxRedirects ?? 3;
  }

  async fetch(rawUrl: string): Promise<FetchedPage> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, reason: 'INVALID_URL' };
    }
    // The hostnames checked during this fetch, with the addresses that passed. pinnedLookup serves
    // only these, and the agent dies with this fetch (Plan 3a rule 10).
    const vetted = new Map<string, string[]>();
    const agent = new Agent({ connect: { lookup: pinnedLookup(vetted), timeout: this.timeoutMs } });
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      for (let redirects = 0; ; redirects++) {
        // No hop starts after the deadline.
        signal.throwIfAborted();
        await this.vet(url, vetted, signal);
        // undici acts on an abort only once the socket is connected, so a server that stalls TCP
        // or the TLS handshake would outlast the deadline. untilAborted() enforces it. If it wins
        // the race, the abandoned request rejects later, when `finally` destroys the agent, and
        // untilAborted() has always observed that rejection.
        const res = await untilAborted(
          request(url, { dispatcher: agent, method: 'GET', headers: REQUEST_HEADERS, signal }),
          signal,
        );
        if (res.statusCode >= 300 && res.statusCode < 400) {
          await res.body.dump();
          // dump() resolves on close, so a deadline that passed while draining must be TIMEOUT.
          signal.throwIfAborted();
          if (redirects === this.maxRedirects) throw new FetchFailure('TOO_MANY_REDIRECTS');
          url = nextHop(res.headers.location, url);
          continue;
        }
        // Only a 200 is the page. A bot check can answer 202 with a script, and a 204 has nothing.
        if (res.statusCode !== 200) {
          await res.body.dump();
          // dump() resolves on close, so a deadline that passed while draining must be TIMEOUT.
          signal.throwIfAborted();
          throw new FetchFailure('BLOCKED_BY_SITE');
        }
        const type = res.headers['content-type'];
        if (typeof type !== 'string' || mediaType(type) !== 'text/html') {
          await res.body.dump();
          // dump() resolves on close, so a deadline that passed while draining must be TIMEOUT.
          signal.throwIfAborted();
          throw new FetchFailure('NOT_HTML');
        }
        const raw = new RawCap(this.maxRawBytes);
        const body = decoded(res.body, res.headers['content-encoding'], raw);
        const { bytes, truncated } = await readCapped(body, this.maxBytes, raw);
        return { ok: true, url, html: decodeHtml(bytes, type), truncated };
      }
    } catch (error) {
      return { ok: false, reason: reasonFor(error, signal), host: url.hostname };
    } finally {
      await agent.destroy();
    }
  }

  /** Spec §6.8's checks on one hop, before any connection. Records what passed, for the lookup. */
  private async vet(url: URL, vetted: Map<string, string[]>, signal: AbortSignal): Promise<void> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new FetchFailure('INVALID_URL');
    if (url.username || url.password) throw new FetchFailure('INVALID_URL');
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    const host = bareHost(url.hostname);
    // An IP-literal host never reaches `lookup` (Node skips it), so it's checked as it stands.
    const addresses = isIP(host) ? [host] : await this.lookUp(host, signal);
    if (!addresses.every((address) => this.policy.allows(address, port))) {
      throw new FetchFailure('DISALLOWED_ADDRESS');
    }
    vetted.set(host, addresses);
  }

  private async lookUp(host: string, signal: AbortSignal): Promise<string[]> {
    let addresses: string[];
    try {
      addresses = await untilAborted(this.resolve(host, signal), signal);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new FetchFailure('DNS_FAILED');
    }
    if (addresses.length === 0) throw new FetchFailure('DNS_FAILED');
    return addresses;
  }
}

/**
 * A `lookup` for undici's connector that answers only for hosts vet() checked, with the addresses
 * that passed (Plan 3a rule 10). Node asks in two forms. With `all: true`, the default under
 * autoSelectFamily, it wants a list; otherwise it wants one address and its family.
 */
export function pinnedLookup(vetted: ReadonlyMap<string, readonly string[]>): LookupFunction {
  return (hostname, options, callback) => {
    const entries = (vetted.get(hostname) ?? []).map((address) => ({
      address,
      family: isIP(address),
    }));
    const [first] = entries;
    if (!first) {
      const error: NodeJS.ErrnoException = new Error(`${hostname} was not checked for this fetch`);
      error.code = 'ENOTFOUND';
      callback(error, '', 0);
      return;
    }
    if (options.all) callback(null, entries);
    else callback(null, first.address, first.family);
  };
}

/** The next hop's URL. A redirect without a usable Location is BLOCKED_BY_SITE (Plan 3a rule 7). */
function nextHop(location: string | string[] | undefined, base: URL): URL {
  if (typeof location !== 'string') throw new FetchFailure('BLOCKED_BY_SITE');
  try {
    return new URL(location, base);
  } catch {
    throw new FetchFailure('BLOCKED_BY_SITE');
  }
}

/** `[::1]` → `::1`: URL keeps the brackets on an IPv6 host. */
function bareHost(hostname: string): string {
  return hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
}

function mediaType(contentType: string): string | undefined {
  return contentType.split(';')[0]?.trim().toLowerCase();
}

/**
 * The body, decompressed. We ask for no compression, but some servers send it anyway (Plan 3a rule
 * 8). pipeline() destroys every stage on an error, so an abort still ends the read.
 */
function decoded(body: Readable, encoding: string | string[] | undefined, raw: RawCap): Readable {
  const ignore = () => undefined;
  // A repeated header arrives as an array. It's unknown, like any encoding we can't decode.
  const name = Array.isArray(encoding) ? undefined : (encoding ?? '').trim().toLowerCase();
  switch (name) {
    case '':
    case 'identity':
      return body;
    case 'gzip':
    case 'x-gzip':
      return pipeline(body, raw, createGunzip(), ignore);
    case 'deflate':
      return pipeline(body, raw, createInflate(), ignore);
    case 'br':
      return pipeline(body, raw, createBrotliDecompress(), ignore);
    default:
      // Destroying an unread undici body emits an 'error' (an abort). When the response has
      // already completed nobody else listens, and an unhandled 'error' exits the process.
      body.on('error', ignore);
      body.destroy();
      throw new FetchFailure('NOT_HTML');
  }
}

/**
 * Counts a compressed body's raw bytes, and stops the stream once more than `max` have passed
 * (spec §6.8, Plan 4a). `reached` tells readCapped the stop was the cap, not a failure.
 */
class RawCap extends Transform {
  reached = false;
  private total = 0;

  constructor(private readonly max: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.total += chunk.length;
    if (this.total > this.max) {
      this.reached = true;
      callback(new Error('raw byte cap reached'));
      return;
    }
    callback(null, chunk);
  }
}

/**
 * The body's first `max` bytes, counted after decompression, and whether there was more. A body
 * stopped by its raw cap ends here too, with what was decoded so far.
 */
async function readCapped(
  stream: Readable,
  max: number,
  raw: RawCap,
): Promise<{ bytes: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      if (total + buffer.length > max) {
        chunks.push(buffer.subarray(0, max - total));
        // Leaving the loop destroys the stream, so the rest is never downloaded or decompressed.
        // An undici body destroyed before its end emits an abort 'error'. Node's async iterator
        // happens to leave a listener for it; this one means we don't depend on that.
        stream.on('error', () => undefined);
        return { bytes: Buffer.concat(chunks), truncated: true };
      }
      total += buffer.length;
      chunks.push(buffer);
    }
  } catch (error) {
    if (raw.reached) return { bytes: Buffer.concat(chunks), truncated: true };
    throw error;
  }
  return { bytes: Buffer.concat(chunks), truncated: false };
}

/**
 * Text, in the page's own charset (Plan 3a rule 9): the Content-Type charset, else a <meta>
 * charset in the first 1024 bytes, else UTF-8. An unknown label falls back to UTF-8.
 */
function decodeHtml(bytes: Buffer, contentType: string): string {
  const label =
    /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(
      bytes.subarray(0, 1024).toString('latin1'),
    )?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Rejects with the signal's reason as soon as it aborts, whatever `work` is still doing. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  // Observe `work` first. If the race is lost (or never run, below), `work` may still reject
  // later, and an unobserved rejection would take the whole process down.
  work.catch(() => undefined);
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason as Error);
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Plan 3a rule 7: a known failure keeps its reason; the deadline is TIMEOUT; the rest UNREACHABLE. */
function reasonFor(error: unknown, signal: AbortSignal): UnfurlFailureReason {
  if (error instanceof FetchFailure) return error.reason;
  if (signal.aborted) return 'TIMEOUT';
  return 'UNREACHABLE';
}
