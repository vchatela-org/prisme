import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, last-wins on conflicts.
 *
 * `clsx` flattens conditionals; `tailwind-merge` resolves the conflicts that
 * flattening leaves behind, so a caller's `px-6` beats a component's default
 * `px-3` instead of landing in the same class list and losing to whichever
 * Tailwind emitted first. Every component here ends its class list with the
 * caller's `className` for exactly this reason: overriding a component should
 * not require a fork.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
