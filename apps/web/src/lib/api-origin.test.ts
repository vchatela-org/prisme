import type { Config } from '@prisme/config';
import { describe, expect, it } from 'vitest';
import { isStateChanging, originOf } from './api';

/**
 * The origin every state-changing call to the API states.
 *
 * These two functions are the whole of a defect that made **every write from
 * this application answer 403** while every read worked: the API runs W14's
 * origin check on the assertion path, a missing `Origin` is a refusal by
 * design, and this tier sent none. It was invisible until a write was driven
 * end to end against a real API, so it gets a test that does not need one.
 */

function aConfig(baseUrl: string): Config {
  return { baseUrl } as Config;
}

describe('isStateChanging', () => {
  it('is false for a read', () => {
    expect(isStateChanging('GET')).toBe(false);
    // The default when a call names no method is a GET.
    expect(isStateChanging(undefined)).toBe(false);
  });

  it('is true for every write verb', () => {
    for (const method of ['POST', 'PATCH', 'PUT'] as const) {
      expect(isStateChanging(method)).toBe(true);
    }
  });
});

describe('originOf', () => {
  it('is scheme, host and port', () => {
    expect(originOf(aConfig('https://prisme.example.com'))).toBe('https://prisme.example.com');
  });

  it('drops a path, because the API compares exact origins', () => {
    expect(originOf(aConfig('https://prisme.example.com/app/'))).toBe('https://prisme.example.com');
  });

  it('keeps a non-default port', () => {
    expect(originOf(aConfig('http://127.0.0.1:3001'))).toBe('http://127.0.0.1:3001');
  });

  it('drops a default port, matching what a browser would send', () => {
    expect(originOf(aConfig('https://prisme.example.com:443'))).toBe('https://prisme.example.com');
  });

  it('fails loudly rather than omitting the header', () => {
    // Omitting it would be a write path that answers 403 forever with nothing
    // saying why — which is exactly the bug this file exists for.
    expect(() => originOf(aConfig(''))).toThrow(/PRISME_BASE_URL/);
  });
});
