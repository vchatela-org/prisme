/**
 * `@prisme/domain` — the business rules, and the only place they live.
 *
 * Pure throughout: no I/O, no clock, no randomness. `now` and configuration are
 * arguments, never ambient. ESLint enforces that from the repository root
 * rather than leaving it to good intentions — see `packages/domain/CLAUDE.md`.
 *
 * Four things are exported, and the boundaries between them are the model:
 *
 * - `entities/`   the shapes, and the invariants that make an illegal one
 *                 impossible to construct
 * - `capacity/`   what each area actually received, and the balance factor
 *                 that follows from it — **allocate before you rank**
 * - `scoring/`    the pluggable method contract, the registry, `wsjf-balanced`
 * - `selection/`  what to do now, which is a different question from what
 *                 ranks highest
 *
 * Nothing outside `scoring/` reads a method-specific field (ADR-0006). There is
 * no `wsjf` accessor in this file, and there must never be one.
 */

export * from './capacity/index.js';
export * from './entities/index.js';
export * from './scoring/index.js';
export * from './selection/index.js';
export { clamp } from './util/clamp.js';
