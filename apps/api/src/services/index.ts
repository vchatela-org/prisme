import {
  CANDIDATE_CONCURRENT_INITIATIVES,
  CANDIDATE_SELECTION_LIMITS,
  SCHEDULE_DEFAULTS,
  scoringRegistry,
  type Registry,
  type SelectionLimits,
} from '@prisme/domain';
import type { ApiStore } from '../store/types.js';
import type { SyncRunner } from '../sync/port.js';
import { createCatalogueService, type CatalogueService } from './catalogue.js';
import { createLaneService, type LaneService } from './lanes.js';
import { createMeasureService, type MeasureService } from './measure.js';
import { createObjectiveService, type ObjectiveService } from './okr.js';
import { createOpsService, type OpsService } from './ops.js';
import { createWorkService, type WorkService } from './work.js';

/**
 * The service layer, assembled.
 *
 * **One layer, two front doors.** The REST routes call these; W06's MCP tools
 * will call the same objects. That is the whole reason the layer exists — two
 * surfaces implementing the same rule will implement it differently, and the
 * difference will be discovered by a user rather than by a test
 * (apps/api/CLAUDE.md §6).
 *
 * Nothing here reads the environment. Configuration arrives as an argument,
 * already validated by `@prisme/config` at boot, so a service can be
 * constructed in a test with the limits the test cares about.
 */

export interface ServiceConfig {
  readonly timezone: string;
  readonly capacityWindowWeeks: number;
  readonly defaultTaskMinutes: number;
  readonly limits: SelectionLimits;
  readonly concurrentInitiatives: number;
  readonly workingWeekdays: readonly number[];
  readonly sync: {
    readonly enabled: boolean;
    readonly writeEnabled: boolean;
    readonly createThreshold: number;
    readonly windowStart: number;
    readonly windowEnd: number;
  };
}

/**
 * The limits and durations a service runs with when nothing overrides them.
 *
 * Every one of these is a **candidate**, not a decision: OQ-2 is open on the
 * work-in-progress limits, and the concurrency the schedule engine divides
 * between areas is the same human question. They are named here rather than
 * spread through the code so that closing OQ-2 is one edit and one journal
 * entry, not an archaeology exercise.
 */
export const SERVICE_DEFAULTS = {
  limits: CANDIDATE_SELECTION_LIMITS,
  concurrentInitiatives: CANDIDATE_CONCURRENT_INITIATIVES,
  workingWeekdays: SCHEDULE_DEFAULTS.workingWeekdays,
} as const;

export interface Services {
  readonly catalogue: CatalogueService;
  readonly work: WorkService;
  readonly measure: MeasureService;
  readonly objectives: ObjectiveService;
  readonly lanes: LaneService;
  readonly ops: OpsService;
  readonly config: ServiceConfig;
}

export interface CreateServicesOptions {
  readonly store: ApiStore;
  readonly runner: SyncRunner;
  readonly config: ServiceConfig;
  /** Defaults to the shared registry with `wsjf-balanced` active (ADR-0006). */
  readonly registry?: Registry;
}

export function createServices(options: CreateServicesOptions): Services {
  const registry = options.registry ?? scoringRegistry;
  const { store, config } = options;

  const measure = createMeasureService(store, {
    capacityWindowWeeks: config.capacityWindowWeeks,
    defaultTaskMinutes: config.defaultTaskMinutes,
  });

  const work = createWorkService(store, registry, {
    capacityWindowWeeks: config.capacityWindowWeeks,
    defaultTaskMinutes: config.defaultTaskMinutes,
    limits: config.limits,
    concurrentInitiatives: config.concurrentInitiatives,
    workingWeekdays: config.workingWeekdays,
  });

  return {
    catalogue: createCatalogueService(store),
    work,
    measure,
    objectives: createObjectiveService(store),
    lanes: createLaneService(store, work),
    ops: createOpsService(store, registry, measure, options.runner, {
      timezone: config.timezone,
      capacityWindowWeeks: config.capacityWindowWeeks,
      defaultTaskMinutes: config.defaultTaskMinutes,
      concurrentInitiatives: config.concurrentInitiatives,
      workingWeekdays: config.workingWeekdays,
      sync: config.sync,
    }),
    config,
  };
}

export type {
  CatalogueService,
  LaneService,
  MeasureService,
  ObjectiveService,
  OpsService,
  WorkService,
};
