'use client';

import {
  AreaBadge,
  AreaColorProvider,
  areaColorCollisions,
  AppShell,
  BalanceMeter,
  BarChart,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  colorTokens,
  Combobox,
  CommandPalette,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ErrorState,
  Field,
  FibonacciSelect,
  FieldHint,
  Input,
  Label,
  LineChart,
  LoadingState,
  PageHeader,
  PermissionDeniedState,
  Popover,
  PopoverContent,
  PopoverTrigger,
  radiusTokens,
  ScorePill,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  spaceTokens,
  StaleWeightsBanner,
  StatRow,
  StatTile,
  StatusChip,
  SyncStatus,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeToggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  ToastProvider,
  typeTokens,
  useToast,
  type Fibonacci,
} from '@prisme/ui';
import { BarChart3, CalendarRange, Inbox, LayoutGrid, Target, Telescope } from 'lucide-react';
import { useState } from 'react';
import {
  fixtureAreaColors,
  fixtureAreas,
  fixtureInitiatives,
  fixtureMethod,
  fixtureScores,
  fixtureWindow,
} from '../../../fixtures';

/**
 * Every component in `@prisme/ui`, with fixture data.
 *
 * Deliberately one page rather than a per-component route: the point is to see
 * the system together — whether two greys are actually the same grey, whether a
 * chart and a table agree — which a page per component hides.
 */
export function Gallery() {
  return (
    <AreaColorProvider overrides={fixtureAreaColors}>
      <ToastProvider>
        <AppShell
          brand="prisme"
          nav={NAV}
          headerRight={
            <>
              <SyncStatus
                state="idle"
                lastSyncAt={new Date(NOW.getTime() - 4 * 60_000)}
                lastDurationMs={1240}
                conflicts={2}
                now={NOW}
              />
              <ThemeToggle />
            </>
          }
          banner={
            <StaleWeightsBanner
              year={2027}
              carriedFrom={2026}
              action={
                <Button variant="secondary" size="sm">
                  Set 2027 weights
                </Button>
              }
            />
          }
        >
          <PageHeader
            title="Component gallery"
            description="Everything @prisme/ui exports, rendered with fixture data. Look here before you build."
            crumbs={[{ label: 'prisme', href: '/' }, { label: 'Gallery' }]}
          />

          <Foundations />
          <Primitives />
          <DomainComponents />
          <Charts />
          <States />
          <ShellPieces />
        </AppShell>
      </ToastProvider>
    </AreaColorProvider>
  );
}

/** Fixed, so the gallery renders identically on the server and the client. */
const NOW = new Date('2026-09-16T12:00:00Z');

const NAV = [
  {
    items: [
      { label: 'Focus', href: '#', icon: <Target />, current: true },
      { label: 'Backlog', href: '#', icon: <LayoutGrid /> },
      { label: 'Inbox', href: '#', icon: <Inbox />, badge: 3 },
    ],
  },
  {
    label: 'Review',
    items: [
      { label: 'Areas', href: '#', icon: <BarChart3 /> },
      { label: 'Timeline', href: '#', icon: <CalendarRange /> },
      { label: 'Objectives', href: '#', icon: <Telescope /> },
    ],
  },
];

function Swatch({ name, light, dark }: { name: string; light: string; dark: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="size-8 shrink-0 rounded-md border border-border-hairline"
        style={{ backgroundColor: `var(--prisme-${name})` }}
      />
      <span className="flex flex-col">
        <code className="text-xs text-ink">{name}</code>
        {/* Both values, always: the swatch shows the theme in force, and a
            label that only names one of them is wrong half the time. */}
        <code className="text-xs text-ink-muted">
          {light} · {dark}
        </code>
      </span>
    </div>
  );
}

