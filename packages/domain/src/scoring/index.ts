import { createRegistry } from './registry.js';
import { wsjfBalanced } from './wsjf-balanced.js';

export * from './compute.js';
export * from './registry.js';
export * from './types.js';
export * from './wsjf-balanced.js';

/**
 * The default registry, with `wsjf-balanced` active.
 *
 * Everything outside this directory reads the active method through here. There
 * is deliberately no export that hands out a method-specific field: the moment
 * one exists, ADR-0006 is true only by habit.
 *
 * `createRegistry()` is exported for tests and for anyone comparing two
 * rankings side by side without disturbing the default.
 */
export const scoringRegistry = createRegistry();

scoringRegistry.register(wsjfBalanced, 'active');
