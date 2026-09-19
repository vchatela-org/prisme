'use client';

import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import type { AreaKind } from '../tokens/area-color.js';
import { useAreaColorClass } from './area-color-context.js';

export interface AreaBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** The stable key. The colour comes from this, never from list position. */
  areaKey: string;
  /** The display name. Always rendered — see the note below. */
  name: string;
  kind?: AreaKind;
  size?: 'sm' | 'md';
}

/**
 * An area, wherever it appears: a table cell, a chart legend, an initiative
 * header.
 *
 * **The name is not optional, and the swatch is never the only channel.**
 * Three of the eight light-mode slots sit below 3:1 against the surface, which
 * the `dataviz` skill permits *only* with relief — a visible label or a table
 * view. So this component is a dot plus text, always, and the text wears an
 * ink token rather than the area's colour: a light hue is illegible as text,
 * and identity is meant to come from the mark beside the words.
 */
export function AreaBadge({
  areaKey,
  name,
  kind = 'area',
  size = 'md',
  className,
  ...props
}: AreaBadgeProps) {
  const colorClass = useAreaColorClass(areaKey, kind);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-ink',
        size === 'sm' ? 'text-xs' : 'text-sm',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('shrink-0 rounded-full', size === 'sm' ? 'size-2' : 'size-2.5', colorClass)}
      />
      {name}
    </span>
  );
}

/**
 * The swatch alone, for a legend row or a chart key that already carries its
 * label in an adjacent cell. Marked `aria-hidden` for the same reason: it says
 * nothing a screen reader can use.
 */
export function AreaSwatch({
  areaKey,
  kind = 'area',
  className,
  ...props
}: Omit<ComponentProps<'span'>, 'children'> & { areaKey: string; kind?: AreaKind }) {
  const colorClass = useAreaColorClass(areaKey, kind);
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2.5 shrink-0 rounded-full', colorClass, className)}
      {...props}
    />
  );
}
