/**
 * The Signals lane label (ADR-0041).
 *
 * Automations write their tasks — a digest, a change alert, an appliance's
 * reminder — into ordinary area sections, and `area_mapping` is a location. So
 * the lane a task was in could only ever be its location's, and machine-made
 * noise was counted as an area's work. The owner chose a label: a task wearing
 * the label chosen on Settings is in the Signals lane **wherever it sits**.
 *
 * Pure, and the one place the rule is written: the backfill's attribution and
 * the adoption scan both ask it, so a completion and an open task cannot be
 * placed by two readings of the same setting.
 *
 * The label beats the location **for Signals only**. It never moves work into
 * an area or into Run, and with no setting chosen it answers nothing, so
 * attribution is by location exactly as it was.
 */

/** `signals_label_setting`, as the sync reads it. No row: `undefined`. */
export interface SignalsLabel {
  /** The label's name, as the task tool spells it. Instance data at runtime. */
  readonly label: string;
  /** The Signals lane a labelled task belongs to. */
  readonly areaKey: string;
}

/**
 * The Signals lane a task belongs to by its labels, or `undefined` when the
 * label says nothing and its location decides.
 *
 * `undefined` too when the setting names an area that is not — or is no
 * longer — a Signals lane. The API refuses that on the way in; an area's kind
 * changing afterwards is answered by ignoring the label rather than by putting
 * noise into an area.
 */
export function signalsAreaByLabel(
  labels: readonly string[] | undefined,
  setting: SignalsLabel | undefined,
  kindOf: (areaKey: string) => string | undefined,
): string | undefined {
  if (setting === undefined || labels === undefined) return undefined;
  if (!labels.includes(setting.label)) return undefined;
  return kindOf(setting.areaKey) === 'signals' ? setting.areaKey : undefined;
}
