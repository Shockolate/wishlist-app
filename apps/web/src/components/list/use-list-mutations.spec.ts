import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { listMutationsFor } from './use-list-mutations';

describe('listMutationsFor', () => {
  it('gives every caller the same instance for a QueryClient, so they share its stale flag', () => {
    const client = new QueryClient();
    expect(listMutationsFor(client)).toBe(listMutationsFor(client));
    expect(listMutationsFor(new QueryClient())).not.toBe(listMutationsFor(client));
  });
});
