import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBindingsFile } from './bindings.js';

/**
 * The bindings loader's parsing half.
 *
 * The file it reads is `seed/*.json`, which is gitignored **and** hand-written
 * by an instance's owner — so the interesting cases are all about what happens
 * when it is wrong. A typo'd role must not become "the document tool was not
 * read": a run that looks healthy and classifies nothing is the failure mode
 * `packages/connectors/CLAUDE.md` §3 exists to prevent.
 *
 * The fixture is `fixtures/bindings.json`, which is committed, invented, and
 * therefore the only dataset permitted here (CLAUDE.md rule 1).
 * `seed.example/bindings.json` — the format an instance copies — cannot be it:
 * every one of its identifiers is `REPLACE-ME`, which this loader refuses on
 * purpose, and there is a test below that says so.
 */

const EXAMPLE = new URL('../../../seed.example/bindings.json', import.meta.url).pathname;
const FIXTURE = new URL('../../../fixtures/bindings.json', import.meta.url).pathname;

function parse(text: string): ReturnType<typeof parseBindingsFile> {
  return parseBindingsFile(text, 'seed/bindings.json');
}

describe('parseBindingsFile', () => {
  it('reads the fixture, which is the format the spec documents', () => {
    const loaded = parseBindingsFile(readFileSync(FIXTURE, 'utf8'), FIXTURE);

    // Ten: the six stores, plus ADR-0025's two page stores and two templates.
    // `projectTemplateId` is not one — it is a task-tool project template, not
    // a role prisme addresses by key — and the prose keys are not either.
    expect(loaded.bindings).toHaveLength(10);
    expect(loaded.roles).toEqual([
      'areas_db',
      'initiative_page_template',
      'initiative_pages_db',
      'media_db',
      'objectives_db',
      'processes_db',
      'project_page_template',
      'project_pages_db',
      'reviews_db',
      'takeaways_db',
    ]);
  });

  it('never returns an identifier from `roles`', () => {
    // `roles` is what a log line prints. It must be keys only.
    const loaded = parseBindingsFile(readFileSync(FIXTURE, 'utf8'), FIXTURE);
    const text = readFileSync(FIXTURE, 'utf8');
    const anIdentifier = /"id":\s*"([^"]+)"/.exec(text)?.[1] as string;

    expect(JSON.stringify(loaded.roles)).not.toContain(anIdentifier);
    // …while the bindings themselves carry it, because a client needs it.
    expect(loaded.bindings.map((binding) => binding.externalId)).toContain(anIdentifier);
  });

  it('refuses a role prisme does not know, rather than skipping the line', () => {
    expect(() => parse('{"documentTool":{"not_a_role":{"id":"x"}}}')).toThrow(/not_a_role/);
  });

  it('refuses an empty identifier', () => {
    expect(() => parse('{"documentTool":{"areas_db":{"id":"   "}}}')).toThrow(/areas_db/);
  });

  it('refuses a role, not a line', () => {
    // The whole file is refused rather than the bad entry being dropped: a
    // loader that skipped one line would leave a store unaddressed while the
    // run reported success, and "the document tool was not read" would be a
    // fact nobody can find in a log.
    expect(() => parse('{"documentTool":{"areas_db":{"id":"a"},"nope":{"id":"b"}}}')).toThrow(
      /nope/,
    );
  });

  it('refuses a file that binds nothing', () => {
    expect(() => parse('{"documentTool":{}}')).toThrow(/binds no stores/);
    expect(() => parse('{"taskTool":{}}')).toThrow(/binds no stores/);
  });

  it('refuses a file that is not a JSON object', () => {
    expect(() => parse('not json')).toThrow(/not valid JSON/);
    expect(() => parse('["areas_db"]')).toThrow(/must be a JSON object/);
  });

  it('refuses the example file\u2019s placeholder rather than binding to it', () => {
    // `seed.example/bindings.json` ships `REPLACE-ME` in every slot. An instance
    // that copies it and forgets to edit would otherwise bind six stores to one
    // nonsense identifier and fail at the first query — a 404 from the document
    // tool, nowhere near the file that caused it.
    expect(() => parse('{"documentTool":{"areas_db":{"id":"REPLACE-ME"}}}')).toThrow(
      /placeholder identifier for role areas_db/,
    );
    // The file an instance actually copies is refused until it is edited.
    expect(() => parseBindingsFile(readFileSync(EXAMPLE, 'utf8'), EXAMPLE)).toThrow(
      /placeholder identifier for role objectives_db/,
    );
  });

  it('names the path in every message, because the operator has several seed files', () => {
    expect(() => parseBindingsFile('nope', '/mnt/seed/bindings.json')).toThrow(
      /\/mnt\/seed\/bindings\.json/,
    );
  });
});
