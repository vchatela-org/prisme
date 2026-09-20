import { LoadingState } from '@prisme/ui';

export default function ObjectivesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Objectives</h1>
        <p className="text-sm text-ink-secondary">Reading what this period is for…</p>
      </div>
      <LoadingState rows={5} label="Loading the objectives" />
    </div>
  );
}
