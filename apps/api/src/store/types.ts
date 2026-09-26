/**
 * The store port: everything the API reads and writes, and nothing about how.
 *
 * The services above it compose these calls with `@prisme/domain`; the one
 * implementation below it is SQL. The split is not ceremony — it is what lets
 * the service layer be the *single* place a rule lives, shared by the REST
 * routes and, when W06 arrives, by the MCP tools. "The MCP tools and the REST
 * routes must share one service layer, or they will disagree"
 * (apps/api/CLAUDE.md §6) is only enforceable if the services are the layer
 * that knows things, and this is the seam that keeps them so.
 *
 * ### Conventions across this file
 *
 * - **Calendar dates are `YYYY-MM-DD` strings.** A deadline is a calendar fact,
 *   and a driver handing back a `Date` at local midnight is how an off-by-one
 *   appears at 23:00 and is gone by morning (the same reasoning, and the same
 *   bug, as apps/sync/src/state/postgres.ts).
 * - **Instants are `Date`.** They are compared and bucketed, never displayed
 *   from here; the DTO layer formats them.
 * - **Nothing here is a row.** Every shape is named, camel-cased and explicit,
 *   so a new column does not arrive at the boundary by accident.
 */

export type CalendarDateText = string;

export interface AreaRecord {
  readonly key: string;
  readonly name: string;
  readonly kind: 'area' | 'run' | 'signals';
  readonly active: boolean;
  readonly externalPageId: string | null;
  readonly runBudgetHoursPerWeek: number | null;
  /** 1–8, chosen on the Settings screen. `null`: the environment's pin, else the key's hash. */
  readonly colorSlot: number | null;
}

export interface AreaMappingRecord {
  readonly areaKey: string;
  readonly externalProjectId: string;
  readonly externalSectionId: string | null;
  /** Where prisme creates new work for the area. At most one per area. */
  readonly isHome: boolean;
}

/** One mapping as a write names it. */
export interface AreaMappingInput {
  readonly externalProjectId: string;
  readonly externalSectionId?: string | undefined;
  readonly isHome?: boolean | undefined;
}

export interface RoleBindingRecord {
  readonly role: string;
  readonly externalId: string;
  readonly title: string | null;
  readonly linkId: string | null;
  readonly checkedAt: Date | null;
  /** A connector failure kind, never an upstream message. */
  readonly checkError: string | null;
}

export interface AreaWeightRecord {
  readonly areaKey: string;
  readonly year: number;
  readonly weightPct: number;
}

/**
 * One area's week, as the backfill materialised it.
 *
 * `minutes` is the sum of the three sources by a table CHECK constraint, so the
 * split is a partition rather than a second opinion — which is what lets the
 * balance response state how much of a reading rests on estimates rather than
 * on measurements (docs/12-scoring.md §4).
 */
export interface CapacityWeekRecord {
  readonly weekStart: CalendarDateText;
  readonly areaKey: string;
  readonly completions: number;
  readonly minutes: number;
  readonly minutesRecorded: number;
  readonly minutesDeclared: number;
  readonly minutesDefault: number;
}

/** Where a backfill run's coverage begins and ends. Both exclusive-free ends. */
export interface BackfillCoverageRecord {
  readonly coveredFrom: Date;
  readonly coveredThrough: Date;
}

export interface CreateAreaInput {
  readonly key: string;
  readonly name: string;
  readonly kind: 'area' | 'run' | 'signals';
  readonly active: boolean;
  readonly externalPageId?: string | undefined;
  readonly runBudgetHoursPerWeek?: number | undefined;
  readonly colorSlot?: number | undefined;
  readonly mappings: readonly AreaMappingInput[];
}

export interface UpdateAreaInput {
  readonly name?: string | undefined;
  readonly active?: boolean | undefined;
  readonly externalPageId?: string | null | undefined;
  readonly runBudgetHoursPerWeek?: number | null | undefined;
  readonly colorSlot?: number | null | undefined;
}

export interface InitiativeRecord {
  readonly id: string;
  readonly title: string;
  readonly areaKey: string;
  readonly projectId: string | null;
  readonly status: string;
  readonly value: number;
  readonly timeCriticality: number;
  readonly risk: number;
  readonly size: number;
  readonly deadline: CalendarDateText | null;
  readonly earliestStart: CalendarDateText | null;
  readonly plannedStart: CalendarDateText | null;
  readonly plannedEnd: CalendarDateText | null;
  readonly externalPageId: string | null;
  readonly externalAnchorId: string | null;
  readonly origin: 'created_in_prisme' | 'adopted';
  readonly doneAt: CalendarDateText | null;
  readonly droppedReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly dependsOn: readonly string[];
}

