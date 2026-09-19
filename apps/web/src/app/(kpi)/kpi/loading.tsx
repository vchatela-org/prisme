import { LoadingState } from '@prisme/ui';

export default function KpiLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">KPI</h1>
        <p className="text-sm text-ink-secondary">Bucketing the window…</p>
      </div>
      <LoadingState rows={8} label="Loading the dashboard" />
    </div>
  );
}
