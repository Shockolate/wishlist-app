import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requestId, requestIdOf } from './request-id.js';

function run(headers: Record<string, string>) {
  const req = { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
  const setHeader = vi.fn();
  const res = { locals: {}, setHeader } as unknown as Response;
  const next = vi.fn();
  requestId(req, res, next);
  return { id: requestIdOf(res), setHeader, next };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('requestId middleware', () => {
  it('generates a UUID when Vercel provides no ID, echoes it, and continues', () => {
    const { id, setHeader, next } = run({});
    expect(id).toMatch(UUID);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
    expect(next).toHaveBeenCalledOnce();
  });

  it("reuses Vercel's x-vercel-id so logs and errors line up", () => {
    expect(run({ 'x-vercel-id': 'iad1::iad1::abcde-1712345678901-0123456789ab' }).id).toBe(
      'iad1::iad1::abcde-1712345678901-0123456789ab',
    );
  });

  it('ignores a client-supplied x-request-id', () => {
    expect(run({ 'x-request-id': 'forged-id' }).id).toMatch(UUID);
  });

  it('replaces an oversized x-vercel-id', () => {
    expect(run({ 'x-vercel-id': 'a'.repeat(500) }).id).toMatch(UUID);
  });

  it('replaces an x-vercel-id containing unexpected characters', () => {
    expect(run({ 'x-vercel-id': 'iad1::<script>' }).id).toMatch(UUID);
  });
});
