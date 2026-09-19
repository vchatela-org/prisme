import { LoadingState } from '@prisme/ui';

export default function YearReviewLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Year Review</h1>
        <p className="text-sm text-ink-secondary">Gathering the year&rsquo;s evidence…</p>
      </div>
      <LoadingState rows={8} label="Loading the year review" />
    </div>
  );
}
