import { describe, expect, it } from 'vitest';
import { areasArgsFrom, bindingsFrom } from './seed-cli.js';

/**
 * The seed path's argument parsing.
 *
 * Both commands take a path because no default is right, and both are run once
 * by hand — so a flag accepted where it means nothing, or a path read from the
 * wrong position, is a loader that reports success having read the wrong file.
 * The refusals are the interesting half.
 */

const argv = (...flags: string[]): readonly string[] => ['node', 'main.js', 'cmd', ...flags];

describe('bindingsFrom', () => {
  it('takes the path after --from', () => {
    expect(bindingsFrom(argv('--from', 'seed/bindings.json'))).toBe('seed/bindings.json');
  });

  it('refuses a bare command, a missing path, and any other flag', () => {
    expect(bindingsFrom(argv())).toBeUndefined();
    expect(bindingsFrom(argv('--from'))).toBeUndefined();
    expect(bindingsFrom(argv('seed/bindings.json'))).toBeUndefined();
    // `bindings` has no `--force`: a role binding is replaced wholesale, so
    // there is nothing for one to protect. Accepting it here would let a
    // mistyped flags line load anyway.
    expect(bindingsFrom(argv('--from', 'seed/bindings.json', '--force'))).toBeUndefined();
  });
});

describe('areasArgsFrom', () => {
  it('takes the path, with and without --force', () => {
    expect(areasArgsFrom(argv('--from', 'seed/areas.json'))).toEqual({
      path: 'seed/areas.json',
      force: false,
    });
    expect(areasArgsFrom(argv('--from', 'seed/areas.json', '--force'))).toEqual({
      path: 'seed/areas.json',
      force: true,
    });
  });

  it('refuses --force anywhere but after the path, and a fourth flag', () => {
    // `--force` first would leave the path in the position the parser reads as
    // the flag, so the load would read nothing rather than fail.
    expect(areasArgsFrom(argv('--force', '--from', 'seed/areas.json'))).toBeUndefined();
    expect(areasArgsFrom(argv('--from', 'seed/areas.json', '--force', 'extra'))).toBeUndefined();
    expect(areasArgsFrom(argv('--from', 'seed/areas.json', '--forced'))).toBeUndefined();
  });

  it('refuses a bare command and a missing path', () => {
    expect(areasArgsFrom(argv())).toBeUndefined();
    expect(areasArgsFrom(argv('--from'))).toBeUndefined();
  });
});
