import type { Providers } from './types';

let current: Providers | null = null;

/** Wire the concrete providers once at startup (or swap in mocks in tests). */
export function setProviders(p: Providers): void {
  current = p;
}

export function providers(): Providers {
  if (!current) throw new Error('Providers not configured: call setProviders() at startup.');
  return current;
}
