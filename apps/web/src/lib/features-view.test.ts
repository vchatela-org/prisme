import { describe, expect, it } from 'vitest';
import { featureRows, refusalBanner } from './features-view';

const settings = {
  sync: { enabled: true, writeEnabled: true, createThreshold: 0, windowStart: 7, windowEnd: 22 },
  features: { readingPipeline: false, declaredDurations: true },
};

describe('what the deployment switches on and off (S8)', () => {
  it('says which features are off, and names the variable that turns each on', () => {
    const rows = featureRows(settings, false);
    const byKey = new Map(rows.map((row) => [row.key, row]));
    expect(byKey.get('reading')).toMatchObject({ on: false });
    expect(byKey.get('reading')?.note).toContain('DOCTOOL_TAKEAWAY_TYPE_PROPERTY');
    expect(byKey.get('durations')).toMatchObject({ on: true, note: null });
    expect(byKey.get('links')?.note).toContain('DOCTOOL_PAGE_URL_TEMPLATE');
  });

  it('connects a zero create threshold to the pass it refuses', () => {
    const creation = featureRows(settings, true).find((row) => row.key === 'creation');
    expect(creation?.on).toBe(false);
    expect(creation?.note).toContain('every pass is refused whole');
    const allowed = featureRows(
      { ...settings, sync: { ...settings.sync, createThreshold: 5 } },
      true,
    );
    expect(allowed.find((row) => row.key === 'creation')?.on).toBe(true);
  });

  it('calls creation off while writes are frozen, whatever the threshold', () => {
    const frozen = {
      ...settings,
      sync: { ...settings.sync, writeEnabled: false, createThreshold: 5 },
    };
    expect(featureRows(frozen, true).find((row) => row.key === 'creation')?.on).toBe(false);
  });
});

describe('the banner for a pass refused for its creations (S8)', () => {
  it('says how many and what the threshold is', () => {
    const banner = refusalBanner({
      createThreshold: 0,
      lastRefusal: { kind: 'create_threshold', creates: 2, at: '2026-09-17T08:45:00.000Z' },
    });
    expect(banner?.description).toContain('create 2 things');
    expect(banner?.description).toContain('SYNC_CREATE_THRESHOLD is 0');
  });

  it('stays quiet for the write freeze, and when nothing was refused', () => {
    expect(
      refusalBanner({
        createThreshold: 0,
        lastRefusal: { kind: 'write_freeze', creates: 0, at: '2026-09-17T08:45:00.000Z' },
      }),
    ).toBeNull();
    expect(refusalBanner({ createThreshold: 0, lastRefusal: null })).toBeNull();
  });
});
