import { LoadingState } from '@prisme/ui';

/**
 * What Focus shows while the API is answering.
 *
 * `aria-busy` and a live label, from `<LoadingState>`, so a screen reader is
 * told the region is loading rather than hearing a handful of empty boxes.
 */
export default function FocusLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Focus</h1>
        <p className="text-sm text-ink-secondary">Reading the now set…</p>
      </div>
      <LoadingState rows={5} label="Loading Focus" />
    </div>
  );
}
