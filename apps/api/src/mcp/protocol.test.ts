import { describe, expect, it } from 'vitest';
import {
  parseMessage,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  failure,
  success,
  JSON_RPC,
} from './protocol.js';

/**
 * Conformance, pinned.
 *
 * prisme implements the MCP wire format rather than importing it
 * ([ADR-0024](../../../../docs/20-decisions/0024-mcp-without-the-sdk.md)), and
 * the consequence that ADR accepts out loud is that **we own conformance**. The
 * SDK's types would have failed to compile against a changed specification;
 * nothing here would, so this file is what stands in for that — the shapes the
 * revision named below actually requires, asserted rather than assumed.
 */

describe('the revision this server speaks', () => {
  it('is the one that removed JSON-RPC batching', () => {
    expect(PROTOCOL_VERSION).toBe('2025-06-18');
  });

  it('accepts the revision a client is assumed to speak when it sends no header', () => {
    // The transport specification names `2025-03-26` for exactly this case. If
    // it is not in the supported list, a conforming client that omits the
    // header gets a 400 for being conforming.
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain('2025-03-26');
  });
});

describe('classifying one message', () => {
  it('reads a request', () => {
    const parsed = parseMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(parsed.kind).toBe('request');
  });

  it('reads a notification as a notification, not as a request with no id', () => {
    const parsed = parseMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(parsed.kind).toBe('notification');
  });

  it('accepts a client response to a request this server never sent', () => {
    // Legal on the wire. The transport asks for 202 and nothing else, which is
    // only reachable if this is classified rather than rejected.
    expect(parseMessage({ jsonrpc: '2.0', id: 4, result: {} }).kind).toBe('response');
    expect(parseMessage({ jsonrpc: '2.0', id: 4, error: { code: -1, message: 'x' } }).kind).toBe(
      'response',
    );
  });

  it('refuses a batch, and says why rather than iterating it', () => {
    const parsed = parseMessage([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind !== 'invalid') throw new Error('unreachable');
    expect(parsed.reason).toContain('batching');
  });

  it.each([
    ['a bare string', 'ping'],
    ['null', null],
    ['a number', 7],
  ])('refuses %s', (_label, value) => {
    expect(parseMessage(value).kind).toBe('invalid');
  });

  it('refuses the wrong JSON-RPC version', () => {
    expect(parseMessage({ jsonrpc: '1.0', id: 1, method: 'ping' }).kind).toBe('invalid');
  });

  it('keeps the id of a malformed request, so the client can correlate the error', () => {
    const parsed = parseMessage({ jsonrpc: '2.0', id: 'abc', method: 'ping', extra: true });
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind !== 'invalid') throw new Error('unreachable');
    expect(parsed.id).toBe('abc');
  });

  it('refuses an explicit null id, and says what to send instead', () => {
    // It is neither: a notification has no `id` member at all, and MCP says a
    // request's id MUST NOT be null. The message says so, because "unrecognised
    // key: id" would be true and useless.
    const parsed = parseMessage({ jsonrpc: '2.0', id: null, method: 'ping' });
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind !== 'invalid') throw new Error('unreachable');
    expect(parsed.reason).toContain('omit `id`');
  });

  it('refuses params sent by position', () => {
    // MCP uses by-name params everywhere. Accepting an array would only widen
    // what every downstream schema has to consider.
    expect(parseMessage({ jsonrpc: '2.0', id: 1, method: 'ping', params: [1] }).kind).toBe(
      'invalid',
    );
  });
});

describe('the response envelope', () => {
  it('carries the id back on success', () => {
    expect(success(7, { ok: true })).toEqual({ jsonrpc: '2.0', id: 7, result: { ok: true } });
  });

  it('omits `data` rather than sending it undefined', () => {
    const body = failure(1, JSON_RPC.methodNotFound, 'no');
    expect(body.error).not.toHaveProperty('data');
  });

  it('allows a null id on an error, which is the only place JSON-RPC does', () => {
    expect(failure(null, JSON_RPC.parseError, 'bad json').id).toBeNull();
  });
});
