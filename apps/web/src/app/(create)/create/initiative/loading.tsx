import { LoadingState } from '@prisme/ui';

export default function CreateLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">New initiative</h1>
        <p className="text-sm text-ink-secondary">
          Reading the areas and projects it could belong to…
        </p>
      </div>
      <LoadingState rows={4} label="Loading the form" />
    </div>
  );
}