export interface InitiativeFilter {
  readonly areaKeys?: readonly string[] | undefined;
  readonly statuses?: readonly string[] | undefined;
  readonly projectId?: string | undefined;
  readonly hasDeadline?: boolean | undefined;
  /** Case-insensitive substring of the title. Parameterized, never interpolated. */
  readonly search?: string | undefined;
}

export interface CreateInitiativeInput {
  readonly title: string;
  readonly areaKey: string;
  readonly projectId?: string | undefined;
  readonly status: string;
  readonly value: number;
  readonly timeCriticality: number;
  readonly risk: number;
  readonly size: number;
  readonly deadline?: CalendarDateText | undefined;
  readonly earliestStart?: CalendarDateText | undefined;
  readonly externalPageId?: string | undefined;
  readonly dependsOn: readonly string[];
  /**
   * Always `created_in_prisme` from this API. Adoption binds an existing object
   * and creates nothing (ADR-0010); it arrives through W12, not through here.
   */
  readonly origin: 'created_in_prisme';
}

export interface UpdateInitiativeInput {
  readonly title?: string | undefined;
  readonly areaKey?: string | undefined;
  readonly projectId?: string | null | undefined;
  readonly value?: number | undefined;
  readonly timeCriticality?: number | undefined;
  readonly risk?: number | undefined;
  readonly size?: number | undefined;
  readonly deadline?: CalendarDateText | null | undefined;
  readonly earliestStart?: CalendarDateText | null | undefined;
  readonly externalPageId?: string | null | undefined;
  readonly droppedReason?: string | null | undefined;
}

export interface ScoreRecord {
  readonly initiativeId: string;
  readonly methodId: string;
  readonly methodVersion: number;
  readonly score: number;
  readonly factors: Readonly<Record<string, number>>;
  readonly explain: string;
  readonly computedAt: Date;
}

export interface RollupRecord {
  readonly initiativeId: string;
  readonly totalTaskCount: number;
  readonly completedTaskCount: number;
  readonly lastActivity: Date | null;
}

export interface TaskRecord {
  readonly externalId: string;
  readonly externalParentId: string | null;
  readonly isAnchor: boolean;
  readonly completed: boolean;
  readonly completedAt: Date | null;
  readonly recordedMinutes: number | null;
  readonly due: CalendarDateText | null;
  readonly priority: string | null;
  readonly observedAt: Date;
}

export interface CompletionRecord {
  readonly id: string;
  readonly areaKey: string;
  readonly completedAt: Date;
  readonly recordedMinutes: number | undefined;
}

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly areaKey: string;
  readonly status: string;
  readonly deadline: CalendarDateText | null;
  readonly sections: readonly string[];
  readonly externalPageId: string | null;
  readonly externalProjectId: string | null;
  readonly origin: 'created_in_prisme' | 'adopted';
  readonly initiativeCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ObjectiveRecord {
  readonly id: string;
  readonly title: string;
  readonly type: 'annual' | 'monthly';
  readonly period: string;
  readonly areaKey: string;
  readonly status: string;
  readonly externalPageId: string | null;
  readonly createdAt: Date;
}

export interface KeyResultRecord {
  readonly id: string;
  readonly objectiveId: string;
  readonly statement: string;
  readonly target: number;
  readonly unit: string;
  readonly progressSelf: number;
  readonly externalAnchorId: string | null;
  readonly servedBy: readonly string[];
  readonly measurementCount: number;
  /** Tasks beneath the anchor, for `progressComputed`. Both zero when unbound. */
  readonly taskTotal: number;
  readonly taskDone: number;
  readonly createdAt: Date;
}

export interface MeasurementRecord {
  readonly keyResultId: string;
  readonly observedAt: Date;
  readonly value: number;
  readonly note: string | null;
}

export interface TakeawayRecord {
  readonly id: string;
  readonly kind: 'principle' | 'action';
  readonly externalPageId: string;
  readonly areaKey: string | null;
  readonly promotedTo: string | null;
  readonly observedAt: Date;
}

export interface RitualRecord {
  readonly id: string;
  readonly name: string;
  readonly areaKey: string;
  readonly cadence: 'daily' | 'weekly' | 'monthly';
  readonly targetAdherencePct: number;
  readonly externalPageId: string | null;
}

