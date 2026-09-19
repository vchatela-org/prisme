import { LoadingState } from '@prisme/ui';

export default function AdoptionLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Adoption</h1>
        <p className="text-sm text-ink-secondary">Reading the queue…</p>
      </div>
      <LoadingState rows={6} label="Loading the adoption queue" />
    </div>
  );
}
