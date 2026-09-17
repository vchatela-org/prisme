import type { InitiativeStatus } from '@prisme/domain';
import {
  Archive,
  CircleCheck,
  CircleDot,
  CirclePause,
  Eye,
  Inbox,
  ListTodo,
  Play,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/**
 * The eight initiative statuses (docs/10-model.md §5), typed from the domain
 * so that adding one there is a compile error here rather than a chip that
 * silently renders blank.
 *
 * ## Why these are not the status palette
 *
 * `status-good`/`warning`/`serious`/`critical` are a *severity* scale with
 * reserved meaning. An initiative's status is not a severity — `later` is not
 * a warning and `dropped` is not a failure. Spending the status colours here
 * would leave nothing to say "this deadline is at risk" with, and would make
 * every backlog look like an incident board. So the chips are ink and surface,
 * with `now` alone carrying the accent, because "what am I doing now" is the
 * one thing the eye should find immediately.
 *
 * Each chip pairs an icon with its label, so the distinction never rests on
 * colour.
 */
const STATUS_META: Record<InitiativeStatus, { label: string; icon: ReactNode; className: string }> =
  {
    inbox: {
      label: 'Inbox',
      icon: <Inbox />,
      className: 'border-border-hairline bg-surface-page text-ink-secondary',
    },
    later: {
      label: 'Later',
      icon: <CirclePause />,
      className: 'border-border-hairline bg-surface-page text-ink-secondary',
    },
    next: {
      label: 'Next',
      icon: <ListTodo />,
      className: 'border-border-strong bg-surface-raised text-ink',
    },
    now: {
      label: 'Now',
      icon: <Play />,
      className: 'border-transparent bg-accent-solid text-ink-on-accent',
    },
    waiting: {
      label: 'Waiting',
      icon: <CircleDot />,
      className: 'border-border-hairline bg-surface-page text-ink-secondary',
    },
    review: {
      label: 'Review',
      icon: <Eye />,
      className: 'border-border-strong bg-surface-raised text-ink',
    },
    done: {
      label: 'Done',
      icon: <CircleCheck />,
      className: 'border-border-hairline bg-surface-page text-ink-success',
    },
    dropped: {
      label: 'Dropped',
      icon: <Archive />,
      className: 'border-border-hairline bg-surface-page text-ink-muted line-through',
    },
  };

export interface StatusChipProps extends Omit<ComponentProps<'span'>, 'children'> {
  status: InitiativeStatus;
  /** Hide the word and keep the icon. The label stays available to readers. */
  iconOnly?: boolean;
}

export function StatusChip({ status, iconOnly = false, className, ...props }: StatusChipProps) {
  const meta = STATUS_META[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
        'text-xs font-medium whitespace-nowrap [&_svg]:size-3',
        meta.className,
        className,
      )}
      {...props}
    >
      {meta.icon}
      <span className={iconOnly ? 'sr-only' : undefined}>{meta.label}</span>
    </span>
  );
}

/** The display name for a status, for a table cell or a select option. */
export function statusLabel(status: InitiativeStatus): string {
  return STATUS_META[status].label;
}
