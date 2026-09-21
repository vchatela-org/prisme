import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarChart } from './charts/bar-chart.js';
import { ChartFrame } from './charts/chart-frame.js';
import { LineChart } from './charts/line-chart.js';
import { StatTile } from './charts/stat-tile.js';
import { AreaBadge, AreaSwatch } from './domain/area-badge.js';
import { AreaColorProvider } from './domain/area-color-context.js';
import { BalanceMeter } from './domain/balance-meter.js';
import { DataTable } from './domain/data-table.js';
import { ScorePill } from './domain/score-pill.js';
import { FibonacciSelect } from './domain/fibonacci-select.js';
import { StatusChip } from './domain/status-chip.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './primitives/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './primitives/tabs.js';
import { ToastProvider } from './primitives/toast.js';

/**
 * **No server-rendered `style` attribute, anywhere in this package.**
 *
 * The web tier sends `style-src 'self' 'nonce-…'` with no `unsafe-inline`, and
 * a nonce cannot authorise a `style` *attribute* — only a `<style>` element.
 * So every `style={{…}}` in a server-rendered tree is a violation the browser
 * refuses and logs. W08 found this by running the screens: `<AreaBadge>` and
 * `<BalanceMeter>` painted their colour that way, and each page logged about a
 * hundred errors while the dots stayed grey until hydration re-applied the
 * same value through the CSSOM, which CSP does not govern.
 *
 * The end state was correct, which is exactly why it survived: nothing was
 * visibly broken after hydration and no check could see it. This is that
 * check. It renders the components rather than reading the source, so it also
 * catches an inline style that arrives from a dependency.
 *
 * Colour now reaches HTML as a class from the generated stylesheet and SVG as
 * a `fill` attribute — neither is a `style` attribute, and both still name a
 * custom property so the theme still switches. The rule, and the two ways to
 * satisfy it, are in `tokens/area-color.ts`.
 *
 * A sibling guard in `tokens/no-inline-style-source.test.ts` reads the source
 * of both trees, because what is not rendered here is not covered here.
 */

const AREAS = { health: 1, craft: 3 } as const;

/** Every component rendered below, with fixture-shaped props. */
const RENDERED: ReadonlyArray<readonly [string, () => React.ReactElement]> = [
  ['AreaBadge', () => <AreaBadge areaKey="health" name="Health" />],
  ['AreaBadge, a lane', () => <AreaBadge areaKey="run" name="Run" kind="run" size="sm" />],
  ['AreaSwatch', () => <AreaSwatch areaKey="craft" />],
  [
    'BalanceMeter, starved',
    () => <BalanceMeter areaKey="health" name="Health" targetPct={30} observedPct={9.4} />,
  ],
  [
    'BalanceMeter, over its share',
    () => <BalanceMeter areaKey="craft" name="Craft" targetPct={20} observedPct={61.25} />,
  ],
  [
    'BalanceMeter, a lane with no share',
    () => <BalanceMeter areaKey="run" name="Run" kind="run" targetPct={0} observedPct={12} />,
  ],
  [
    'BarChart',
    () => (
      <BarChart
        title="Share of capacity"
        data={[
          { label: 'Health', values: [22.5, 30], slot: 1 },
          { label: 'Craft', values: [41.25, 20] },
        ]}
        series={['Observed', 'Agreed']}
        reference={{ value: 25, label: 'Even split' }}
      />
    ),
  ],
  [
    'LineChart',
    () => (
      <LineChart
        title="Balance factor"
        labels={['W35', 'W36', 'W37']}
        series={[
          { label: 'Health', values: [1.1, null, 1.4], slot: 1 },
          { label: 'Craft', values: [0.8, 0.9, 0.9] },
        ]}
      />
    ),
  ],
  [
    'ChartFrame, with a legend',
    () => (
      <ChartFrame
        title="Two series"
        tableView={null}
        legend={[
          { label: 'Observed', colorClass: 'bg-series-1', shape: 'rect' },
          { label: 'Agreed', colorClass: 'bg-series-2', shape: 'line' },
        ]}
      >
        {null}
      </ChartFrame>
    ),
  ],
  [
    'StatTile, with a trend',
    () => <StatTile label="Initiatives finished" value="7" trend={[3, 4, 2, 5, 4, 6]} />,
  ],
  [
    'DataTable',
    () => (
      <DataTable
        caption="Initiatives"
        rows={[
          { id: 'i-1', title: 'One', areaKey: 'health' },
          { id: 'i-2', title: 'Two', areaKey: 'craft' },
        ]}
        getRowId={(row) => row.id}
        searchText={(row) => row.title}
        columns={[
          {
            id: 'title',
            header: 'Initiative',
            cell: (row) => row.title,
            sortValue: (row) => row.title,
            widthClass: 'w-1/2',
          },
          {
            id: 'area',
            header: 'Area',
            cell: (row) => <AreaBadge areaKey={row.areaKey} name={row.areaKey} size="sm" />,
            hideable: true,
          },
        ]}
      />
    ),
  ],
  [
    'ScorePill',
    () => (
      <ScorePill
        score={18.4}
        explain="A method's own sentence, shown verbatim."
        factors={{ value: 8, effort: 3 }}
        method="wsjf-balanced v1"
      />
    ),
  ],
  ['StatusChip', () => <StatusChip status="now" />],
  /*
   * The four below are not prisme's own markup — they are Radix's, reached
   * through prisme's wrappers, and they are here because they used to be the
   * twelve violations W07 could not fix.
   *
   * Radix is unstyled by design and hides its native controls with inline
   * `style` attributes, which a policy without `unsafe-inline` refuses: the
   * hidden `<select>` behind `<Select>` and the hidden radios behind
   * `<FibonacciSelect>` became **visible**, and the toast viewport stopped
   * being click-through. `patches/` moves those values onto the classes the
   * token sheet defines, and these cases are what holds the patch in place:
   * a dependency bump that invalidates a patch makes this **red**, which is
   * the only reason patching a dependency is safe here at all.
   *
   * `ToastProvider` renders a viewport whether or not a toast is showing, so
   * the case needs no toast to be useful.
   */
  [
    'Select (Radix)',
    () => (
      <Select value="a">
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>
    ),
  ],
  ['FibonacciSelect (Radix)', () => <FibonacciSelect label="Value" value={3} />],
  [
    'Tabs (Radix)',
    () => (
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel</TabsContent>
      </Tabs>
    ),
  ],
  ['ToastProvider (Radix)', () => <ToastProvider>x</ToastProvider>],
];

describe('no component server-renders a style attribute', () => {
  for (const [name, render] of RENDERED) {
    it(name, () => {
      const markup = renderToStaticMarkup(
        <AreaColorProvider overrides={AREAS}>{render()}</AreaColorProvider>,
      );

      expect(
        markup.match(/style="[^"]*"/g) ?? [],
        `${name} renders a style attribute. The policy the web tier sends refuses it, and the ` +
          `browser logs a violation for every one. Paint with a class (tokens/area-color.ts) ` +
          `or, when the value comes from data, with an SVG attribute.`,
      ).toEqual([]);
    });
  }

  it('is actually rendering — a guard against an empty assertion', () => {
    const markup = renderToStaticMarkup(
      <AreaColorProvider overrides={AREAS}>
        <AreaBadge areaKey="health" name="Health" />
      </AreaColorProvider>,
    );
    expect(markup).toContain('Health');
    // The colour still arrives, as the class the token sheet generates.
    expect(markup).toContain('bg-series-1');
  });
});
