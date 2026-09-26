import { Button, EmptyState } from '@prisme/ui';
import { areaColorSlot } from '@prisme/ui/server';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { instanceAreaColors } from '@/lib/area-pins';
import { settingsAreaListSchema, taskLocationsSchema } from '@/lib/contracts';
import { holders } from '@/lib/settings-view';
import { AreaDetailsForm } from './area-details-form';
import { LocationsForm } from './locations-form';

export const metadata = { title: 'Edit area · Settings · prisme' };

/**
 * One area: its name, its colour, whether it is active, and where its work
 * lives in the task tool.
 *
 * Two forms, saved separately, because they are two different writes with two
 * different consequences: renaming or recolouring changes how every screen
 * *draws* the area; changing its locations changes what capacity is attributed
 * to it and where new work is created.
 *
 * The key is shown and never editable — every weight, score and measurement is
 * stored against it — and so is the kind: turning an area into a lane would
 * rewrite the meaning of every past capacity reading.
 */
export default async function EditAreaPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [areas, locations, colors] = await Promise.all([
    apiFetch({ path: '/areas', schema: settingsAreaListSchema }),
    apiFetch({ path: '/task-tool/locations', schema: taskLocationsSchema }),
    instanceAreaColors(),
  ]);

  if (!areas.ok) return <ApiFailureState failure={areas} surface="the areas" />;

  const area = areas.data.items.find((candidate) => candidate.key === key);
  if (area === undefined) {
    return (
      <EmptyState
        title="No such area"
        description="It may have been created under another key."
        action={
          <Button asChild size="sm">
            <Link href="/settings">Back to Settings</Link>
          </Button>
        }
      />
    );
  }

  // Which other areas paint with each slot right now — a choice should be made
  // knowing what it would clash with.
  const takenBy: Record<number, string[]> = {};
  for (const other of areas.data.items) {
    if (other.key === area.key) continue;
    const slot = areaColorSlot(other.key, other.kind, colors);
    if (slot === null) continue;
    (takenBy[slot] ??= []).push(other.name);
  }

  const heldElsewhere = new Map(
    [...holders(areas.data.items)].filter(([, holder]) => holder !== area.key),
  );
  const nameOf = new Map(areas.data.items.map((item) => [item.key, item.name]));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs text-ink-muted">
            <Link className="underline underline-offset-2" href="/settings">
              Settings
            </Link>{' '}
            › Areas
          </p>
          <h1 className="text-xl font-semibold text-ink">{area.name}</h1>
          <p className="text-sm text-ink-secondary">
            Key <code>{area.key}</code> ·{' '}
            {area.kind === 'area'
              ? 'an area'
              : area.kind === 'run'
                ? 'the Run lane'
                : 'the Signals lane'}
            . Neither can change: everything prisme has measured is stored against them.
          </p>
        </div>
      </header>

      <AreaDetailsForm
        area={area}
        currentSlot={areaColorSlot(area.key, area.kind, colors)}
        takenBy={takenBy}
      />

      <LocationsForm
        area={area}
        locations={locations.ok ? locations.data : null}
        heldBy={Object.fromEntries(
          [...heldElsewhere].map(([location, holder]) => [location, nameOf.get(holder) ?? holder]),
        )}
      />
    </div>
  );
}
