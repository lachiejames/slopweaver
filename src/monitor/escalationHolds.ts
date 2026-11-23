/**
 * "WHEN IT GETS WORSE", REMEMBERED — one `$home/hand-steps/escalations/<base>.json` per subject whose note the owner asked
 * to keep down until it reads worse, keyed by the card's occurrence base so a re-cut `.2` of the same subject is the
 * same hold.
 *
 * A hold is TYPED: it is offered only where the monitor declares `worsens` (`./registry.ts`), and it carries the
 * number it is held against. The owner's press cannot know that number — the note is drawn, not measured — so a press
 * writes a `pending` hold and the next fired pass that reads the subject records its measure as the baseline,
 * making it `holding`. From then a pass reading the subject STRICTLY worse raises its note and forgets the hold
 * (`./escalationStage.ts`); a pass reading the monitor clear forgets it, since the subject it held is gone.
 *
 * Fail closed, like the mute store (`./noteMutes.ts`): a record file that stands keeps the note down, read or not.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { type KindAnswerStoreError, MonitorErrors } from "./errors.js";
import { type KindAnswerRead, kindAnswerStore } from "./kindAnswerFiles.js";
import { isMonitorId } from "./registry.js";
import type { MonitorId } from "./types.js";

/** Where a hold stands: waiting for its first measure, or held against one. */
type EscalationState =
  { readonly kind: "pending" } | { readonly kind: "holding"; readonly baseline: number; readonly measuredIso: string };

/** One escalation hold, as the store keeps it. */
export interface EscalationHold {
  /** The card's occurrence base, `mon-<prefix>-<key>` — the subject held. */
  readonly base: string;
  readonly monitorId: MonitorId;
  /** The step whose note the owner pressed it on. */
  readonly stepId: string;
  /** When the owner pressed it, ISO 8601. */
  readonly pressedIso: string;
  readonly state: EscalationState;
}

const HOLDS = kindAnswerStore<EscalationHold>({
  label: "monitor escalation hold",
  name: "escalations",
  parse: parseEscalationHold,
});

/**
 * The hold store's directory.
 *
 * @param home the state home
 * @returns `$home/hand-steps/escalations`
 */
export function escalationDir({ home }: { home: string }): string {
  return HOLDS.dir({ home });
}

/**
 * Record one hold, replacing any earlier one on the same subject.
 *
 * @param home the state home
 * @param hold the hold to keep
 * @returns nothing, or why it would not write
 */
export function recordEscalationHold({
  home,
  hold,
}: {
  home: string;
  hold: EscalationHold;
}): Result<void, KindAnswerStoreError> {
  return HOLDS.record({ home, key: hold.base, value: hold });
}

/**
 * Whether a hold keeps one subject's note down. A record that stands is a hold, read or not.
 *
 * @param home the state home
 * @param base the card's occurrence base
 * @returns true while its record stands
 */
export function escalationHeld({ home, base }: { home: string; base: string }): boolean {
  return HOLDS.stands({ home, key: base });
}

/**
 * Forget one subject's hold: it got worse and its note came back, or the subject cleared.
 *
 * @param home the state home
 * @param base the card's occurrence base
 * @returns whether a hold stood, or why it would not go
 */
export function forgetEscalationHold({
  home,
  base,
}: {
  home: string;
  base: string;
}): Result<boolean, KindAnswerStoreError> {
  return HOLDS.forget({ home, key: base });
}

/**
 * Every hold the store holds, and every file that would not read.
 *
 * @param home the state home
 * @returns the holds, sorted by subject
 */
export function readEscalationHolds({ home }: { home: string }): KindAnswerRead<EscalationHold> {
  return HOLDS.read({ home });
}

/**
 * Check one hold record. A record naming a subject other than its file's is refused.
 *
 * @param object what the record file held
 * @param key the occurrence base its file name says
 * @param path the record file, named in a refusal
 * @returns the hold, or why it would not read
 */
function parseEscalationHold({
  object,
  key,
  path,
}: {
  object: Record<string, unknown>;
  key: string;
  path: string;
}): Result<EscalationHold, KindAnswerStoreError> {
  const { base, monitorId, stepId, pressedIso, state } = object;
  const refuse = ({ cause }: { cause: string }): Result<EscalationHold, KindAnswerStoreError> =>
    err(MonitorErrors.kindAnswerStore({ cause, path }));
  if (base !== key) {
    return refuse({ cause: `the record names subject ${String(base)}, not its file's ${key}` });
  }
  if (typeof monitorId !== "string" || !isMonitorId(monitorId)) {
    return refuse({ cause: `"${String(monitorId)}" is not a declared monitor` });
  }
  if (typeof stepId !== "string" || stepId.length === 0) {
    return refuse({ cause: "the record names no step" });
  }
  if (typeof pressedIso !== "string" || Number.isNaN(Date.parse(pressedIso))) {
    return refuse({ cause: "the record's press instant is not a date" });
  }
  const checked = escalationStateOf({ state });
  if (checked === undefined) {
    return refuse({ cause: "the record's state is neither pending nor holding against a number" });
  }
  return ok({ base: key, monitorId, pressedIso, state: checked, stepId });
}

/**
 * A stored state, checked.
 *
 * @param state the record's `state` field as parsed
 * @returns the state, or undefined when it is neither shape
 */
function escalationStateOf({ state }: { state: unknown }): EscalationState | undefined {
  if (!isRecord(state)) {
    return undefined;
  }
  const { kind, baseline, measuredIso } = state;
  if (kind === "pending") {
    return { kind: "pending" };
  }
  const measured = typeof measuredIso === "string" && !Number.isNaN(Date.parse(measuredIso));
  if (kind === "holding" && typeof baseline === "number" && Number.isFinite(baseline) && measured) {
    return { baseline, kind: "holding", measuredIso };
  }
  return undefined;
}
