import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { PUBLIC_WEB, type AddressPolicy } from './address-policy.js';
import { HttpMetadataFetcher } from './metadata-fetcher.js';
import { PageFetcher } from './page-fetcher.js';

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/kettle') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(
        '<meta property="og:title" content="Kettle"><meta property="product:price:amount" content="40"><meta property="product:price:currency" content="USD">',
      );
    }
    if (req.url === '/huge-kettle') {
      // Retail pages run past 1 MB, with their metadata in <head>.
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(
        `<head><meta property="og:title" content="Kettle"></head><body>${'x'.repeat(1_100_000)}</body>`,
      );
    }
    if (req.url === '/huge-empty') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(
        `<p>${'x'.repeat(1_100_000)}</p><meta property="og:title" content="Too late">`,
      );
    }
    if (req.url === '/empty') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<p>Nothing here</p>');
    }
    res.writeHead(403);
    return res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

let log: MockInstance;
beforeEach(() => {
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
});

const FIXTURE: AddressPolicy = {
  allows: (address, p) => (address === '127.0.0.1' && p === port) || PUBLIC_WEB.allows(address, p),
};
const fetcher = () =>
  new HttpMetadataFetcher(
    new PageFetcher({ policy: FIXTURE, resolve: () => Promise.resolve(['127.0.0.1']) }),
  );
const at = (path: string) => `http://shop.test:${port}${path}`;

describe('HttpMetadataFetcher (spec §6.8)', () => {
  it("returns the page's metadata", async () => {
    expect(await fetcher().fetch(at('/kettle'))).toEqual({ title: 'Kettle', priceText: '$40.00' });
  });

  it('says NO_METADATA when a page has nothing usable', async () => {
    expect(await fetcher().fetch(at('/empty'))).toEqual({ failureReason: 'NO_METADATA' });
  });

  it('says NO_METADATA when all a page has is a description (Plan 9 ruling 6)', async () => {
    const descriptionOnly = new HttpMetadataFetcher(
      new PageFetcher({ policy: FIXTURE, resolve: () => Promise.resolve(['127.0.0.1']) }),
      () => ({ description: 'x' }),
    );
    expect(await descriptionOnly.fetch(at('/kettle'))).toEqual({ failureReason: 'NO_METADATA' });
  });

  it('returns a description found beside a title', async () => {
    const withDescription = new HttpMetadataFetcher(
      new PageFetcher({ policy: FIXTURE, resolve: () => Promise.resolve(['127.0.0.1']) }),
      () => ({ title: 'Kettle', description: 'Pour-over kettle.' }),
    );
    expect(await withDescription.fetch(at('/kettle'))).toEqual({
      title: 'Kettle',
      description: 'Pour-over kettle.',
    });
  });

  it('reads a page past 1 MB from its first megabyte', async () => {
    expect(await fetcher().fetch(at('/huge-kettle'))).toEqual({ title: 'Kettle' });
  });

  it('says TOO_LARGE when the first megabyte has nothing usable', async () => {
    expect(await fetcher().fetch(at('/huge-empty'))).toEqual({ failureReason: 'TOO_LARGE' });
  });

  it("passes the fetcher's failure through", async () => {
    expect(await fetcher().fetch(at('/forbidden'))).toEqual({ failureReason: 'BLOCKED_BY_SITE' });
  });

  it('logs the reason and the host, never the path or query (Plan 3a rule 12)', async () => {
    await fetcher().fetch(at('/secret-path?email=ada@example.com'));
    expect(log).toHaveBeenCalledTimes(1);
    const message = String(log.mock.calls[0]?.[0]);
    expect(message).toBe('unfurl BLOCKED_BY_SITE host=shop.test');
    expect(message).not.toMatch(/secret|ada@example\.com/);
  });

  it('says NO_METADATA, and logs only the host, when reading the page throws', async () => {
    const throwing = new HttpMetadataFetcher(
      new PageFetcher({ policy: FIXTURE, resolve: () => Promise.resolve(['127.0.0.1']) }),
      () => {
        throw new Error('boom: a parser bug on hostile input');
      },
    );
    expect(await throwing.fetch(at('/kettle'))).toEqual({
      failureReason: 'NO_METADATA',
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toBe('unfurl NO_METADATA host=shop.test');
  });
});
