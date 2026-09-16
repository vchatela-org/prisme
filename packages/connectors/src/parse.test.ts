import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isConnectorError } from './errors.js';
import { formatIssuePath, parseJsonOrThrow, parseOrThrow, redactPathSegment } from './parse.js';

const CONTEXT = { tool: 'doc', operation: 'query objectives_db', shape: 'query response' } as const;

describe('parseOrThrow', () => {
  it('returns the parsed value when the shape is right', () => {
    expect(parseOrThrow(z.object({ id: z.string() }), { id: 'doc-page-0001' }, CONTEXT)).toEqual({
      id: 'doc-page-0001',
    });
  });

  it('names the field that failed', () => {
    const schema = z.object({ results: z.array(z.object({ last_edited_time: z.string() })) });
    expect(() => parseOrThrow(schema, { results: [{ last_edited_time: 42 }] }, CONTEXT)).toThrow(
      /results\.0\.last_edited_time/,
    );
  });

  it('says what it expected', () => {
    const schema = z.object({ has_more: z.boolean() });
    expect(() => parseOrThrow(schema, { has_more: 'yes' }, CONTEXT)).toThrow(/expected boolean/);
  });

  it('refuses rather than coercing', () => {
    // '60%' is exactly the value somebody would be tempted to parse into 60.
    const schema = z.object({ number: z.number().nullable() });
    expect(() => parseOrThrow(schema, { number: '60%' }, CONTEXT)).toThrow(/number/);
  });

  it('names the tool and the operation, so a failure is attributable', () => {
    const schema = z.object({ id: z.string() });
    expect(() => parseOrThrow(schema, {}, CONTEXT)).toThrow(/doc tool: query objectives_db/);
  });

  it('carries the failure kind, so a caller can tell a bad shape from a bad token', () => {
    try {
      parseOrThrow(z.object({ id: z.string() }), {}, CONTEXT);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isConnectorError(error) && error.failure).toBe('invalid_shape');
      expect(isConnectorError(error) && error.retryable).toBe(false);
    }
  });

  it('never echoes the value that failed', () => {
    const schema = z.object({ title: z.number() });
    const secretish = 'Half-marathon training plan running';
    try {
      parseOrThrow(schema, { title: secretish }, CONTEXT);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(secretish);
    }
  });

  it('bounds the number of issues it lists', () => {
    const schema = z.object({
      a: z.string(),
      b: z.string(),
      c: z.string(),
      d: z.string(),
      e: z.string(),
      f: z.string(),
      g: z.string(),
    });
    expect(() => parseOrThrow(schema, {}, CONTEXT)).toThrow(/and 2 more/);
  });
});

describe('path redaction', () => {
  /**
   * The document tool keys page properties by their **user-defined names**, so
   * a raw Zod path is a route from a live workspace into a log line. Wire keys
   * are lower-case snake_case; anything else is redacted, and erring towards
   * redaction is the correct trade.
   */

  it('keeps wire keys and array indices', () => {
    expect(redactPathSegment('last_edited_time')).toBe('last_edited_time');
    expect(redactPathSegment('results')).toBe('results');
    expect(redactPathSegment(0)).toBe('0');
    expect(redactPathSegment('0')).toBe('0');
  });

  it('redacts anything that looks like somebody named it', () => {
    expect(redactPathSegment('Progress')).toBe('<redacted>');
    expect(redactPathSegment('Objectif annuel')).toBe('<redacted>');
    expect(redactPathSegment('Rolled up')).toBe('<redacted>');
  });

  it('redacts a symbol key', () => {
    expect(redactPathSegment(Symbol('anything'))).toBe('<redacted>');
  });

  it('renders the root of a response as <root>', () => {
    expect(formatIssuePath([])).toBe('<root>');
  });

  it('keeps a property name out of a real parse failure', () => {
    const schema = z.object({
      properties: z.record(z.string(), z.object({ number: z.number() })),
    });
    try {
      parseOrThrow(schema, { properties: { 'Objectif annuel': { number: 'sixty' } } }, CONTEXT);
      expect.unreachable('should have thrown');
    } catch (error) {
      const { message } = error as Error;
      expect(message).not.toContain('Objectif annuel');
      expect(message).toContain('properties.<redacted>.number');
    }
  });
});

describe('parseJsonOrThrow', () => {
  it('parses JSON', () => {
    expect(parseJsonOrThrow('{"ok":true}', CONTEXT)).toEqual({ ok: true });
  });

  it('fails without quoting the body — an HTML error page is not for the log', () => {
    const body = '<html><body>Rate limited for workspace Half-marathon</body></html>';
    try {
      parseJsonOrThrow(body, CONTEXT);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('was not JSON');
      expect((error as Error).message).not.toContain('Half-marathon');
    }
  });
});
