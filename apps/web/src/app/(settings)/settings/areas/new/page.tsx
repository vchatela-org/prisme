import { areaColorSlot } from '@prisme/ui/server';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { instanceAreaColors } from '@/lib/area-pins';
import { settingsAreaListSchema } from '@/lib/contracts';
import { NewAreaForm } from './new-area-form';

export const metadata = { title: 'New area · Settings · prisme' };

/**
 * Create an area or a lane. Its locations are chosen on the next screen, once
 * it exists — a mapping names an area, so the area comes first.
 */
export default async function NewAreaPage() {
  const [areas, colors] = await Promise.all([
    apiFetch({ path: '/areas', schema: settingsAreaListSchema }),
    instanceAreaColors(),
  ]);

  const takenBy: Record<number, string[]> = {};
  const hasRun = areas.ok && areas.data.items.some((area) => area.kind === 'run');
  const hasSignals = areas.ok && areas.data.items.some((area) => area.kind === 'signals');
  for (const area of areas.ok ? areas.data.items : []) {
    const slot = areaColorSlot(area.key, area.kind, colors);
    if (slot !== null) (takenBy[slot] ??= []).push(area.name);
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-xs text-ink-muted">
          <Link className="underline underline-offset-2" href="/settings">
            Settings
          </Link>{' '}
          › Areas
        </p>
        <h1 className="text-xl font-semibold text-ink">New area</h1>
        <p className="max-w-prose text-sm text-ink-secondary">
          A life domain that gets a share of your capacity each year. Its weight is set at the Year
          Review; where its work lives in Todoist is the next step.
        </p>
      </header>
      <NewAreaForm takenBy={takenBy} hasRun={hasRun} hasSignals={hasSignals} />
    </div>
  );
}
