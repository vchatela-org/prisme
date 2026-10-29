import { AreaBadge, Badge, Button, Card, EmptyState, Section, StatRow, StatTile } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  apiTokenListSchema,
  areaWeightsSchema,
  auditRetentionSchema,
  wipLimitsSchema,
  signalsLabelSchema,
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
import { featureRows, refusalBanner } from '@/lib/features-view';
import { docsUrl, HOW_IT_WORKS } from '@/lib/docs-link';
import { pageUrl } from '@/lib/page-link';
import { webRuntime } from '@/lib/runtime';
import {
  ACCESS_LABEL,
  INBOX_MAPPING_WARNING,
  checkAdvice,
  nameLocation,
  roleCopy,
  templateSummary,
} from '@/lib/settings-view';
import { AuditRetentionForm } from './audit-retention-form';
import { WipLimitsForm } from './wip-limits-form';
import { SignalsLabelForm } from './signals-label-form';
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
 * - **how long the audit of outward writes is kept** is prisme's own too, and
 *   is edited here (ADR-0031);
 * - **the work-in-progress limits** are prisme's own and edited here
 *   (ADR-0036);
 * - **the Signals lane label** is prisme's own and edited here (ADR-0041);
 * - **API tokens** are minted and revoked on their own screen (ADR-0015);
 * - **the write freeze, create threshold, sync window and scoring method** are
 *   deployment configuration, validated at boot, and shown read-only.
 */
