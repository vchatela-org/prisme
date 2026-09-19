import { LoadingState } from '@prisme/ui';

export default function TimelineLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Timeline</h1>
        <p className="text-sm text-ink-secondary">Planning the open work…</p>
      </div>
      <LoadingState rows={8} label="Computing the schedule" />
    </div>
  );
}
