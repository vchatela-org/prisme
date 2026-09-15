import { describe, expect, it } from 'vitest';
import {
  checksum,
  expectedSchemaVersion,
  loadMigrations,
  parseMigrationFile,
  planMigrations,
  type AppliedMigration,
  type Migration,
} from './migrations.js';
import { resolve } from 'node:path';

function migration(version: string, sql = `-- ${version}`): Migration {
  return parseMigrationFile(`${version}_example.sql`, sql);
}

function applied(entry: Migration): AppliedMigration {
  return { version: entry.version, name: entry.name, checksum: entry.checksum };
}

describe('parseMigrationFile', () => {
  it('takes the apply order from the numeric prefix', () => {
    const parsed = parseMigrationFile('0007_add_entity_link.sql', 'select 1;');
    expect(parsed.version).toBe('0007');
    expect(parsed.name).toBe('add entity link');
  });

  it('refuses a filename with no order in it', () => {
    expect(() => parseMigrationFile('add_entity_link.sql', '')).toThrow(/0001_description\.sql/);
  });
});

describe('checksum', () => {
  it('ignores line-ending differences between checkouts', () => {
    expect(checksum('a\r\nb')).toBe(checksum('a\nb'));
  });
});

describe('planMigrations', () => {
  it('applies everything against an empty database', () => {
    const shipped = [migration('0001'), migration('0002')];
    const plan = planMigrations(shipped, []);
    expect(plan.pending.map((entry) => entry.version)).toEqual(['0001', '0002']);
    expect(plan.problems).toEqual([]);
  });

  it('is idempotent: a second run has nothing to do', () => {
    const shipped = [migration('0001'), migration('0002')];
    const plan = planMigrations(shipped, shipped.map(applied));
    expect(plan.pending).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.problems).toEqual([]);
  });

  it('applies only what is new', () => {
    const one = migration('0001');
    const two = migration('0002');
    const plan = planMigrations([one, two], [applied(one)]);
    expect(plan.pending.map((entry) => entry.version)).toEqual(['0002']);
  });

  it('refuses when an applied migration was edited afterwards', () => {
    const original = migration('0001', 'create table a();');
    const edited = migration('0001', 'create table b();');
    const plan = planMigrations([edited], [applied(original)]);
    expect(plan.problems.join(' ')).toContain('changed after it was applied');
  });

  it('refuses when the database is ahead of the binary', () => {
    const plan = planMigrations(
      [migration('0001')],
      [applied(migration('0001')), applied(migration('0002'))],
    );
    expect(plan.problems.join(' ')).toContain('ahead of the binary');
  });

  it('refuses a back-filled migration', () => {
    const plan = planMigrations(
      [migration('0001'), migration('0002')],
      [applied(migration('0002'))],
    );
    expect(plan.problems.join(' ')).toContain('forward-only');
  });
});

describe('the migrations this package actually ships', () => {
  const shipped = loadMigrations(resolve(import.meta.dirname, '..', 'migrations'));

  it('loads and is ordered', () => {
    expect(shipped.length).toBeGreaterThan(0);
    const versions = shipped.map((entry) => entry.version);
    expect([...versions].sort()).toEqual(versions);
  });

  it('has a schema version for /readyz to compare against', () => {
    expect(expectedSchemaVersion(shipped)).toMatch(/^\d{4,}$/);
  });

  it('contains no backup capability — ADR-0022', () => {
    for (const entry of shipped) {
      expect(entry.sql.toLowerCase()).not.toContain('pg_dump');
    }
  });
});
