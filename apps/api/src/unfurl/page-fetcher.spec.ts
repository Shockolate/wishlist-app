import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createServer as createNetServer, type AddressInfo, type Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PUBLIC_WEB, type AddressPolicy } from './address-policy.js';
import { PageFetcher, USER_AGENT, pinnedLookup, type Resolve } from './page-fetcher.js';

const PAGE = '<html><head><title>Kettle</title></head></html>';
const CAFE_1252 = Buffer.concat([
  Buffer.from('<title>Caf'),
  Buffer.from([0xe9]),
  Buffer.from('</title>'),
]);

let server: Server;
let port = 0;
const seen: { url: string; headers: IncomingHttpHeaders }[] = [];

function redirect(res: ServerResponse, location: string) {
  res.writeHead(302, { location });
  res.end();
}

function html(res: ServerResponse, body: string | Buffer, headers: Record<string, string> = {}) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    switch (req.url) {
      case '/page':
        return html(res, PAGE);
      case '/r1':
        return redirect(res, '/page');
      case '/r2':
        return redirect(res, '/r1');
      case '/r3':
        return redirect(res, '/r2');
      case '/r4':
        return redirect(res, '/r3');
      case '/to-metadata':
        return redirect(res, 'http://169.254.169.254/latest/meta-data');
      case '/to-mapped':
        return redirect(res, 'http://[::ffff:127.0.0.1]/');
      case '/forbidden':
        res.writeHead(403);
        return res.end();
      case '/down':
        res.writeHead(503);
        return res.end();
      case '/challenge':
        // A bot check's interstitial: 202 Accepted, no Content-Type, a script that isn't the page.
        res.writeHead(202);
        return res.end('<script>solve()</script>');
      case '/no-content':
        res.writeHead(204);
        return res.end();
      case '/json':
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{}');
      case '/huge':
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(`<p>${'x'.repeat(1_100_000)}</p>`);
      case '/huge-unfinished':
        // More than 1 MB, then the response never ends.
        res.writeHead(200, { 'content-type': 'text/html' });
        res.write('x'.repeat(1_100_000));
        return;
      case '/gzip':
        return html(res, gzipSync(PAGE), { 'content-encoding': 'gzip' });
      case '/stalled-redirect-ip':
      case '/stalled-redirect-host':
        // A redirect whose body never finishes: 1 byte of the 100 promised, then silence.
        res.writeHead(302, {
          location:
            req.url === '/stalled-redirect-ip'
              ? `http://127.0.0.1:${port}/page`
              : 'http://nowhere.test/',
          'content-length': '100',
        });
        res.write('x');
        return;
      case '/zstd':
        return html(res, '<title>z</title>', { 'content-encoding': 'zstd' });
      case '/double-encoding':
        res.setHeader('content-encoding', ['gzip', 'br']);
        return html(res, gzipSync(PAGE));
      case '/bomb':
        return html(res, gzipSync(Buffer.alloc(5_000_000)), { 'content-encoding': 'gzip' });
      case '/latin1':
        res.writeHead(200, { 'content-type': 'text/html; charset=windows-1252' });
        return res.end(CAFE_1252);
      case '/meta-charset':
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(Buffer.concat([Buffer.from('<meta charset="windows-1252">'), CAFE_1252]));
      case '/slow':
        return; // Never answers.
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  seen.length = 0;
});

/** Production's rules, plus exactly one exception: the fixture server, 127.0.0.1 on its port. */
const FIXTURE: AddressPolicy = {
  allows: (address, p) => (address === '127.0.0.1' && p === port) || PUBLIC_WEB.allows(address, p),
};

function hosts(map: Record<string, string[]>): Resolve {
  return (hostname) => {
    const addresses = map[hostname];
    return addresses ? Promise.resolve(addresses) : Promise.reject(new Error('ENOTFOUND'));
  };
}

const fetcher = (options: { timeoutMs?: number } = {}) =>
  new PageFetcher({ policy: FIXTURE, resolve: hosts({ 'shop.test': ['127.0.0.1'] }), ...options });

const at = (path: string) => `http://shop.test:${port}${path}`;