export interface AdherenceRecord {
  readonly ritualId: string;
  readonly periodStart: CalendarDateText;
  readonly opportunities: number;
  readonly completions: number;
}

export interface ReviewRecord {
  readonly id: string;
  readonly cadence: string;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly checklist: Readonly<Record<string, boolean>>;
  readonly decisions: readonly string[];
  readonly capacitySnapshot: Readonly<Record<string, number>>;
  readonly externalPageId: string | null;
}

export interface EventRecord {
  readonly id: string;
  readonly kind: string;
  readonly entityKind: string;
  readonly entityId: string;
  readonly field: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly actor: 'human' | 'agent' | 'sync';
  readonly occurredAt: Date;
}

export interface AppendEventInput {
  readonly kind:
    | 'score_changed'
    | 'status_changed'
    | 'weight_changed'
    | 'completed'
    | 'sync_action'
    | 'adoption_decision';
  readonly entityKind: string;
  readonly entityId: string;
  readonly field?: string | undefined;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly actor: 'human' | 'agent' | 'sync';
  readonly occurredAt: Date;
}

export interface AdoptionRecord {
  readonly prismeId: string;
  readonly externalKind: string;
  readonly externalId: string;
  readonly matchRule: string;
  readonly confidence: string;
  readonly decidedBy: 'auto' | 'human';
  readonly decidedAt: Date;
  readonly bound: boolean;
}

/**
 * One candidate from the last scan's mirror.
 *
 * Derived data: the scan replaces the table wholesale each run, and nothing a
 * human decided is stored in it (docs/13-migration.md §4).
 */
export interface AdoptionCandidateRecord {
  readonly externalKind: string;
  readonly externalId: string;
  readonly title: string;
  readonly areaKey: string | null;
  readonly proposedKind: string;
  readonly reason: string;
  readonly matchRule: string | null;
  readonly confidence: string | null;
  readonly proposedId: string | null;
  readonly similarity: number | null;
  readonly scannedAt: Date;
}

/**
 * What adopting a candidate did, or why it could not.
 *
 * A refusal is a value rather than a thrown error because it is an **answer**:
 * a key result needs an objective and a ritual needs a cadence, and neither is
 * anywhere in a candidate. The caller gets the sentence, not a stack trace.
 */
