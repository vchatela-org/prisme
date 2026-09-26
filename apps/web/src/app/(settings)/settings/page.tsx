import { AreaBadge, Badge, Button, Card, EmptyState, Section, StatRow, StatTile } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  areaWeightsSchema,
  bindingListSchema,
  instanceSettingsSchema,
  settingsAreaListSchema,
  syncStatusSchema,
  taskLocationsSchema,
  writeSwitchSchema,
  type Binding,
  type SettingsArea,
  type TaskLocations,
} from '@/lib/contracts';
import { pageUrl } from '@/lib/page-link';
import { webRuntime } from '@/lib/runtime';
import { ACCESS_LABEL, checkAdvice, nameLocation, roleCopy } from '@/lib/settings-view';
import { CheckBindingsButton } from './check-bindings-button';

export const metadata = {
  title: 'Settings · prisme',
  description: 'How this instance is configured, and where each part of it points.',
};

/**
 * Settings — the configuration overview.
 *
 * One screen that answers "what is prisme connected to, and how is it set
 * up?" without a terminal: which Notion store each role reads, which Todoist
 * projects each area's work lives in, and the safety settings that decide
 * whether anything can be written outward.
 *
 * Three kinds of setting appear here, and the screen says which is which,
 * because the answer to "how do I change it" differs:
 *
 * - **areas, colours, locations and Notion bindings** are prisme's own data,
 *   editable from the linked screens;
 * - **year weights** are editable only at the Year Review (ADR-0007);
 * - **the write freeze, create threshold, sync window and scoring method** are
 *   deployment configuration, validated at boot, and shown read-only.
 */
