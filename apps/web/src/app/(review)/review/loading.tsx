import { LoadingState } from '@prisme/ui';

export default function ReviewLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Reviews</h1>
        <p className="text-sm text-ink-secondary">Reading what is open…</p>
      </div>
      <LoadingState rows={4} label="Loading the reviews" />
    </div>
  );
}