export type AdoptOutcome =
  | {
      readonly ok: true;
      readonly prismeId: string;
      readonly kind: string;
      readonly record: AdoptionRecord;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * A capture: a small thing, which stays a task (W15).
 *
 * No estimates and no status, and their absence is the specification. The
 * scored unit is the initiative (ADR-0004); promoting is a separate request,
 * and it is the one that asks for the four numbers.
 */
export interface CaptureRecord {
  readonly id: string;
  readonly title: string;
  readonly areaKey: string;
  readonly externalProjectId: string | null;
  readonly externalSectionId: string | null;
  readonly externalTaskId: string | null;
  readonly promotedTo: string | null;
  readonly promotedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type IntentEntityKind = 'capture' | 'initiative' | 'project';
export type IntentObjectKind = 'task' | 'project' | 'section' | 'page';
export type IntentState = 'pending' | 'satisfied' | 'failed';

export interface CreationIntentRecord {
  readonly id: string;
  readonly entityKind: IntentEntityKind;
  readonly entityId: string;
  readonly tool: 'task' | 'document';
  readonly objectKind: IntentObjectKind;
  readonly ordinal: number;
  readonly draft: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly state: IntentState;
  readonly externalId: string | null;
  readonly requires: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * One row to write into the ledger, before it has an id.
 *
 * `requiresIndex` is positional, resolved to a foreign key by the store as it
 * inserts the batch: a section waits for its project, and neither has an id
 * until the transaction that writes both.
 */
export interface CreationIntentInput {
  readonly tool: 'task' | 'document';
  readonly objectKind: IntentObjectKind;
  readonly ordinal: number;
  readonly draft: Readonly<Record<string, unknown>>;
  readonly requiresIndex?: number | undefined;
}

export interface ConflictRecord {
  readonly id: string;
  readonly entityId: string;
  readonly field: string;
  readonly prismeValue: string | null;
  readonly externalValue: string | null;
  readonly detectedAt: Date;
  readonly resolution: 'prisme_wins' | 'external_wins' | 'unresolved';
  readonly actor: 'sync' | 'human';
}

export interface SyncStateRecord {
  readonly hasTaskToolCursor: boolean;
  readonly documentWatermark: Date | null;
  readonly lastFullPassAt: Date | null;
  readonly updatedAt: Date | null;
  readonly unresolvedConflicts: number;
}

export interface Paged<T> {
  readonly items: readonly T[];
  readonly total: number;
}

export interface PageRequest {
  readonly limit: number;
  readonly offset: number;
}

/** The whole port. One implementation, in `postgres.ts`. */
export interface ApiStore {
  readonly areas: {
    list(): Promise<readonly AreaRecord[]>;
    get(key: string): Promise<AreaRecord | undefined>;
    create(input: CreateAreaInput): Promise<AreaRecord>;
    update(key: string, input: UpdateAreaInput): Promise<AreaRecord | undefined>;
    mappings(): Promise<readonly AreaMappingRecord[]>;
    replaceMappings(
      key: string,
      mappings: readonly AreaMappingInput[],
    ): Promise<readonly AreaMappingRecord[]>;
    weights(year?: number): Promise<readonly AreaWeightRecord[]>;
    putWeight(areaKey: string, year: number, weightPct: number): Promise<number | null>;
  };

  /**
   * `role_binding` — which document-tool store each role key names, and what a
   * check last found there. Instance data end to end: nothing read through this
   * port is logged.
   */
  readonly bindings: {
    list(): Promise<readonly RoleBindingRecord[]>;
    put(record: RoleBindingRecord): Promise<void>;
    remove(role: string): Promise<boolean>;
  };

  /**
   * The materialised capacity weeks, and how far the backfill has reached (W13).
   *
   * `capacity_week` is derived and disposable: the backfill replaces it wholesale
   * for every week it covers, from the **full** completion record rather than
   * the anchor subtree. It is the only place the duration preference order and
   * the re-attribution from `area_mapping` are applied, which is why the API
   * reads its output rather than re-deriving anything.
   */
  readonly capacity: {
    /** Rows whose week starts in `[from, to)`. Half-open, like every other range here. */
    weeks(from: CalendarDateText, to: CalendarDateText): Promise<readonly CapacityWeekRecord[]>;
    /** `undefined` when no backfill has ever run — a fresh instance. */
    coverage(): Promise<BackfillCoverageRecord | undefined>;
  };

  readonly initiatives: {
    list(filter: InitiativeFilter): Promise<readonly InitiativeRecord[]>;
    get(id: string): Promise<InitiativeRecord | undefined>;
    create(input: CreateInitiativeInput): Promise<InitiativeRecord>;
    update(id: string, input: UpdateInitiativeInput): Promise<InitiativeRecord | undefined>;
    setStatus(id: string, to: string, reason: string | undefined, at: Date): Promise<void>;
    replaceDependencies(id: string, dependsOn: readonly string[]): Promise<void>;
    latestScores(): Promise<readonly ScoreRecord[]>;
    scoreHistory(id: string, limit: number): Promise<readonly ScoreRecord[]>;
    saveScores(scores: readonly ScoreRecord[], activeMethodId: string): Promise<void>;
    rollups(): Promise<readonly RollupRecord[]>;
    tasks(id: string): Promise<readonly TaskRecord[]>;
    completions(since: Date): Promise<readonly CompletionRecord[]>;
  };

  readonly projects: {
    list(areaKey: string | undefined, page: PageRequest): Promise<Paged<ProjectRecord>>;
    get(id: string): Promise<ProjectRecord | undefined>;
    create(input: {
      name: string;
      areaKey: string;
      status: string;
      deadline?: string | undefined;
      sections: readonly string[];
    }): Promise<ProjectRecord>;
    update(
      id: string,
      input: {
        name?: string | undefined;
        areaKey?: string | undefined;
        status?: string | undefined;
        deadline?: string | null | undefined;
        sections?: readonly string[] | undefined;
      },
    ): Promise<ProjectRecord | undefined>;
  };

  /**
   * Captures and the creation ledger (W15).
   *
   * Two methods here are transactions rather than statements, and both for the
   * same reason: the thing being protected is the *pair*. `create` writes the
   * capture and its intents together, so there is never a capture whose task
   * nobody remembers to make; `promote` moves the external reference from the
   * capture to the new initiative, so at no instant do two entities claim the
   * same task and at no instant does neither.
   */
  readonly creations: {
    listCaptures(
      filter: { readonly promoted?: boolean | undefined },
      page: PageRequest,
    ): Promise<Paged<CaptureRecord>>;
    getCapture(id: string): Promise<CaptureRecord | undefined>;
    /**
     * The capture and its intents, in one transaction.
     *
     * `intentsFor` is a **function of the new id**, not a list, and that is
     * load-bearing rather than awkward: a capture's task intent carries a
     * backlink containing the capture's own id, so the intents cannot be
     * planned until the row exists. Taking a list forced the caller to insert
     * first and record second — two transactions — and a real run produced
     * exactly what that allows: captures committed with no intent at all,
     * which is a capture that never becomes a task and nothing ever notices.
     */
    createCapture(input: {
      readonly title: string;
      readonly areaKey: string;
      readonly externalProjectId: string;
      readonly externalSectionId: string | undefined;
      readonly intentsFor: (captureId: string) => readonly CreationIntentInput[];
      readonly keyFor: (slot: string) => string;
    }): Promise<CaptureRecord>;
    /**
     * The capture becomes an initiative that **reuses its task as the anchor**.
     *
     * `externalAnchorId` is set on the new row at insert, which is what makes
     * ADR-0010 guard 2 refuse a create for it — the planner emits one only for
     * `origin = created_in_prisme AND external_ref IS NULL`. The guard is not
     * re-implemented here; it is satisfied.
     *
     * `undefined` when the capture does not exist. A refusal with a reason
     * when it cannot be promoted — already promoted, or its task has not been
     * created yet, in which case there is no anchor to reuse.
     */
    promoteCapture(input: {
      readonly captureId: string;
      readonly title: string;
      readonly areaKey: string | undefined;
      readonly projectId: string | undefined;
      readonly value: number;
      readonly timeCriticality: number;
      readonly risk: number;
      readonly size: number;
      readonly at: Date;
    }): Promise<
      | { readonly ok: true; readonly initiativeId: string }
      | { readonly ok: false; readonly reason: string }
      | undefined
    >;

    /**
     * *Link existing*: bind an object that already exists, creating nothing.
     *
     * The third of ADR-0011's three states, and ADR-0019's. It writes
     * `entity_external_ref` — where guard 1's unique index refuses an object
     * already bound to something else — sets the entity's own reference
     * column, and records the decision in `entity_link` as `manual`, because
     * a human said these two are the same thing and the ledger should say who
     * decided rather than implying a matcher did.
     *
     * A refusal is a value rather than a thrown error: "that object already
     * belongs to something else" is an answer the caller shows to a person.
     */
    linkExternal(input: {
      readonly entityKind: IntentEntityKind;
      readonly entityId: string;
      readonly objectKind: IntentObjectKind;
      readonly externalId: string;
      readonly at: Date;
    }): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;

    intents(
      filter: { readonly state?: IntentState | undefined; readonly entityId?: string | undefined },
      page: PageRequest,
    ): Promise<Paged<CreationIntentRecord>>;
    /**
     * Record intents for an entity that already exists — the *create page*
     * button, and the project flow's structure. Conflicting on the ledger's
     * one-per-slot index updates the row rather than enqueueing a second
     * creation, which is the no-duplicate guard at this level.
     */
    recordIntents(input: {
      readonly entityKind: IntentEntityKind;
      readonly entityId: string;
      readonly intents: readonly CreationIntentInput[];
      readonly keyFor: (slot: string) => string;
    }): Promise<readonly CreationIntentRecord[]>;
    /** Back to `pending`, clearing the error. Refused for one already satisfied. */
    retryIntent(id: string): Promise<CreationIntentRecord | undefined>;
  };

  readonly okr: {
    listObjectives(
      filter: {
        period?: string | undefined;
        areaKey?: string | undefined;
        status?: string | undefined;
      },
      page: PageRequest,
    ): Promise<Paged<ObjectiveRecord>>;
    getObjective(id: string): Promise<ObjectiveRecord | undefined>;
    createObjective(input: {
      title: string;
      type: 'annual' | 'monthly';
      period: string;
      areaKey: string;
      status: string;
      externalPageId?: string | undefined;
    }): Promise<ObjectiveRecord>;
    updateObjective(
      id: string,
      input: {
        title?: string | undefined;
        status?: string | undefined;
        externalPageId?: string | null | undefined;
      },
    ): Promise<ObjectiveRecord | undefined>;
    keyResults(objectiveIds: readonly string[]): Promise<readonly KeyResultRecord[]>;
    getKeyResult(id: string): Promise<KeyResultRecord | undefined>;
    createKeyResult(
      objectiveId: string,
      input: {
        statement: string;
        target: number;
        unit: string;
        progressSelf: number;
        servedBy: readonly string[];
      },
    ): Promise<KeyResultRecord>;
    updateKeyResult(
      id: string,
      input: {
        statement?: string | undefined;
        target?: number | undefined;
        unit?: string | undefined;
        progressSelf?: number | undefined;
        servedBy?: readonly string[] | undefined;
      },
    ): Promise<KeyResultRecord | undefined>;
    addMeasurement(
      keyResultId: string,
      value: number,
      observedAt: Date,
      note: string | undefined,
    ): Promise<void>;
    measurements(keyResultId: string): Promise<readonly MeasurementRecord[]>;
  };

  readonly lanes: {
    takeaways(
      filter: { kind?: string | undefined; promoted?: boolean | undefined },
      page: PageRequest,
    ): Promise<Paged<TakeawayRecord>>;
    getTakeaway(id: string): Promise<TakeawayRecord | undefined>;
    promoteTakeaway(id: string, initiativeId: string): Promise<void>;
    rituals(): Promise<readonly RitualRecord[]>;
    getRitual(id: string): Promise<RitualRecord | undefined>;
    createRitual(input: {
      name: string;
      areaKey: string;
      cadence: string;
      targetAdherencePct: number;
      externalPageId?: string | undefined;
    }): Promise<RitualRecord>;
    updateRitual(
      id: string,
      input: {
        name?: string | undefined;
        cadence?: string | undefined;
        targetAdherencePct?: number | undefined;
        externalPageId?: string | null | undefined;
      },
    ): Promise<RitualRecord | undefined>;
    adherence(
      ritualIds: readonly string[],
      from?: string,
      to?: string,
    ): Promise<readonly AdherenceRecord[]>;
    recordAdherence(record: AdherenceRecord): Promise<void>;
  };

  readonly ops: {
    reviews(cadence: string | undefined, page: PageRequest): Promise<Paged<ReviewRecord>>;
    getReview(id: string): Promise<ReviewRecord | undefined>;
    openReview(cadence: string, startedAt: Date): Promise<ReviewRecord>;
    updateReview(
      id: string,
      input: {
        checklist?: Readonly<Record<string, boolean>> | undefined;
        decisions?: readonly string[] | undefined;
        externalPageId?: string | null | undefined;
        completedAt?: Date | undefined;
        capacitySnapshot?: Readonly<Record<string, number>> | undefined;
      },
    ): Promise<ReviewRecord | undefined>;

    events(
      filter: {
        kind?: string | undefined;
        entityKind?: string | undefined;
        entityId?: string | undefined;
        from?: Date | undefined;
        to?: Date | undefined;
      },
      page: PageRequest,
    ): Promise<Paged<EventRecord>>;
    appendEvent(input: AppendEventInput): Promise<void>;

    adoption(bound: boolean | undefined, page: PageRequest): Promise<Paged<AdoptionRecord>>;
    decideAdoption(input: {
      prismeId: string;
      externalKind: string;
      externalId: string;
      matchRule: string;
      confidence: string;
      decidedAt: Date;
    }): Promise<AdoptionRecord>;

    /** The queue: candidates the scan found, minus everything already decided. */
    adoptionQueue(
      filter: { readonly areaKey?: string | undefined; readonly kind?: string | undefined },
      page: PageRequest,
    ): Promise<Paged<AdoptionCandidateRecord>>;
    /**
     * Adopt a candidate: one entity with `origin = 'adopted'`, and the link to
     * the object that already exists. **Creates nothing outward** — the
     * reconciler binds the reference on its next pass.
     */
    adoptCandidate(input: {
      externalKind: string;
      externalId: string;
      decidedAt: Date;
    }): Promise<AdoptOutcome | undefined>;
    /** Permanently. There is no un-ignore, and the table refuses one. */
    ignoreCandidate(input: {
      externalKind: string;
      externalId: string;
      reason: string | undefined;
      decidedAt: Date;
    }): Promise<AdoptionCandidateRecord | undefined>;

    conflicts(resolution: string | undefined, page: PageRequest): Promise<Paged<ConflictRecord>>;
    resolveConflict(id: string, resolution: string): Promise<ConflictRecord | undefined>;

    syncState(): Promise<SyncStateRecord>;
  };
}
