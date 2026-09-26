'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { failureCopy, type ApiFailure } from '@/lib/api-result';
import { bindingListSchema, bindingSchema, settingsAreaSchema } from '@/lib/contracts';
import { AREA_KEY_PATTERN } from '@/lib/settings-view';

/**
 * Every write the Settings screens make.
 *
 * Beside the screens rather than in `lib/actions.ts` for the reason the Year
 * Review gives for its own: these are made rarely, from one place, and they
 * change what every other screen shows — so each revalidates the whole layout,
 * colours and names included.
 *
 * A server action is a public endpoint: each re-parses its arguments and names
 * every field it sends (`apps/api/CLAUDE.md` non-negotiable 2).
 */

export type SettingsResult =
  | { readonly ok: true; readonly title: string; readonly description: string }
  | { readonly ok: false; readonly title: string; readonly description: string };

const slot = z.number().int().min(1).max(8);

function refused(failure: ApiFailure, what: string, conflict: string): SettingsResult {
  if (failure.status === 409) return { ok: false, title: 'Not saved', description: conflict };
  if (failure.status === 400) {
    return {
      ok: false,
      title: 'Not saved',
      description: `The API refused one of the values for ${what}. Check the form and try again.`,
    };
  }
  const copy = failureCopy(failure, what);
  return { ok: false, title: copy.title, description: copy.description };
}

function everywhere(): void {
  // A name or a colour appears on every screen, so the whole tree is stale.
  revalidatePath('/', 'layout');
}

const createAreaSchema = z.object({
  key: z.string().regex(AREA_KEY_PATTERN),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['area', 'run', 'signals']),
  colorSlot: slot.nullable(),
  runBudgetHoursPerWeek: z.number().min(0).max(168).nullable(),
});

export async function createArea(input: z.input<typeof createAreaSchema>): Promise<SettingsResult> {
  const parsed = createAreaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'That area cannot be created',
      description:
        'It needs a name, and a key of lower-case letters, digits and dashes. A run budget belongs to the Run lane only.',
    };
  }
  const value = parsed.data;
  const body: Record<string, unknown> = {
    key: value.key,
    name: value.name,
    kind: value.kind,
  };
  if (value.colorSlot !== null) body['colorSlot'] = value.colorSlot;
  if (value.kind === 'run' && value.runBudgetHoursPerWeek !== null) {
    body['runBudgetHoursPerWeek'] = value.runBudgetHoursPerWeek;
  }

  const result = await apiFetch({
    path: '/areas',
    method: 'POST',
    body,
    schema: settingsAreaSchema,
  });
  if (!result.ok) {
    return refused(result, 'this area', `An area with the key “${value.key}” already exists.`);
  }
  everywhere();
  return {
    ok: true,
    title: `${value.name} created`,
    description: 'Now tell prisme where its work lives.',
  };
}

const updateAreaSchema = z.object({
  key: z.string().regex(AREA_KEY_PATTERN),
  name: z.string().trim().min(1).max(200),
  active: z.boolean(),
  colorSlot: slot.nullable(),
  runBudgetHoursPerWeek: z.number().min(0).max(168).nullable().optional(),
});

export async function updateArea(input: z.input<typeof updateAreaSchema>): Promise<SettingsResult> {
  const parsed = updateAreaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      title: 'Not saved',
      description: 'An area needs a name. A run budget is between 0 and 168 hours a week.',
    };
  }
  const value = parsed.data;
  const body: Record<string, unknown> = {
    name: value.name,
    active: value.active,
    colorSlot: value.colorSlot,
  };
  if (value.runBudgetHoursPerWeek !== undefined) {
    body['runBudgetHoursPerWeek'] = value.runBudgetHoursPerWeek;
  }

  const result = await apiFetch({
    path: `/areas/${encodeURIComponent(value.key)}`,
    method: 'PATCH',
    body,
    schema: settingsAreaSchema,
  });
  if (!result.ok)
    return refused(result, 'this area', 'The area changed while you were editing it.');
  everywhere();
  return { ok: true, title: 'Saved', description: `${value.name} is updated everywhere.` };
}

const mappingsSchema = z.object({
  key: z.string().regex(AREA_KEY_PATTERN),
  mappings: z
    .array(
      z.object({
        externalProjectId: z.string().min(1).max(200),
        externalSectionId: z.string().min(1).max(200).nullable(),
        isHome: z.boolean(),
      }),
    )
    .max(200),
});

export async function saveMappings(input: z.input<typeof mappingsSchema>): Promise<SettingsResult> {
  const parsed = mappingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, title: 'Not saved', description: 'That list of locations is not valid.' };
  }
  const homes = parsed.data.mappings.filter((mapping) => mapping.isHome).length;
  if (homes > 1) {
    return {
      ok: false,
      title: 'Not saved',
      description: 'New work for an area goes to one place: choose a single home.',
    };
  }

  const result = await apiFetch({
    path: `/areas/${encodeURIComponent(parsed.data.key)}/mappings`,
    method: 'PUT',
    body: {
      mappings: parsed.data.mappings.map((mapping) => ({
        externalProjectId: mapping.externalProjectId,
        ...(mapping.externalSectionId === null
          ? {}
          : { externalSectionId: mapping.externalSectionId }),
        isHome: mapping.isHome,
      })),
    },
    schema: settingsAreaSchema,
  });
  if (!result.ok) {
    return refused(
      result,
      'these locations',
      'One of these locations already belongs to another area. A location belongs to exactly one area — remove it there first.',
    );
  }
  everywhere();
  return {
    ok: true,
    title: 'Locations saved',
    description: 'Capacity is attributed through them from the next pass.',
  };
}

const bindingInputSchema = z.object({
  role: z.string().regex(/^[a-z_]{1,64}$/),
  externalId: z.string().trim().min(1).max(2000).nullable(),
});

export async function saveBinding(
  input: z.input<typeof bindingInputSchema>,
): Promise<SettingsResult & { readonly checkError?: string | null }> {
  const parsed = bindingInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, title: 'Not saved', description: 'Paste a link or an identifier.' };
  }

  const result = await apiFetch({
    path: `/bindings/${encodeURIComponent(parsed.data.role)}`,
    method: 'PUT',
    body: { externalId: parsed.data.externalId },
    schema: bindingSchema,
  });
  if (!result.ok) {
    return refused(
      result,
      'this binding',
      'Another role already reads this store, and this one would create pages inside it. Give page creation a page of its own.',
    );
  }
  revalidatePath('/settings', 'layout');
  if (!result.data.bound)
    return { ok: true, title: 'Unbound', description: 'Nothing reads it now.' };
  return result.data.checkError === null
    ? {
        ok: true,
        title: 'Saved and checked',
        description: `Found “${result.data.title ?? 'untitled'}”.`,
        checkError: null,
      }
    : {
        ok: true,
        title: 'Saved, but not readable yet',
        description: 'See the note beside it.',
        checkError: result.data.checkError,
      };
}

export async function checkBindings(): Promise<SettingsResult> {
  const result = await apiFetch({
    path: '/bindings/check',
    method: 'POST',
    body: {},
    schema: bindingListSchema,
  });
  if (!result.ok) return refused(result, 'the bindings', 'The check could not run.');
  revalidatePath('/settings', 'layout');
  const failing = result.data.items.filter((item) => item.bound && item.checkError !== null).length;
  return failing === 0
    ? { ok: true, title: 'Every binding answered', description: 'Titles are up to date.' }
    : {
        ok: true,
        title: `${String(failing)} binding${failing === 1 ? '' : 's'} could not be read`,
        description: 'See the notes beside them.',
      };
}