export default async function SettingsPage() {
  const year = new Date().getUTCFullYear();
  const [
    settings,
    writeSwitch,
    sync,
    areas,
    weights,
    bindings,
    locations,
    retention,
    tokens,
    wipLimits,
    signalsLabel,
  ] = await Promise.all([
    apiFetch({ path: '/settings', schema: instanceSettingsSchema }),
    apiFetch({ path: '/write-switch', schema: writeSwitchSchema }),
    apiFetch({ path: '/sync', schema: syncStatusSchema }),
    apiFetch({ path: '/areas', schema: settingsAreaListSchema }),
    apiFetch({
      path: '/areas/weights',
      query: { year: String(year) },
      schema: areaWeightsSchema,
    }),
    apiFetch({ path: '/bindings', schema: bindingListSchema }),
    apiFetch({ path: '/task-tool/locations', schema: taskLocationsSchema }),
    apiFetch({ path: '/audit/retention', schema: auditRetentionSchema }),
    apiFetch({ path: '/tokens', schema: apiTokenListSchema }),
    apiFetch({ path: '/settings/wip-limits', schema: wipLimitsSchema }),
    apiFetch({ path: '/settings/signals-label', schema: signalsLabelSchema }),
  ]);
  const liveTokens = tokens.ok ? tokens.data.items.filter((token) => token.active).length : 0;

  const config = webRuntime().config;
  const docTemplate = config.doctoolPageUrlTemplate;
  const taskTemplate = config.tasktoolProjectUrlTemplate;
  const taskLocations = locations.ok ? locations.data : null;

  const refused = sync.ok ? refusalBanner(sync.data) : null;

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
        <p className="max-w-prose text-xs text-ink-muted">
          New here, or unsure which object something should be?{' '}
          <a
            className="underline underline-offset-2"
            href={docsUrl(HOW_IT_WORKS, config.version)}
            target="_blank"
            rel="noreferrer"
          >
            How prisme works
          </a>{' '}
          — the objects, how things come in, the loop and the reviews, on one page.
        </p>
      </header>

      {refused === null ? null : (
        <Card className="border-status-warning p-4 text-sm">
          <p className="font-medium text-ink">{refused.title}</p>
          <p className="mt-1 max-w-prose text-ink-secondary">{refused.description}</p>
        </Card>
      )}

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

      <div id="features">
        <Section
          title="Features"
          description="What this deployment switches on and off, and why. Each is a variable in the deployment, never a button; prisme shows whether it is set, not its value."
        >
          {settings.ok ? (
            <Card className="py-0">
              <ul className="flex flex-col divide-y divide-border-hairline">
                {featureRows(settings.data, docTemplate !== undefined).map((row) => (
                  <li key={row.key} className="flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">{row.name}</span>
                      <Badge variant={row.on ? 'accent' : 'outline'}>{row.on ? 'On' : 'Off'}</Badge>
                    </div>
                    <p className="text-sm text-ink-secondary">{row.does}</p>
                    {row.note === null ? null : (
                      <p className="text-xs text-ink-muted">{row.note}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <ApiFailureState failure={settings} surface="the instance settings" />
          )}
        </Section>
      </div>

      <div id="wip">
        <Section
          title="Work in progress"
          description="How much may be in flight at once, overall and in each area. Soft limits: Focus stops suggesting new work once one is reached and warns before you go past it, but nothing is refused, and nothing already in flight moves when you lower one."
        >
          {wipLimits.ok ? (
            <Card className="flex flex-col gap-4">
              <StatRow>
                <StatTile label="In flight at once" value={String(wipLimits.data.maxNow)} />
                <StatTile label="Per area" value={String(wipLimits.data.maxNowPerArea)} />
              </StatRow>
              <p className="max-w-prose text-sm text-ink-secondary">
                Something blocked by someone else? Move it to <em>Waiting</em>: it keeps its place
                and its history, and gives its slot back, so new work can start without breaking a
                limit.
                {wipLimits.data.chosen
                  ? ''
                  : ` These are the defaults, ${String(wipLimits.data.defaults.maxNow)} overall and ${String(wipLimits.data.defaults.maxNowPerArea)} per area, until you choose.`}
              </p>
              <WipLimitsForm limits={wipLimits.data} />
            </Card>
          ) : (
            <ApiFailureState failure={wipLimits} surface="the work-in-progress limits" />
          )}
        </Section>
      </div>

      <div id="signals-label">
        <Section
          title="Signals lane label"
          description="Automations — digests, change alerts, reminders a device sends — often write their tasks into an ordinary area's project. A task carrying this label is counted in the Signals lane wherever it sits: as volume, never as time, and never ranked. Other lanes are still decided by where work sits."
        >
          {signalsLabel.ok ? (
            <Card className="flex flex-col gap-4">
              <p className="max-w-prose text-sm text-ink-secondary">
                {signalsLabel.data.label === null
                  ? 'No label chosen: every task is counted where it sits.'
                  : `Tasks labelled “${signalsLabel.data.label}” are counted in ${
                      signalsLabel.data.lanes.find((lane) => lane.key === signalsLabel.data.areaKey)
                        ?.name ?? 'the Signals lane'
                    }.`}{' '}
                A change applies at the next daily refresh, to every completion whose labels prisme
                has read — the trailing weeks first; older history keeps its place until it is
                fetched again.
              </p>
              <SignalsLabelForm setting={signalsLabel.data} />
            </Card>
          ) : (
            <ApiFailureState failure={signalsLabel} surface="the Signals lane label" />
          )}
        </Section>
      </div>

      <div id="audit">
        <Section
          title="Audit of outward writes"
          description="Every call prisme makes to Notion or Todoist is recorded, whether it worked or not, and kept for this long. Older records are deleted by the daily full pass."
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/audit">Open the audit</Link>
            </Button>
          }
        >
          {retention.ok ? (
            <Card className="flex flex-col gap-4">
              <StatRow>
                <StatTile
                  label="Records kept for"
                  value={`${String(retention.data.retentionDays)} days`}
                />
                <StatTile label="Records held" value={String(retention.data.records)} />
                <StatTile
                  label="Oldest record"
                  value={retention.data.oldestAt?.slice(0, 10) ?? 'none yet'}
                />
              </StatRow>
              <AuditRetentionForm retention={retention.data} />
            </Card>
          ) : (
            <ApiFailureState failure={retention} surface="the audit retention window" />
          )}
        </Section>
      </div>

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

      <Section
        title="API tokens"
        description="How scripts, agents and MCP clients get in — each with a name, the scopes it may use and an expiry."
        actions={
          <Button asChild size="sm">
            <Link href="/settings/tokens">Manage</Link>
          </Button>
        }
      >
        {tokens.ok ? (
          <Card className="text-sm text-ink-secondary">
            {liveTokens === 0 ? (
              <p>No live token: nothing but you, signed in, can reach the API.</p>
            ) : (
              <p>
                {String(liveTokens)} live token{liveTokens === 1 ? '' : 's'}. Revoke any you no
                longer use.
              </p>
            )}
          </Card>
        ) : (
          <ApiFailureState failure={tokens} surface="the API tokens" />
        )}
      </Section>

      {settings.ok ? (
        <Section title="How prisme decides" description="Deployment configuration, read-only here.">
          <Card className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Fact label="Web version" value={config.version} />
            <Fact
              label="API version"
              value={settings.data.version}
              warning={settings.data.version !== config.version}
            />
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

function Fact({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-border-hairline py-1">
      <span className="text-ink-secondary">{label}</span>
      <span className={warning ? 'text-status-warning tabular-nums' : 'text-ink tabular-nums'}>
        {value}
      </span>
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
                  {named.inbox ? (
                    <p className="text-xs text-status-warning">{INBOX_MAPPING_WARNING}</p>
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
  const held =
    binding.bound && binding.checkError === null ? templateSummary(binding.templates) : null;

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
            {held === null ? null : (
              <p
                className={
                  held.warning
                    ? 'mt-1 max-w-prose text-xs text-status-warning'
                    : 'mt-1 max-w-prose text-xs text-ink-muted'
                }
              >
                {held.text}
              </p>
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
