import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { bindingListSchema } from '@/lib/contracts';
import { pageUrl } from '@/lib/page-link';
import { webRuntime } from '@/lib/runtime';
import { BindingsForm } from './bindings-form';

export const metadata = { title: 'Notion · Settings · prisme' };

/**
 * Which Notion store each role points at — the screen for what
 * `seed/bindings.json` used to be the only way to say.
 *
 * The file and its loader still work and still write the same table; loading
 * the file again replaces what is set here, which the page says.
 */
export default async function NotionSettingsPage() {
  const bindings = await apiFetch({ path: '/bindings', schema: bindingListSchema });
  const template = webRuntime().config.doctoolPageUrlTemplate;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-xs text-ink-muted">
          <Link className="underline underline-offset-2" href="/settings">
            Settings
          </Link>{' '}
          › Notion
        </p>
        <h1 className="text-xl font-semibold text-ink">Notion</h1>
        <div className="flex max-w-prose flex-col gap-2 text-sm text-ink-secondary">
          <p>
            Paste the link to each database or page (in Notion: <em>⋯ → Copy link</em>). prisme
            checks it as you save and shows its title. A database link is enough — prisme finds the
            data source inside it.
          </p>
          <p>
            Share each one with the prisme integration in Notion (<em>⋯ → Connections</em>). Notion
            enforces that on its side: anything not shared is invisible to prisme, and a read-only
            integration cannot write whatever prisme does.
          </p>
          <p className="text-xs text-ink-muted">
            Loading <code>seed/bindings.json</code> with <code>prisme-sync bindings</code> replaces
            everything set here.
          </p>
        </div>
      </header>

      {bindings.ok ? (
        <BindingsForm
          bindings={bindings.data.items.map((binding) => ({
            ...binding,
            href: pageUrl(template, binding.linkId) ?? null,
          }))}
        />
      ) : (
        <ApiFailureState failure={bindings} surface="the Notion bindings" />
      )}
    </div>
  );
}
