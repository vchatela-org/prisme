import { LoadingState } from '@prisme/ui';

export default function BacklogLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Backlog</h1>
        <p className="text-sm text-ink-secondary">Ranking what matches…</p>
      </div>
      <LoadingState rows={8} label="Loading the backlog" />
    </div>
  );
}
