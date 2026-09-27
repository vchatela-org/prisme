import { LoadingState } from '@prisme/ui';

export default function AuditLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Audit</h1>
        <p className="text-sm text-ink-secondary">Reading what prisme sent…</p>
      </div>
      <LoadingState rows={6} label="Loading the audit of outward writes" />
    </div>
  );
}
