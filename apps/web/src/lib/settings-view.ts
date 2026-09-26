import type { AreaColorOverrides, SeriesSlot } from '@prisme/ui/server';
import type { Binding, SettingsArea, TaskLocations } from './contracts';

/**
 * What the Settings screens say, and the joins they make — pure, so it is
 * tested rather than eyeballed.
 *
 * Nothing here decides anything prisme's domain decides. It names things for a
 * person: which role is which, what a failed check means, and which project an
 * identifier is.
 */

// ---------------------------------------------------------------------------
// Roles, in words
// ---------------------------------------------------------------------------

export interface RoleCopy {
  /** What a person calls it. */
  readonly label: string;
  /** What prisme does with it, today — not what the design might one day. */
  readonly use: string;
  /** What to point it at. */
  readonly bind: string;
  readonly group: 'read' | 'pages' | 'templates';
}

export const ROLE_COPY: Readonly<Record<string, RoleCopy>> = {
  objectives_db: {
    label: 'Objectives',
    use: 'Read. Its rows are proposed as key results in Adoption.',
    bind: 'Your objectives database.',
    group: 'read',
  },
  takeaways_db: {
    label: 'Takeaways',
    use: 'Read. Its rows are proposed in Adoption; an action-type takeaway can become an initiative.',
    bind: 'The database where you keep ideas from books and articles.',
    group: 'read',
  },
  media_db: {
    label: 'Media library',
    use: 'Read, for context. Nothing is proposed from it.',
    bind: 'Your books / articles / videos database.',
    group: 'read',
  },
  areas_db: {
    label: 'Life areas',
    use: 'Read, for the narrative behind each area.',
    bind: 'The database holding one page per life area.',
    group: 'read',
  },
  processes_db: {
    label: 'Processes',
    use: 'Read. A ritual’s declared duration comes from its process page.',
    bind: 'The database of procedures and routines.',
    group: 'read',
  },
  reviews_db: {
    label: 'Reviews',
    use: 'Reserved. Nothing writes review summaries to the document tool yet.',
    bind: 'Where review summaries should go, once they are written.',
    group: 'read',
  },
  initiative_pages_db: {
    label: 'Initiative pages',
    use: '“Create page” on an initiative adds a page here. prisme never edits a page after creating it.',
    bind: 'A page you create for the purpose — not an existing database you maintain.',
    group: 'pages',
  },
  project_pages_db: {
    label: 'Project pages',
    use: 'The new-project flow adds a page here.',
    bind: 'A dedicated page; it may be the same one as initiative pages.',
    group: 'pages',
  },
  capture_pages_db: {
    label: 'Capture pages',
    use: 'A quick capture that asks for a page adds it here.',
    bind: 'A dedicated page; it may be the same one as initiative pages.',
    group: 'pages',
  },
  initiative_page_template: {
    label: 'Initiative template',
    use: 'Its top-level blocks are copied into every new initiative page.',
    bind: 'An ordinary page laid out the way a new initiative page should start.',
    group: 'templates',
  },
  project_page_template: {
    label: 'Project template',
    use: 'Copied into every new project page.',
    bind: 'An ordinary page, kept flat — nested blocks are not copied.',
    group: 'templates',
  },
  capture_page_template: {
    label: 'Capture template',
    use: 'Copied into every new capture page.',
    bind: 'An ordinary page, kept flat — nested blocks are not copied.',
    group: 'templates',
  },
};

export function roleCopy(role: string): RoleCopy {
  return (
    ROLE_COPY[role] ?? {
      label: role,
      use: 'A role this screen has no description for.',
      bind: 'See docs/15-runtime.md §2.',
      group: 'read',
    }
  );
}

export const ACCESS_LABEL: Readonly<Record<Binding['access'], string>> = {
  read: 'reads',
  write: 'writes',
  read_write: 'reads and writes',
  create: 'adds pages',
};

/**
 * What a failed check means, as advice. The API sends a failure *kind* and
 * never the tool's own message, so this is the whole explanation a person gets.
 */
export function checkAdvice(kind: string | null): string | null {
  switch (kind) {
    case null:
      return null;
    case 'refused':
      return 'The document tool refused it. Either it is not shared with the prisme integration yet (⋯ → Connections in the tool), or the link is not the kind this role needs.';
    case 'invalid_token':
      return 'The integration token was rejected. That is deployment configuration (DOCTOOL_API_TOKEN), not this binding.';
    case 'rate_limited':
    case 'unavailable':
    case 'transport':
      return 'The document tool did not answer. Check again in a minute.';
    default:
      return `The check failed (${kind}).`;
  }
}

// ---------------------------------------------------------------------------
// Where an area's work lives
// ---------------------------------------------------------------------------

export interface LocationName {
  readonly project: string;
  readonly section: string | null;
  /** False when the task tool could not be read, or no longer has it. */
  readonly known: boolean;
  readonly archived: boolean;
}

/** An identifier, named from the task tool's own list when it is in it. */
export function nameLocation(
  locations: TaskLocations | null,
  projectId: string,
  sectionId: string | null,
): LocationName {
  const project = locations?.projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) {
    return { project: projectId, section: sectionId, known: false, archived: false };
  }
  if (sectionId === null) {
    return { project: project.name, section: null, known: true, archived: project.archived };
  }
  const section = project.sections.find((candidate) => candidate.id === sectionId);
  return {
    project: project.name,
    section: section?.name ?? sectionId,
    known: section !== undefined,
    archived: project.archived || (section?.archived ?? false),
  };
}

/** Which area already holds each location — one location belongs to one area. */
export function holders(areas: readonly SettingsArea[]): ReadonlyMap<string, string> {
  const held = new Map<string, string>();
  for (const area of areas) {
    for (const mapping of area.mappings) {
      held.set(locationKey(mapping.externalProjectId, mapping.externalSectionId), area.key);
    }
  }
  return held;
}

export function locationKey(projectId: string, sectionId: string | null): string {
  return `${projectId}/${sectionId ?? ''}`;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * The colour map the whole application paints with.
 *
 * A colour chosen on the Settings screen wins; an `AREA_COLOR_PINS` entry is
 * next; the key's hash is what `areaColorSlot` falls back to for everything
 * neither names. So an instance that never opens Settings looks exactly as it
 * did.
 */
export function mergedAreaColors(
  pins: AreaColorOverrides,
  areas: readonly Pick<SettingsArea, 'key' | 'colorSlot'>[],
): AreaColorOverrides {
  const merged: Record<string, SeriesSlot> = { ...pins };
  for (const area of areas) {
    if (area.colorSlot !== null) merged[area.key] = area.colorSlot as SeriesSlot;
  }
  return merged;
}

export const SERIES_SLOTS: readonly SeriesSlot[] = [1, 2, 3, 4, 5, 6, 7, 8];

/** A key an area can be created with: what the API's `areaKey` accepts. */
export const AREA_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A key proposed from a name, which the person can still edit. */
export function keyFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
