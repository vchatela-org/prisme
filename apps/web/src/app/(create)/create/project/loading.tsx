import { LoadingState } from '@prisme/ui';

export default function CreateLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">New project</h1>
        <p className="text-sm text-ink-secondary">Reading the areas it could belong to…</p>
      </div>
      <LoadingState rows={4} label="Loading the form" />
    </div>
  );
}