export default async function SettingsPage() {
  const year = new Date().getUTCFullYear();
  const [settings, writeSwitch, sync, areas, weights, bindings, locations] = await Promise.all([
    apiFetch({ path: '/settings', schema: instanceSettingsSchema }),
    apiFetch({ path: '/write-switch', schema: writeSwitchSchema }),
    apiFetch({ path: '/sync', schema: syncStatusSchema }),
    apiFetch({ path: '/areas', schema: settingsAreaListSchema }),
    apiFetch({ path: '/areas/weights', query: { year: String(year) }, schema: areaWeightsSchema }),
    apiFetch({ path: '/bindings', schema: bindingListSchema }),
    apiFetch({ path: '/task-tool/locations', schema: taskLocationsSchema }),
  ]);

  const config = webRuntime().config;
  const docTemplate = config.doctoolPageUrlTemplate;
  const taskTemplate = config.tasktoolProjectUrlTemplate;
  const taskLocations = locations.ok ? locations.data : null;

  const weightOf = new Map(
    (weights.ok ? weights.data.weights : []).map((row) => [row.areaKey, row.weightPct]),
  );

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="max-w-prose text-sm text-ink-secondary">
          What this instance is connected to and how it is set up. Areas and Notion links are edited
          here; year weights at the Year Review; the safety settings belong to the deployment and
          are shown for reference.
        </p>
      </header>

      <Section
        title="Can prisme write to Notion or Todoist?"
        description="Every button in prisme writes to prisme’s own database. Only these decide whether anything leaves it."
      >
        {settings.ok ? (
          <StatRow>
            <StatTile
              label="Outward writes"
              value={settings.data.sync.writeEnabled ? 'Enabled' : 'Frozen'}
            />
            <StatTile
              label="Kill switch"
              value={
                writeSwitch.ok ? (writeSwitch.data.engaged ? 'Engaged' : 'Released') : 'Unknown'
              }
            />
            <StatTile
              label="Creations allowed per pass"
              value={String(settings.data.sync.createThreshold)}
            />
            <StatTile
              label="Sync window"
              value={`${pad(settings.data.sync.windowStart)}:00–${pad(settings.data.sync.windowEnd)}:00`}
            />
          </StatRow>
        ) : (
          <ApiFailureState failure={settings} surface="the instance settings" />
        )}
        <Card className="text-sm text-ink-secondary">
          {settings.ok && !settings.data.sync.writeEnabled ? (
            <p>
              <span className="font-medium text-ink">Frozen:</span> nothing is written to Notion or
              Todoist. What you do here is recorded and waits; <em>Force sync</em> on Focus shows
              what would be written. Lifting the freeze is <code>SYNC_WRITE_ENABLED</code> in the
              deployment, never a button.
            </p>
          ) : (
            <p>
              Outward writes are enabled. The kill switch stops them at once without a redeploy, and
              a plan with more creations than the threshold is refused whole.
            </p>
          )}
          {sync.ok ? (
            <p className="mt-2 text-xs text-ink-muted">
              Last full pass: {sync.data.lastFullPassAt ?? 'never'} · unresolved conflicts:{' '}
              {String(sync.data.unresolvedConflicts)}
            </p>
          ) : null}
        </Card>
      </Section>

      <Section
        title="Areas"
        description={`Each area, its colour, its ${String(year)} weight, and the Todoist projects and sections its work lives in.`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/review/year">Change weights</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/settings/areas/new">New area</Link>
            </Button>
          </>
        }
      >
        {!areas.ok ? (
          <ApiFailureState failure={areas} surface="the areas" />
        ) : areas.data.items.length === 0 ? (
          <EmptyState
            title="No areas yet"
            description="Create your life areas first: everything prisme ranks is ranked within one."
          />
        ) : (
          <Card className="overflow-x-auto p-0">
            {taskLocations?.failure ? (
              <p className="border-b border-border-hairline px-3 py-2 text-xs text-status-warning">
                Todoist could not be read ({taskLocations.failure}), so locations are shown by
                identifier.
              </p>
            ) : null}
            <table className="w-full text-sm">
              <caption className="sr-only">Every area and where its work lives.</caption>
              <thead>
                <tr className="border-b border-border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Area
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Kind
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Weight
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Its work lives in (Todoist)
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {areas.data.items.map((area) => (
                  <AreaRow
                    key={area.key}
                    area={area}
                    weight={weightOf.get(area.key)}
                    locations={taskLocations}
                    taskTemplate={taskTemplate}
                  />
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>

      <Section
        title="Notion"
        description="prisme never names a Notion database. It names roles, and each role points at one store."
        actions={
          <>
            <CheckBindingsButton />
            <Button asChild size="sm">
              <Link href="/settings/notion">Edit</Link>
            </Button>
          </>
        }
      >
        {!bindings.ok ? (
          <ApiFailureState failure={bindings} surface="the Notion bindings" />
        ) : (
          <Card className="overflow-x-auto p-0">
            {docTemplate === undefined ? (
              <p className="border-b border-border-hairline px-3 py-2 text-xs text-ink-muted">
                Links are off: set <code>DOCTOOL_PAGE_URL_TEMPLATE</code> on the web tier to open
                these in Notion.
              </p>
            ) : null}
            <table className="w-full text-sm">
              <caption className="sr-only">Each Notion role and the store it points at.</caption>
              <thead>
                <tr className="border-b border-border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Points at
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    What prisme does with it
                  </th>
                </tr>
              </thead>
              <tbody>
                {bindings.data.items.map((binding) => (
                  <BindingRow key={binding.role} binding={binding} docTemplate={docTemplate} />
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>

      {settings.ok ? (
        <Section title="How prisme decides" description="Deployment configuration, read-only here.">
          <Card className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Fact
              label="Scoring method"
              value={`${settings.data.scoring.activeMethodId} v${String(settings.data.scoring.activeMethodVersion)}`}
            />
            <Fact
              label="Capacity window"
              value={`${String(settings.data.capacity.windowWeeks)} weeks`}
            />
            <Fact
              label="A task with no duration counts as"
              value={`${String(settings.data.capacity.defaultTaskMinutes)} minutes`}
            />
            <Fact
              label="In flight at once"
              value={`${String(settings.data.selection.maxNow)} overall, ${String(settings.data.selection.maxNowPerArea)} per area`}
            />
            <Fact label="Time zone" value={settings.data.timezone} />
          </Card>
        </Section>
      ) : null}
    </div>
  );
}

function pad(hour: number): string {
  return String(hour).padStart(2, '0');
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border-hairline py-1">
      <span className="text-ink-secondary">{label}</span>
      <span className="text-ink tabular-nums">{value}</span>
    </div>
  );
}

function AreaRow({
  area,
  weight,
  locations,
  taskTemplate,
}: {
  area: SettingsArea;
  weight: number | undefined;
  locations: TaskLocations | null;
  taskTemplate: string | undefined;
}) {
  return (
    <tr className="border-b border-border-hairline align-top last:border-b-0">
      <td className="px-3 py-2">
        <AreaBadge areaKey={area.key} name={area.name} kind={area.kind} />
        {area.active ? null : (
          <Badge className="ml-2" variant="outline">
            inactive
          </Badge>
        )}
        <div className="text-xs text-ink-muted">{area.key}</div>
      </td>
      <td className="px-3 py-2 text-ink-secondary">
        {area.kind === 'area' ? 'Area' : area.kind === 'run' ? 'Run lane' : 'Signals lane'}
        {area.kind === 'run' && area.runBudgetHoursPerWeek !== null
          ? ` · ${String(area.runBudgetHoursPerWeek)} h/week`
          : ''}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {area.kind === 'area' ? (weight === undefined ? '—' : `${weight.toFixed(0)}%`) : ''}
      </td>
      <td className="px-3 py-2">
        {area.mappings.length === 0 ? (
          <span className="text-status-warning">Nowhere yet — its work is not counted</span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {area.mappings.map((mapping) => {
              const named = nameLocation(
                locations,
                mapping.externalProjectId,
                mapping.externalSectionId,
              );
              const href = pageUrl(taskTemplate, mapping.externalProjectId);
              const text =
                named.section === null ? named.project : `${named.project} › ${named.section}`;
              return (
                <li key={`${mapping.externalProjectId}/${mapping.externalSectionId ?? ''}`}>
                  {href === undefined ? (
                    <span>{text}</span>
                  ) : (
                    <a
                      className="underline underline-offset-2"
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {text}
                    </a>
                  )}
                  {mapping.isHome ? (
                    <Badge className="ml-2" variant="accent">
                      new work goes here
                    </Badge>
                  ) : null}
                  {named.archived ? (
                    <Badge className="ml-2" variant="outline">
                      archived
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/settings/areas/${encodeURIComponent(area.key)}`}>Edit</Link>
        </Button>
      </td>
    </tr>
  );
}

function BindingRow({
  binding,
  docTemplate,
}: {
  binding: Binding;
  docTemplate: string | undefined;
}) {
  const copy = roleCopy(binding.role);
  const href = pageUrl(docTemplate, binding.linkId);
  const advice = binding.bound ? checkAdvice(binding.checkError) : null;

  return (
    <tr className="border-b border-border-hairline align-top last:border-b-0">
      <td className="px-3 py-2">
        <div className="font-medium text-ink">{copy.label}</div>
        <div className="text-xs text-ink-muted">
          {binding.role} · prisme {ACCESS_LABEL[binding.access]}
        </div>
      </td>
      <td className="px-3 py-2">
        {!binding.bound ? (
          <span className="text-ink-muted">Not set</span>
        ) : (
          <>
            {href === undefined ? (
              <span className="text-ink">{binding.title ?? 'Not checked yet'}</span>
            ) : (
              <a
                className="underline underline-offset-2"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                {binding.title ?? 'Open in Notion'}
              </a>
            )}
            {advice === null ? null : (
              <p className="mt-1 max-w-prose text-xs text-status-warning">{advice}</p>
            )}
          </>
        )}
      </td>
      <td className="px-3 py-2 text-ink-secondary">{copy.use}</td>
    </tr>
  );
}
