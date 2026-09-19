import { LoadingState } from '@prisme/ui';

export default function AreaDetailLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Area</h1>
        <p className="text-sm text-ink-secondary">Reading its history…</p>
      </div>
      <LoadingState rows={6} label="Loading this area" />
    </div>
  );
}
