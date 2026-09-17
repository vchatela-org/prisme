import type { z } from 'zod';
import type { areaDto, areaWeightDto, areaWeightsDto, balanceDto } from '../dto/area.js';
import type { initiativeDto, projectDto, scoreDto, taskDto } from '../dto/initiative.js';
import type { keyResultDto, measurementDto, objectiveDto } from '../dto/okr.js';
import type { adherenceDto, ritualDto, takeawayDto } from '../dto/lanes.js';
import type {
  adoptionEntryDto,
  conflictDto,
  eventDto,
  reviewSessionDto,
  settingsDto,
  syncRunDto,
  syncStatusDto,
} from '../dto/ops.js';
import type {
  backlogDto,
  focusDto,
  focusEntryDto,
  inboxDto,
  kpiDto,
  timelineDto,
} from '../dto/views.js';
import type { ErrorBody, FieldProblem } from '../http/errors.js';
import type { Scope } from '../http/scopes.js';

/**
 * `@prisme/api/client` — the response types, for the web application.
 *
 * Types only: no runtime, no fetch wrapper, no client object. The web tier
 * talks to the API over HTTP and that boundary is parsed there like any other,
 * so what it needs from this package is the *shape* it can expect back — and
 * the shapes are the Zod schemas the router validates against, which means they
 * cannot drift from what the API actually returns.
 *
 * The generated OpenAPI document at `GET /api/v1/openapi.json` describes the
 * same schemas for any caller that is not TypeScript.
 */

export type Area = z.infer<typeof areaDto>;
export type AreaWeight = z.infer<typeof areaWeightDto>;
export type AreaWeights = z.infer<typeof areaWeightsDto>;
export type Balance = z.infer<typeof balanceDto>;

export type Initiative = z.infer<typeof initiativeDto>;
export type Project = z.infer<typeof projectDto>;
export type Score = z.infer<typeof scoreDto>;
export type Task = z.infer<typeof taskDto>;

export type Objective = z.infer<typeof objectiveDto>;
export type KeyResult = z.infer<typeof keyResultDto>;
export type Measurement = z.infer<typeof measurementDto>;

export type Takeaway = z.infer<typeof takeawayDto>;
export type Ritual = z.infer<typeof ritualDto>;
export type Adherence = z.infer<typeof adherenceDto>;

export type ReviewSession = z.infer<typeof reviewSessionDto>;
export type EventLogEntry = z.infer<typeof eventDto>;
export type AdoptionEntry = z.infer<typeof adoptionEntryDto>;
export type Conflict = z.infer<typeof conflictDto>;
export type Settings = z.infer<typeof settingsDto>;
export type SyncStatus = z.infer<typeof syncStatusDto>;
export type SyncRun = z.infer<typeof syncRunDto>;

export type Focus = z.infer<typeof focusDto>;
export type FocusEntry = z.infer<typeof focusEntryDto>;
export type Inbox = z.infer<typeof inboxDto>;
export type Backlog = z.infer<typeof backlogDto>;
export type Timeline = z.infer<typeof timelineDto>;
export type Kpi = z.infer<typeof kpiDto>;

export type { ErrorBody, FieldProblem, Scope };

/** Every list response has this shape, so a caller can page any of them alike. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export const API_BASE_PATH = '/api/v1';