describe('PageFetcher (spec §6.8)', () => {
  it('fetches an HTML page and reports where it ended up', async () => {
    expect(await fetcher().fetch(at('/r1'))).toEqual({
      ok: true,
      url: new URL(at('/page')),
      html: PAGE,
      truncated: false,
    });
  });

  it('identifies itself honestly, and asks for no compression (D34, Plan 3a rule 8)', async () => {
    await fetcher().fetch(at('/page'));
    expect(seen[0]?.headers['user-agent']).toBe(USER_AGENT);
    expect(seen[0]?.headers.accept).toBe('text/html');
    expect(seen[0]?.headers['accept-encoding']).toBeUndefined();
  });

  it('follows three redirects, but not four', async () => {
    expect((await fetcher().fetch(at('/r3'))).ok).toBe(true);
    expect(await fetcher().fetch(at('/r4'))).toMatchObject({
      ok: false,
      reason: 'TOO_MANY_REDIRECTS',
    });
  });

  it.each([
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::ffff:127.0.0.1]/',
    'http://[::127.0.0.1]/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://10.0.0.1/',
  ])('refuses %s before connecting (spec §8)', async (url) => {
    expect(await new PageFetcher().fetch(url)).toMatchObject({
      ok: false,
      reason: 'DISALLOWED_ADDRESS',
    });
  });

  it.each(['/to-metadata', '/to-mapped'])(
    'refuses a redirect from an allowed page to a private address (%s, spec §8)',
    async (path) => {
      expect(await fetcher().fetch(at(path))).toMatchObject({
        ok: false,
        reason: 'DISALLOWED_ADDRESS',
      });
    },
  );

  it('refuses a host if any one of its addresses is private', async () => {
    const page = await new PageFetcher({
      resolve: hosts({ 'mixed.test': ['93.184.216.34', '10.0.0.1'] }),
    }).fetch('http://mixed.test/');
    expect(page).toMatchObject({ ok: false, reason: 'DISALLOWED_ADDRESS' });
  });

  it('refuses ports other than 80 and 443, before connecting', async () => {
    const page = await new PageFetcher({
      resolve: hosts({ 'shop.example': ['93.184.216.34'] }),
    }).fetch('http://shop.example:8080/');
    expect(page).toMatchObject({ ok: false, reason: 'DISALLOWED_ADDRESS' });
  });

  it('connects to the address it checked, even if DNS changes its answer (rebinding)', async () => {
    let calls = 0;
    const resolve: Resolve = () =>
      Promise.resolve(calls++ === 0 ? ['127.0.0.1'] : ['169.254.169.254']);
    const page = await new PageFetcher({ policy: FIXTURE, resolve }).fetch(
      `http://rebind.test:${port}/page`,
    );
    expect(page.ok).toBe(true);
    expect(calls).toBe(1);
    expect(seen[0]?.headers.host).toBe(`rebind.test:${port}`);
  });

  it.each([
    'ftp://shop.test/file',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://ada:secret@shop.test/',
    'not a url',
  ])('refuses %j as INVALID_URL', async (url) => {
    expect(await fetcher().fetch(url)).toMatchObject({ ok: false, reason: 'INVALID_URL' });
  });

  it('reports a host that does not resolve as DNS_FAILED', async () => {
    expect(await fetcher().fetch('http://nowhere.test/')).toMatchObject({
      ok: false,
      reason: 'DNS_FAILED',
      host: 'nowhere.test',
    });
  });

  it('reports a refused connection as UNREACHABLE (Plan 3a rule 7)', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const page = await new PageFetcher({
      policy: { allows: (address, p) => address === '127.0.0.1' && p === closedPort },
      resolve: hosts({ 'shop.test': ['127.0.0.1'] }),
    }).fetch(`http://shop.test:${closedPort}/`);
    expect(page).toMatchObject({ ok: false, reason: 'UNREACHABLE' });
  });

  it.each(['/forbidden', '/down', '/challenge', '/no-content'])(
    'reports %s as BLOCKED_BY_SITE: only a 200 is the page',
    async (path) => {
      expect(await fetcher().fetch(at(path))).toMatchObject({
        ok: false,
        reason: 'BLOCKED_BY_SITE',
      });
    },
  );

  it('refuses anything but HTML', async () => {
    expect(await fetcher().fetch(at('/json'))).toMatchObject({ ok: false, reason: 'NOT_HTML' });
  });

  it('stops reading at 1 MB, and returns what arrived', async () => {
    const page = await fetcher().fetch(at('/huge'));
    expect(page).toMatchObject({ ok: true, truncated: true });
    expect(page.ok && page.html).toBe(`<p>${'x'.repeat(1_048_573)}`);
    // Let the abandoned body emit; Vitest fails the run on an unhandled 'error'.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('returns at 1 MB without waiting for the rest of the response', async () => {
    const page = await fetcher({ timeoutMs: 1_000 }).fetch(at('/huge-unfinished'));
    expect(page).toMatchObject({ ok: true, truncated: true });
    expect(page.ok && page.html.length).toBe(1_048_576);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('gives up on a site that is too slow', async () => {
    expect(await fetcher({ timeoutMs: 200 }).fetch(at('/slow'))).toMatchObject({
      ok: false,
      reason: 'TIMEOUT',
    });
  });

  it('gives up on DNS that is too slow', async () => {
    const page = await new PageFetcher({
      timeoutMs: 200,
      resolve: () => new Promise<string[]>(() => undefined),
    }).fetch('http://slow-dns.test/');
    expect(page).toMatchObject({ ok: false, reason: 'TIMEOUT' });
  });

  it('stops decompressing a compression bomb at 1 MB decoded (Plan 3a rule 8)', async () => {
    const page = await fetcher().fetch(at('/bomb'));
    expect(page).toMatchObject({ ok: true, truncated: true });
    expect(page.ok && page.html.length).toBe(1_048_576);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it.each(['/stalled-redirect-ip', '/stalled-redirect-host'])(
    'times out, without an unhandled rejection, when the deadline passes while draining a redirect (%s)',
    async (path) => {
      expect(await fetcher({ timeoutMs: 200 }).fetch(at(path))).toMatchObject({
        ok: false,
        reason: 'TIMEOUT',
      });
      // Let any abandoned promise reject; Vitest fails the run if one is unhandled.
      await new Promise((resolve) => setTimeout(resolve, 100));
    },
  );

  it('gives up on a server that accepts the connection but never completes the TLS handshake', async () => {
    const sockets = new Set<Socket>();
    const silent = createNetServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const silentPort = (silent.address() as AddressInfo).port;
    try {
      const started = Date.now();
      const page = await new PageFetcher({
        timeoutMs: 200,
        policy: { allows: (address, p) => address === '127.0.0.1' && p === silentPort },
        resolve: hosts({ 'slow-tls.test': ['127.0.0.1'] }),
      }).fetch(`https://slow-tls.test:${silentPort}/`);
      expect(page).toMatchObject({ ok: false, reason: 'TIMEOUT' });
      expect(Date.now() - started).toBeLessThan(450);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => silent.close(resolve));
    }
  });

  it.each(['/zstd', '/double-encoding'])(
    'refuses an unknown or repeated Content-Encoding as NOT_HTML, without crashing (%s, Plan 3a rule 7)',
    async (path) => {
      expect(await fetcher().fetch(at(path))).toMatchObject({ ok: false, reason: 'NOT_HTML' });
      // Let the destroyed body emit; Vitest fails the run on an unhandled 'error'.
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  );

  it('decodes a gzipped page it did not ask for (Plan 3a rule 8)', async () => {
    expect(await fetcher().fetch(at('/gzip'))).toMatchObject({ ok: true, html: PAGE });
  });

  it.each(['/latin1', '/meta-charset'])(
    'reads a windows-1252 page correctly (%s, Plan 3a Review Focus 5)',
    async (path) => {
      const page = await fetcher().fetch(at(path));
      expect(page.ok && page.html).toContain('Café');
    },
  );
});

describe('pinnedLookup (Plan 3a rule 10)', () => {
  const lookup = pinnedLookup(new Map([['shop.test', ['93.184.216.34', '2606:4700::1111']]]));

  const ask = (hostname: string, all: boolean) =>
    new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family?: number }>(
      (resolve) => {
        lookup(hostname, { all }, (error, address, family) => resolve({ error, address, family }));
      },
    );

  it('answers the list form Node uses by default', async () => {
    expect((await ask('shop.test', true)).address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::1111', family: 6 },
    ]);
  });

  it('answers the single-address form', async () => {
    const { address, family } = await ask('shop.test', false);
    expect([address, family]).toEqual(['93.184.216.34', 4]);
  });

  it('refuses a host nobody checked', async () => {
    expect((await ask('elsewhere.test', true)).error?.code).toBe('ENOTFOUND');
  });
});
