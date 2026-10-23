import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { FakeErrorReporter, FakeTagSuggester } from '../testing/fakes.js';
import { askSuggester, hostOf } from './ask-suggester.js';
import type { SuggestInput, SuggestResult, TagSuggester } from './tag-suggester.js';

let log: MockInstance;
beforeEach(() => {
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
});

const INPUT: SuggestInput = { title: 'Secret title', note: 'Secret note', tagNames: ['Kitchen'] };

function ask(next: SuggestResult) {
  const suggester = new FakeTagSuggester();
  suggester.next = next;
  const reporter = new FakeErrorReporter();
  return { suggester, reporter, names: askSuggester(suggester, INPUT, reporter) };
}

describe('askSuggester (design §5.2 Errors and reporting)', () => {
  it('returns the names of an answer, and logs nothing', async () => {
    const { names, suggester, reporter } = ask({ ok: true, names: ['A'] });
    expect(await names).toEqual(['A']);
    expect(suggester.inputs).toEqual([INPUT]);
    expect(log).not.toHaveBeenCalled();
    expect(reporter.warnings).toEqual([]);
    expect(reporter.exceptions).toEqual([]);
  });

  it('reports a misconfigured status once, with only the status', async () => {
    const { names, reporter } = ask({
      ok: false,
      reason: 'UNAVAILABLE',
      status: 401,
      misconfigured: true,
    });
    expect(await names).toEqual([]);
    expect(reporter.warnings).toEqual([{ message: 'Workers AI answered 401', context: undefined }]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('tag-suggest UNAVAILABLE status=401');
  });

  it('only logs an outage', async () => {
    const { names, reporter } = ask({
      ok: false,
      reason: 'UNAVAILABLE',
      status: 429,
      misconfigured: false,
    });
    expect(await names).toEqual([]);
    expect(reporter.warnings).toEqual([]);
    expect(log.mock.calls).toEqual([['tag-suggest UNAVAILABLE status=429']]);
  });

  it('logs an outage with no status as none', async () => {
    const { names } = ask({ ok: false, reason: 'UNAVAILABLE', misconfigured: false });
    expect(await names).toEqual([]);
    expect(log.mock.calls).toEqual([['tag-suggest UNAVAILABLE status=none']]);
  });

  it.each(['TIMEOUT', 'BAD_ANSWER'] as const)('logs %s and returns nothing', async (reason) => {
    const { names, reporter } = ask({ ok: false, reason });
    expect(await names).toEqual([]);
    expect(log.mock.calls).toEqual([[`tag-suggest ${reason}`]]);
    expect(reporter.warnings).toEqual([]);
  });

  it('never puts the item’s text in a log line or a report', async () => {
    const results: SuggestResult[] = [
      { ok: false, reason: 'UNAVAILABLE', status: 403, misconfigured: true },
      { ok: false, reason: 'UNAVAILABLE', status: 503, misconfigured: false },
      { ok: false, reason: 'TIMEOUT' },
      { ok: false, reason: 'BAD_ANSWER' },
    ];
    const reporter = new FakeErrorReporter();
    for (const next of results) {
      const suggester = new FakeTagSuggester();
      suggester.next = next;
      await askSuggester(suggester, INPUT, reporter);
    }
    const everything = JSON.stringify([log.mock.calls, reporter.warnings, reporter.exceptions]);
    expect(everything).not.toMatch(/Secret|Kitchen/);
  });

  it('gives up at the deadline on a suggester that only stops when aborted', async () => {
    const stuck: TagSuggester = {
      suggest: (_input, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ ok: false, reason: 'TIMEOUT' }));
        }),
    };
    const started = Date.now();
    expect(await askSuggester(stuck, INPUT, new FakeErrorReporter(), 50)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(log.mock.calls).toEqual([['tag-suggest TIMEOUT']]);
  });

  it('gives up at the deadline on a suggester that ignores its signal', async () => {
    const deaf: TagSuggester = { suggest: () => new Promise(() => undefined) };
    const started = Date.now();
    expect(await askSuggester(deaf, INPUT, new FakeErrorReporter(), 50)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(log.mock.calls).toEqual([['tag-suggest TIMEOUT']]);
  });

  it('answers nothing, and reports the error, when a suggester throws', async () => {
    const broken: TagSuggester = { suggest: () => Promise.reject(new Error('boom')) };
    const reporter = new FakeErrorReporter();
    expect(await askSuggester(broken, INPUT, reporter)).toEqual([]);
    expect(reporter.exceptions).toHaveLength(1);
  });
});

describe('hostOf', () => {
  it('returns the hostname of a URL', () => {
    expect(hostOf('https://www.amazon.com/dp/B08FK7B2SC?ref=x')).toBe('www.amazon.com');
    expect(hostOf('http://shop.example:8080/kettle#top')).toBe('shop.example');
  });

  it('returns undefined for what isn’t a URL', () => {
    expect(hostOf('not a url')).toBeUndefined();
    expect(hostOf('')).toBeUndefined();
    expect(hostOf(undefined)).toBeUndefined();
  });
});
