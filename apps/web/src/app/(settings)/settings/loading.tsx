import { LoadingState } from '@prisme/ui';

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="text-sm text-ink-secondary">Reading the configuration…</p>
      </div>
      <LoadingState rows={8} label="Loading the settings" />
    </div>
  );
}
