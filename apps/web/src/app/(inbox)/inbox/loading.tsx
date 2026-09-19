import { LoadingState } from '@prisme/ui';

export default function InboxLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Inbox</h1>
        <p className="text-sm text-ink-secondary">Reading what is waiting…</p>
      </div>
      <LoadingState rows={4} label="Loading the inbox" />
    </div>
  );
}
