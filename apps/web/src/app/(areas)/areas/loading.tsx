import { LoadingState } from '@prisme/ui';

export default function AreasLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Areas</h1>
        <p className="text-sm text-ink-secondary">Measuring the last four weeks…</p>
      </div>
      <LoadingState rows={6} label="Loading the balance view" />
    </div>
  );
}