function Foundations() {
  return (
    <Section
      title="Foundations"
      description="Tokens, not values. Nothing outside packages/ui/src/tokens names a colour."
    >
      <Card className="flex flex-col gap-4">
        <h3 className="text-sm font-medium text-ink">Colour</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(colorTokens).map(([name, token]) => (
            <Swatch key={name} name={name} light={token.light} dark={token.dark} />
          ))}
        </div>
        <p className="text-xs text-ink-secondary">
          Every one of these names a light value and a dark value, and each is checked against both
          surfaces in <code>tokens/contrast.test.ts</code>. Switch the theme in the header: nothing
          on this page re-renders with a different class, only the custom properties change.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-ink">Type</h3>
          {(['text-hero', 'text-2xl', 'text-xl', 'text-base', 'text-sm', 'text-xs'] as const).map(
            (size) => (
              <div key={size} className="flex items-baseline gap-3">
                <span className="text-ink" style={{ fontSize: `var(--prisme-${size})` }}>
                  Allocate first
                </span>
                <code className="text-xs text-ink-muted">{typeTokens[size]}</code>
              </div>
            ),
          )}
        </Card>

        <Card className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-ink">Space</h3>
          {(['1', '2', '3', '4', '6', '8'] as const).map((step) => (
            <div key={step} className="flex items-center gap-3">
              <span className="h-3 bg-accent" style={{ width: `var(--prisme-space-${step})` }} />
              <code className="text-xs text-ink-muted">
                space-{step} · {spaceTokens[step]}
              </code>
            </div>
          ))}
        </Card>

        <Card className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-ink">Radius and elevation</h3>
          <div className="flex flex-wrap items-end gap-3">
            {(['sm', 'md', 'lg', 'xl'] as const).map((radius) => (
              <div key={radius} className="flex flex-col items-center gap-1">
                <span
                  className="size-10 bg-surface-page ring-1 ring-border-strong"
                  style={{ borderRadius: radiusTokens[radius] }}
                />
                <code className="text-xs text-ink-muted">{radius}</code>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-3">
            <div className="rounded-lg bg-surface-raised p-3 text-xs text-ink-secondary shadow-raised">
              raised
            </div>
            <div className="rounded-lg bg-surface-overlay p-3 text-xs text-ink-secondary shadow-overlay">
              overlay
            </div>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function ToastButton() {
  const { toast } = useToast();
  return (
    <Button
      variant="secondary"
      onClick={() => {
        toast({
          title: 'Status moved to now',
          description: 'Its anchor will be updated on the next sync.',
          tone: 'success',
          action: { label: 'Undo', onAction: () => undefined },
        });
      }}
    >
      Show a toast
    </Button>
  );
}

function Primitives() {
  const [combo, setCombo] = useState<string>('init-004');

  return (
    <Section title="Primitives" description="On shadcn/ui conventions, over Radix and cmdk.">
      <Card className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Apply the plan</Button>
          <Button variant="secondary">Dry run</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Drop initiative</Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Badge>adopted</Badge>
          <Badge variant="accent">now</Badge>
          <Badge variant="outline">run</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field>
            <Label htmlFor="g-title">Title</Label>
            <Input id="g-title" defaultValue="Garage shelving installed" />
            <FieldHint>Phrase it as a result, not an activity.</FieldHint>
          </Field>

          <Field>
            <Label htmlFor="g-outcome">Outcome</Label>
            <Textarea id="g-outcome" placeholder="One sentence." />
            <FieldHint tone="error">An initiative entering now needs an outcome.</FieldHint>
          </Field>

          <Field>
            <Label htmlFor="g-status">Status</Label>
            <Select defaultValue="next">
              <SelectTrigger id="g-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['inbox', 'later', 'next', 'now'] as const).map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <Label htmlFor="g-combo">Depends on</Label>
            <Combobox
              id="g-combo"
              value={combo}
              onValueChange={setCombo}
              options={fixtureInitiatives.map((initiative) => ({
                value: initiative.id,
                label: initiative.title,
                adornment: (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(--prisme-series-1)` }}
                  />
                ),
              }))}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open a dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Apply 6 changes?</DialogTitle>
                <DialogDescription>
                  3 updates, 3 links, 0 creations. Adopting existing work never creates anything.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost">Cancel</Button>
                <Button variant="primary">Apply</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary">Open a sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Workshop bench finished</SheetTitle>
                <DialogDescription>Craft · next · depends on one initiative</DialogDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary">Open a popover</Button>
            </PopoverTrigger>
            <PopoverContent>Anchored, collision-aware, escapes on Escape.</PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary">Hover for a tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>Tooltips enhance. They never gate a value.</TooltipContent>
          </Tooltip>

          <ToastButton />
        </div>

        <Tabs defaultValue="now">
          <TabsList>
            <TabsTrigger value="now">Now</TabsTrigger>
            <TabsTrigger value="next">Next</TabsTrigger>
            <TabsTrigger value="later">Later</TabsTrigger>
          </TabsList>
          <TabsContent value="now" className="pt-3 text-sm text-ink-secondary">
            Five slots, one per area with capacity.
          </TabsContent>
          <TabsContent value="next" className="pt-3 text-sm text-ink-secondary">
            Ready, waiting for a slot.
          </TabsContent>
          <TabsContent value="later" className="pt-3 text-sm text-ink-secondary">
            Scored, not yet ready.
          </TabsContent>
        </Tabs>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">Skeleton</span>
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </Card>
    </Section>
  );
}

function DomainComponents() {
  const [size, setSize] = useState<Fibonacci>(13);
  const collisions = areaColorCollisions(fixtureAreas, fixtureAreaColors);

  return (
    <Section
      title="Domain components"
      description="The ones every surface needs, and none should re-invent."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-ink">Areas and lanes</h3>
          <div className="flex flex-wrap gap-3">
            {fixtureAreas.map((area) => (
              <AreaBadge key={area.key} areaKey={area.key} name={area.name} kind={area.kind} />
            ))}
          </div>
          <p className="text-xs text-ink-secondary">
            Colour comes from the area key, never from its position in this list. Run and Signals
            wear the neutral: they count toward capacity and never toward ranking.{' '}
            {collisions.length === 0
              ? 'No two areas share a slot.'
              : `Sharing a slot: ${collisions.map((group) => group.join(' and ')).join('; ')}.`}
          </p>
        </Card>

        <Card className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-ink">Statuses</h3>
          <div className="flex flex-wrap gap-2">
            {(
              ['inbox', 'later', 'next', 'now', 'waiting', 'review', 'done', 'dropped'] as const
            ).map((status) => (
              <StatusChip key={status} status={status} />
            ))}
          </div>
          <p className="text-xs text-ink-secondary">
            Icon plus label, so the distinction never rests on colour. The status palette is kept
            for severity — an initiative that is <em>later</em> is not a warning.
          </p>
        </Card>

        <Card className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-ink">Scores</h3>
          <div className="flex flex-wrap items-center gap-3">
            {fixtureInitiatives.slice(0, 4).map((initiative) => {
              const scored = fixtureScores[initiative.id];
              return scored ? (
                <ScorePill
                  key={initiative.id}
                  score={scored.score}
                  factors={scored.factors}
                  method={fixtureMethod}
                  explain={`Cost of delay ${String(scored.factors['cod'] ?? 0)} ÷ size ${String(initiative.size)}, balanced ×${(scored.factors['balanceFactor'] ?? 1).toFixed(2)}.`}
                />
              ) : null;
            })}
            <ScorePill
              score={4.5}
              stale
              method={fixtureMethod}
              explain="Computed from carried weights, so the balance factor is stale."
            />
          </div>
          <p className="text-xs text-ink-secondary">
            Hover, or focus with the keyboard. The sentence comes from the scoring method and is
            shown verbatim — paraphrasing it here is how the UI and the domain drift apart.
          </p>
        </Card>

        <Card className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-ink">Fibonacci input</h3>
          <FibonacciSelect label="Size" value={size} onValueChange={setSize} sliceAbove={8} />
          <p className="text-xs text-ink-secondary">
            The only way to set a score input. 1 · 2 · 3 · 5 · 8 · 13, one tab stop, arrow keys
            within.
          </p>
        </Card>

        <Card className="flex flex-col gap-4 lg:col-span-2">
          <h3 className="text-sm font-medium text-ink">Declared versus observed</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {fixtureWindow.map((area) => {
              const meta = fixtureAreas.find((one) => one.key === area.key);
              return (
                <BalanceMeter
                  key={area.key}
                  areaKey={area.key}
                  name={meta?.name ?? area.key}
                  kind={meta?.kind ?? 'area'}
                  targetPct={area.targetPct}
                  observedPct={area.observedSharePct}
                />
              );
            })}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <DataTable
            caption="Initiatives, from the fixture set"
            rows={fixtureInitiatives}
            getRowId={(row) => row.id}
            searchText={(row) => row.title}
            onRowActivate={() => undefined}
            columns={[
              {
                id: 'title',
                header: 'Initiative',
                cell: (row) => row.title,
                sortValue: (row) => row.title,
              },
              {
                id: 'area',
                header: 'Area',
                cell: (row) => {
                  const area = fixtureAreas.find((one) => one.key === row.areaKey);
                  return (
                    <AreaBadge
                      areaKey={row.areaKey}
                      name={area?.name ?? row.areaKey}
                      kind={area?.kind ?? 'area'}
                      size="sm"
                    />
                  );
                },
                sortValue: (row) => row.areaKey,
              },
              {
                id: 'status',
                header: 'Status',
                cell: (row) => <StatusChip status={row.status} />,
                sortValue: (row) => row.status,
              },
              {
                id: 'score',
                header: 'Score',
                align: 'right',
                cell: (row) => {
                  const scored = fixtureScores[row.id];
                  return scored ? (
                    <ScorePill
                      score={scored.score}
                      factors={scored.factors}
                      method={fixtureMethod}
                      explain={`Cost of delay ${String(scored.factors['cod'] ?? 0)} ÷ size ${String(row.size)}.`}
                    />
                  ) : (
                    <span className="text-ink-muted">—</span>
                  );
                },
                sortValue: (row) => fixtureScores[row.id]?.score ?? null,
              },
              {
                id: 'deadline',
                header: 'Deadline',
                align: 'right',
                cell: (row) => row.deadline ?? <span className="text-ink-muted">—</span>,
                sortValue: (row) => row.deadline,
                defaultHidden: false,
              },
            ]}
          />
          <p className="mt-2 text-xs text-ink-secondary">
            One tab stop for the whole table, then arrow keys. Sort cycles ascending, descending,
            back to the table&apos;s own order; blanks stay last in both directions.
          </p>
        </Card>
      </div>
    </Section>
  );
}

function Charts() {
  const areaRows = fixtureWindow
    .filter((area) => area.targetPct > 0)
    .map((area) => {
      const meta = fixtureAreas.find((one) => one.key === area.key);
      return {
        label: meta?.name ?? area.key,
        values: [area.observedSharePct, area.targetPct],
      };
    });

  return (
    <Section
      title="Charts"
      description="One wrapper per form. The awkward states live in the frame."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <BarChart
          title="Share of capacity, last four weeks"
          subtitle="Observed against the agreed share for 2026"
          data={areaRows}
          series={['Observed', 'Agreed']}
          format={(value) => `${value.toFixed(1)}%`}
        />

        <LineChart
          title="Balance factor over time"
          subtitle="Health, Craft and Home"
          labels={['W31', 'W32', 'W33', 'W34', 'W35', 'W36', 'W37']}
          format={(value) => value.toFixed(2)}
          footnote="Seven weeks of history. The gap in Home is a week with no completed work, not a zero."
          series={[
            {
              label: 'Health',
              values: [1.1, 1.3, 1.5, 1.6, 1.8, 1.9, 2.0],
              color: 'var(--prisme-series-1)',
            },
            {
              label: 'Craft',
              values: [1.4, 1.2, 1.1, 1.0, 1.0, 1.0, 1.0],
              color: 'var(--prisme-series-3)',
            },
            {
              label: 'Home',
              values: [0.9, 0.8, null, 0.7, 0.6, 0.5, 0.5],
              color: 'var(--prisme-series-5)',
            },
          ]}
        />

        <StatRow className="lg:col-span-2">
          <StatTile
            label="Initiatives finished"
            value="7"
            delta={{ value: '+2', direction: 'up', goodDirection: 'up', period: 'vs last month' }}
            trend={[3, 4, 2, 5, 4, 6, 5, 7, 6, 5, 6, 7]}
          />
          <StatTile
            label="Median cycle time"
            value="11 days"
            delta={{
              value: '−3 days',
              direction: 'down',
              goodDirection: 'down',
              period: 'vs last month',
            }}
            trend={[18, 17, 16, 16, 15, 14, 14, 13, 12, 12, 11, 11]}
          />
          <StatTile
            label="Areas on their share"
            value="2 of 6"
            delta={{ value: 'no change', direction: 'flat', period: 'vs last month' }}
          />
          <StatTile label="Open conflicts" value="2" />
        </StatRow>

        <BarChart title="An empty chart" subtitle="No data yet" data={[]} series={['Observed']} />

        <LineChart
          title="A single measurement"
          subtitle="One point is a dot, not an empty plot"
          labels={['W37']}
          series={[{ label: 'Throughput', values: [4] }]}
        />

        <BarChart
          title="A chart that failed to load"
          data={[]}
          series={['Observed']}
          error="request-id 9f2c1a"
          onRetry={() => undefined}
        />

        <BarChart title="A chart still loading" data={[]} series={['Observed']} loading />
      </div>
    </Section>
  );
}

function States() {
  return (
    <Section title="States" description="Defined once, so four screens cannot disagree.">
      <div className="grid gap-4 lg:grid-cols-2">
        <EmptyState
          title="Nothing in the backlog yet"
          description="Capture an outcome you want finished in the next six weeks, and prisme will score it against the rest."
          action={<Button variant="primary">Capture an initiative</Button>}
        />
        <ErrorState
          title="Areas could not be loaded"
          description="The API did not answer in time."
          detail="request-id 9f2c1a"
          onRetry={() => undefined}
        />
        <PermissionDeniedState
          title="You cannot see this instance"
          description="This view needs a token scoped to areas. Ask for one, then reload."
        />
        <Card>
          <LoadingState rows={4} label="Loading the backlog" />
        </Card>
      </div>
    </Section>
  );
}

function ShellPieces() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <Section title="Shell" description="Navigation, breadcrumbs, the banner, and ⌘K.">
      <Card className="flex flex-col gap-4">
        <Breadcrumbs
          crumbs={[
            { label: 'prisme', href: '/' },
            { label: 'Areas', href: '#' },
            { label: 'Craft' },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setPaletteOpen(true);
            }}
          >
            Open the command palette
          </Button>
          <span className="text-xs text-ink-secondary">…or press ⌘K / Ctrl+K anywhere.</span>
        </div>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          commands={[
            {
              id: 'focus',
              label: 'Go to Focus',
              group: 'Navigate',
              icon: <Target />,
              shortcut: 'G F',
              run: () => undefined,
            },
            {
              id: 'areas',
              label: 'Go to Areas',
              group: 'Navigate',
              icon: <BarChart3 />,
              keywords: ['balance', 'capacity'],
              run: () => undefined,
            },
            {
              id: 'capture',
              label: 'Capture an initiative',
              group: 'Act',
              icon: <Inbox />,
              shortcut: 'C',
              run: () => undefined,
            },
            {
              id: 'review',
              label: 'Start the weekly review',
              group: 'Act',
              icon: <CalendarRange />,
              run: () => undefined,
            },
          ]}
        />

        <SyncStatus
          state="error"
          lastSyncAt={new Date(NOW.getTime() - 3 * 3_600_000)}
          lastDurationMs={430}
          conflicts={1}
          now={NOW}
          onForce={() => undefined}
        />
      </Card>
    </Section>
  );
}
