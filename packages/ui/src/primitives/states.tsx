import { CircleSlash, Inbox, Lock, TriangleAlert } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';
import { Skeleton } from './skeleton.js';

interface StateProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: string;
  /**
   * Required, deliberately. A first-run empty screen that says "Nothing here"
   * and stops is the most common way a tool fails on day one — it has to say
   * how to fill it.
   */
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}

function Shell({ title, description, action, icon, className, children, ...props }: StateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong',
        'px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      <div className="text-ink-muted [&_svg]:size-6">{icon}</div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium text-ink">{title}</p>
        <p className="max-w-prose text-sm text-ink-secondary">{description}</p>
      </div>
      {children}
      {action}
    </div>
  );
}

export function EmptyState(props: StateProps) {
  return <Shell icon={<Inbox />} {...props} />;
}

/**
 * Errors carry no secrets: `detail` is for a correlation id or a short cause,
 * never a token, a header or a connection string (CLAUDE.md §4). The retry is
 * the point — an error state with no way forward is a dead end.
 */
export function ErrorState({
  detail,
  onRetry,
  ...props
}: StateProps & { detail?: string; onRetry?: () => void }) {
  return (
    <Shell
      icon={<TriangleAlert className="text-status-critical" />}
      role="alert"
      action={
        props.action ??
        (onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined)
      }
      {...props}
    >
      {detail ? <p className="font-mono text-xs text-ink-muted">{detail}</p> : null}
    </Shell>
  );
}

/**
 * Deny-by-default means a reader meets this screen occasionally and it should
 * not read as a fault. It says what would be needed, and never why it was
 * refused — that reasoning belongs in the audit log, not in the browser.
 */
export function PermissionDeniedState(props: StateProps) {
  return <Shell icon={<Lock />} {...props} />;
}

/** Nothing to show yet because there is nothing *left* — a finished queue. */
export function ClearedState(props: StateProps) {
  return <Shell icon={<CircleSlash className="text-ink-success" />} {...props} />;
}

/**
 * First load only. `aria-busy` and a live label mean a screen reader is told
 * the region is loading instead of hearing a handful of empty boxes.
 */
export function LoadingState({
  rows = 3,
  label = 'Loading',
  className,
  ...props
}: ComponentProps<'div'> & { rows?: number; label?: string }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
      className={cn('flex flex-col gap-2', className)}
      {...props}
    >
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
