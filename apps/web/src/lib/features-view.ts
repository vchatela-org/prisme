import type { InstanceSettings, SyncStatus } from './contracts';

/**
 * What the deployment's settings switch on and off, in words (S8).
 *
 * Several features depend on a variable nobody sees from a screen: without
 * `DOCTOOL_TAKEAWAY_TYPE_PROPERTY` the reading pipeline is off and the Inbox
 * never receives a takeaway; without `DOCTOOL_PAGE_URL_TEMPLATE` no page opens
 * from prisme; with `SYNC_CREATE_THRESHOLD` at 0 the first initiative that
 * needs a task refuses the whole pass. Settings showed the values and never the
 * consequence, and the FAQ was the only place that connected them.
 *
 * Each row says what the feature does, whether it is on, and — when it is off
 * — the variable that turns it on. Never the variable's value: a property name
 * is instance data.
 */
export interface FeatureRow {
  readonly key: string;
  readonly name: string;
  readonly on: boolean;
  /** What it does when it is on. */
  readonly does: string;
  /** Why it is off and how to turn it on, or — when on — a caveat worth knowing. */
  readonly note: string | null;
}

export function featureRows(
  settings: Pick<InstanceSettings, 'sync' | 'features'>,
  pageLinks: boolean,
): readonly FeatureRow[] {
  const { sync, features } = settings;
  const creates = sync.writeEnabled && sync.createThreshold > 0;
  return [
    {
      key: 'sync',
      name: 'Reading Notion and Todoist',
      on: sync.enabled,
      does: 'The reconciler reads both tools on its schedule and keeps prisme in step with them.',
      note: sync.enabled ? null : 'Off: SYNC_ENABLED is false, so nothing is read or written.',
    },
    {
      key: 'writes',
      name: 'Writing to Notion and Todoist',
      on: sync.writeEnabled,
      does: 'Anchor tasks get prisme’s priority, deadline, label and backlink; decisions reach the tools.',
      note: sync.writeEnabled
        ? null
        : 'Off: the write freeze (SYNC_WRITE_ENABLED=false). Every pass is planned and refused — the safe state during adoption.',
    },
    {
      key: 'creation',
      name: 'Creating a task for new work',
      on: creates,
      does: 'An initiative created in prisme gets its anchor task when it reaches next.',
      note: !sync.writeEnabled
        ? 'Off while writes are frozen.'
        : sync.createThreshold === 0
          ? 'Off: SYNC_CREATE_THRESHOLD is 0. While anything waits to be created, every pass is refused whole — anchor updates included. Raise it once adoption is done.'
          : `Up to ${String(sync.createThreshold)} per pass; a pass with more is refused whole, anchor updates included.`,
    },
    {
      key: 'reading',
      name: 'Reading pipeline',
      on: features.readingPipeline,
      does: 'Action takeaways from your reading arrive in the Inbox; principles stay in Notion.',
      note: features.readingPipeline
        ? null
        : 'Off: DOCTOOL_TAKEAWAY_TYPE_PROPERTY is not set, so no takeaway has a type and none reaches the Inbox. Set it to the name of the takeaways database’s type property.',
    },
    {
      key: 'durations',
      name: 'Declared durations',
      on: features.declaredDurations,
      does: 'A ritual’s process page says how long it takes, and capacity counts that.',
      note: features.declaredDurations
        ? null
        : 'Off: DOCTOOL_DURATION_PROPERTY is not set, so a task without a recorded duration counts the default.',
    },
    {
      key: 'links',
      name: 'Opening pages from prisme',
      on: pageLinks,
      does: 'A linked Notion page opens from the initiative, ritual, area or review that names it.',
      note: pageLinks
        ? null
        : 'Off: DOCTOOL_PAGE_URL_TEMPLATE is not set, so links are recorded but not clickable.',
    },
  ];
}

/**
 * The banner for a pass refused for its creations, or `null` (S8).
 *
 * Only `create_threshold`: a write-freeze refusal is every pass's state until
 * the freeze is lifted, and Settings already says so. A refusal for creations
 * is the surprise — one new initiative reaching `next` stops every write.
 */
export function refusalBanner(
  status: Pick<SyncStatus, 'lastRefusal' | 'createThreshold'>,
): { readonly title: string; readonly description: string } | null {
  const refusal = status.lastRefusal;
  if (refusal === null || refusal.kind !== 'create_threshold') return null;
  const things = refusal.creates === 1 ? '1 thing' : `${String(refusal.creates)} things`;
  return {
    title: 'The last sync wrote nothing: it had to create more than it is allowed',
    description: `It needed to create ${things} in Todoist or Notion and SYNC_CREATE_THRESHOLD is ${String(status.createThreshold)}, so the whole pass was refused — anchor updates included. Raise the threshold in the deployment, or move the new work back to inbox or later until you are ready.`,
  };
}
