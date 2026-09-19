'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { failureCopy, type ApiFailure } from '@/lib/api-result';
import { areaWeightsSchema } from '@/lib/contracts';
import { REQUIRED_SUM_PCT } from '@/lib/year-review';

/**
 * The only write in this workstream: the yearly allocation decision.
 *
 * It lives beside the screen that makes it rather than in `lib/actions.ts`,
 * which is documented as every write the *daily* surfaces can make. This one
 * is made once a year, from one place, and keeping it here also keeps four
 * wave-4 agents out of one file.
 *
 * ## Why this is a loop and not a transaction
 *
 * `PUT /areas/{key}/weights/{year}` sets one area's weight. There is no
 * endpoint that sets a whole allocation at once, so this writes them in turn
 * and **reports what actually landed** — the same shape `transitionMany` uses,
 * for the same reason: an action that stops halfway and says "failed" leaves a
 * reader with no idea which four of their six were written.
 *
 * A partial write is a real state here, not a theoretical one, and it is
 * recoverable: the form is re-entered with what is already stored, so
 * submitting again writes the rest. The weights it would overwrite are the
 * same ones it just wrote.
 *
 * ## The sum is checked again here
 *
 * A server action is a public endpoint — the boundary is the action's
 * arguments, not the form that called it (`lib/actions.ts`). The form blocks
 * the button on an allocation that does not account for the whole capacity;
 * this re-checks it, because the form is not what enforces anything.
 */

const entrySchema = z.object({
  areaKey: z.string().min(1).max(64),
  weightPct: z.number().min(0).max(100),
});

const allocationSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  entries: z.array(entrySchema).min(1).max(64),
});

export type AllocationInput = z.infer<typeof allocationSchema>;

export interface AllocationResult {
  readonly ok: boolean;
  readonly title: string;
  readonly description: string;
  /** How many areas were written. Reported even when the whole thing failed. */
  readonly written: number;
}

function failed(failure: ApiFailure, what: string, written: number): AllocationResult {
  const copy = failureCopy(failure, what);
  return { ok: false, title: copy.title, description: copy.description, written };
}

export async function setYearWeights(input: AllocationInput): Promise<AllocationResult> {
  const parsed = allocationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      written: 0,
      title: 'That allocation cannot be saved',
      description: 'Each area needs a share between 0 and 100, for one calendar year.',
    };
  }

  const keys = new Set(parsed.data.entries.map((entry) => entry.areaKey));
  if (keys.size !== parsed.data.entries.length) {
    return {
      ok: false,
      written: 0,
      title: 'An area appears twice',
      description: 'One area has one share for one year — the pair is the primary key (ADR-0007).',
    };
  }

  const sumPct = parsed.data.entries.reduce((total, entry) => total + entry.weightPct, 0);
  if (Math.round(sumPct) !== REQUIRED_SUM_PCT) {
    return {
      ok: false,
      written: 0,
      title: 'The shares do not account for the whole capacity',
      description: `They add up to ${sumPct.toFixed(0)}%, not ${String(REQUIRED_SUM_PCT)}%. Nothing was written.`,
    };
  }

  let written = 0;
  for (const entry of parsed.data.entries) {
    const result = await apiFetch({
      path: `/areas/${encodeURIComponent(entry.areaKey)}/weights/${String(parsed.data.year)}`,
      method: 'PUT',
      // Named, never spread: a body built from a caller's object is how a
      // field nobody meant to write gets written (`apps/api/CLAUDE.md` §2).
      body: { weightPct: entry.weightPct },
      schema: areaWeightsSchema,
    });

    if (!result.ok) {
      return {
        ...failed(result, 'the year weights', written),
        description:
          written === 0
            ? failureCopy(result, 'the year weights').description
            : `${String(written)} of ${String(parsed.data.entries.length)} areas were written before this failed. ${failureCopy(result, 'the year weights').description} Submitting again writes the rest.`,
      };
    }
    written += 1;
  }

  // Every surface that reads a weight or a balance factor.
  revalidatePath('/');
  revalidatePath('/areas');
  revalidatePath('/kpi');
  revalidatePath('/review/year');

  return {
    ok: true,
    written,
    title: `${String(parsed.data.year)} is allocated`,
    description: `${String(written)} areas set. Every balance factor from here on is measured against this decision, and it is fixed until the next Year Review.`,
  };
}
