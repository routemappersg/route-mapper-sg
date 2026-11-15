import { describe, expect, it } from 'vitest';
import { providers, setProviders } from '../src/providers/registry';
import type { Providers } from '../src/providers/types';

describe('provider registry', () => {
  it('throws until providers are configured, then returns them', () => {
    expect(() => providers()).toThrow();
    const stub = { geocoder: { id: 'mock' } } as unknown as Providers;
    setProviders(stub);
    expect(providers().geocoder.id).toBe('mock');
  });
});
