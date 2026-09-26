import { ROLE_KEYS } from '@prisme/connectors';
import { z } from 'zod';
import { defineWrite, named } from '../http/schema.js';
import { instant } from './common.js';

/**
 * What the Settings screens read and write that is not an area.
 *
 * Two things live here. The **role bindings** — which document-tool store each
 * of prisme's role keys names — were loadable only from `seed/bindings.json`
 * through a CLI Job; the table they live in is instance data, and these shapes
 * put it in front of its owner. The **task-tool locations** are the projects and
 * sections an area mapping is chosen from, by name, so nobody has to find an
 * identifier in a URL bar to say "my garden work lives here".
 *
 * Both are `admin:` scoped. A binding is an identifier from a real workspace,
 * and reading one is not something an agent with a read token needs.
 */

export const roleKey = z.enum(ROLE_KEYS);

export const bindingDto = z.object({
  role: roleKey,
  /** What the role names in the document tool: a data source, or a page. */
  shape: z.enum(['data_source', 'page']),
  /** What prisme may do through it (packages/connectors/src/role-key.ts). */
  access: z.enum(['read', 'write', 'read_write', 'create']),
  bound: z.boolean(),
  externalId: z.string().nullable(),
  /** The store's title at the last check. */
  title: z.string().nullable(),
  /**
   * What a person opens: the page, or the database holding a data source.
   * Never a URL — the web tier renders it through `DOCTOOL_PAGE_URL_TEMPLATE`.
   */
  linkId: z.string().nullable(),
  checkedAt: instant.nullable(),
  /** A connector failure kind (`refused`, `invalid_token`, …), never an upstream message. */
  checkError: z.string().nullable(),
});

export const bindingListDto = z.object({ items: z.array(bindingDto) });

export const BindingDto = named('Binding', bindingDto);
export const BindingListDto = named('BindingList', bindingListDto);

/**
 * The identifier a person gives, as they are likely to have it.
 *
 * The tool's *Copy link* gives a URL whose last path segment ends in a 32-digit
 * hexadecimal identifier, and the API shows the same identifier dashed. Both are
 * reduced to the dashed form here, so the vendor's URL layout is never
 * interpreted beyond "the identifier is the 32 hex digits in it". Anything else
 * is accepted only as an opaque token — the shape the fixtures and the local
 * harness use.
 */
const HEX_ID = /(?:^|[^0-9a-f])([0-9a-f]{32})(?![0-9a-f])/i;
const DASHED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

export function normaliseDocIdentifier(raw: string): string | undefined {
  const text = raw.trim();
  if (DASHED_ID.test(text)) return text.toLowerCase();
  const hex = HEX_ID.exec(text)?.[1]?.toLowerCase();
  if (hex !== undefined) {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return OPAQUE_ID.test(text) ? text : undefined;
}

export const putBindingBody = defineWrite(
  'PutBinding',
  z.strictObject({
    /**
     * An identifier or a link to the store. `null` unbinds the role, which
     * makes whatever reads it report "not read" rather than guessing.
     */
    externalId: z
      .string()
      .min(1)
      .max(2000)
      .transform((raw, context) => {
        const normalised = normaliseDocIdentifier(raw);
        if (normalised === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'expected a document-tool link or identifier',
          });
          return z.NEVER;
        }
        return normalised;
      })
      .nullable(),
  }),
  {
    title: 'read from the document tool when the binding is checked',
    linkId: 'read from the document tool when the binding is checked',
    checkedAt: 'set by the check',
  },
);

/** Nothing to say: the check re-reads every bound role. */
export const checkBindingsBody = defineWrite('CheckBindings', z.strictObject({}));

export const taskSectionDto = z.object({
  id: z.string(),
  name: z.string(),
  archived: z.boolean(),
});

export const taskProjectDto = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  archived: z.boolean(),
  sections: z.array(taskSectionDto),
});

export const taskLocationsDto = z.object({
  projects: z.array(taskProjectDto),
  /** Why the tool could not be read — a connector failure kind — or `null`. */
  failure: z.string().nullable(),
});

export const TaskLocationsDto = named('TaskLocations', taskLocationsDto);
