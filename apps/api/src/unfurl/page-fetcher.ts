import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { pipeline, type Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { UnfurlFailureReason } from '@wishlist/contracts';
import { Agent, request } from 'undici';
import { PUBLIC_WEB, type AddressPolicy } from './address-policy.js';

/** Resolves a hostname to every address it has. */
export type Resolve = (hostname: string) => Promise<string[]>;

export const resolveAll: Resolve = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/** How unfurl introduces itself (D34): honestly, with a page to read about it. */
export const USER_AGENT = 'Mozilla/5.0 (compatible; Hanker/1.0; +https://hanker.dev)';

// No Accept-Encoding: we'd rather receive plain bytes (Plan 3a rule 8).
const REQUEST_HEADERS = { 'user-agent': USER_AGENT, accept: 'text/html', 'accept-language': 'en' };

export interface PageFetcherOptions {
  policy?: AddressPolicy;
  resolve?: Resolve;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export type FetchedPage =
  { ok: true; url: URL; html: string } | { ok: false; reason: UnfurlFailureReason; host?: string };

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
 *   only delays releasing the socket, not the answer. The body is cut off at `maxBytes`.
 */
export class PageFetcher {
  private readonly policy: AddressPolicy;
  private readonly resolve: Resolve;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;

  constructor(options: PageFetcherOptions = {}) {
    this.policy = options.policy ?? PUBLIC_WEB;
    this.resolve = options.resolve ?? resolveAll;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxBytes = options.maxBytes ?? 1_048_576;
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
        const body = decoded(res.body, res.headers['content-encoding']);
        const bytes = await readCapped(body, this.maxBytes);
        return { ok: true, url, html: decodeHtml(bytes, type) };
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
      addresses = await untilAborted(this.resolve(host), signal);
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
 * 8). pipeline() destroys both sides on an error, so an abort still ends the read.
 */
function decoded(body: Readable, encoding: string | string[] | undefined): Readable {
  const ignore = () => undefined;
  // A repeated header arrives as an array. It's unknown, like any encoding we can't decode.
  const name = Array.isArray(encoding) ? undefined : (encoding ?? '').trim().toLowerCase();
  switch (name) {
    case '':
    case 'identity':
      return body;
    case 'gzip':
    case 'x-gzip':
      return pipeline(body, createGunzip(), ignore);
    case 'deflate':
      return pipeline(body, createInflate(), ignore);
    case 'br':
      return pipeline(body, createBrotliDecompress(), ignore);
    default:
      // Destroying an unread undici body emits an 'error' (an abort). When the response has
      // already completed nobody else listens, and an unhandled 'error' exits the process.
      body.on('error', ignore);
      body.destroy();
      throw new FetchFailure('NOT_HTML');
  }
}

/** Reads the whole body, but gives up once it passes `max` bytes, counted after decompression. */
async function readCapped(stream: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > max) throw new FetchFailure('TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
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
