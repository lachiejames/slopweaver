/**
 * The SETTLE half of a monitor pass: every way an open card is closed, each reported as its own row.
 *
 * A card settles four ways — its subject departed and a replacement went up, a newer card for the same subject
 * supersedes it, a duplicate from a race is repaired, or its own key says its subject is already over
 * ({@link lapsedSettlements}), which every measured pass settles first ({@link heldWhileFiring}). A monitor that
 * holds its card while firing settles only that last one until it clears. `./pass.ts` decides WHEN each applies; this module writes them — and, for a
 * monitor that floats, takes the settled card's note down with it.
 */
import { laterHeld } from "../hand/laterPresses.js";
import { dismissHandNote } from "../hand/note/markers.js";
import { snoozeHeld } from "../hand/snoozeStore.js";
import { appendHandRow } from "../hand/store.js";

import {
  clearedBy,
  departedWhileFiring,
  PUT_DOWN_SETTLE_OPENINGS,
  SUPERSEDED_SETTLE_OPENING,
  steeredBy,
} from "./card.js";
import { openIdsForMonitor } from "./openCards.js";
import { MONITOR_STEP_PREFIX, type MonitorDefinition, occurrenceBase, occurrenceNumber } from "./registry.js";
import type { ClearReading, FiringReading, SteeredReading } from "./types.js";

/**
 * One thing the pass did, or could not do. `held` is a card its subject's own delivery kept back this pass
 * (`./types.ts`'s `MonitorSubject.delivery`) — nothing was posted, and nothing is owed.
 */
export interface PassAction {
  readonly kind: "posted" | "noted" | "settled" | "refused" | "held";
  readonly monitorId: string;
  /** The hand-step id, or the monitor's own id when nothing got as far as a step. */
  readonly stepId: string;
  /** What happened, in one line. */
  readonly detail: string;
}

/** What every settlement one monitor writes in one pass shares. */
interface SettleContext {
  readonly definition: MonitorDefinition;
  readonly fire: boolean;
  readonly home: string;
  readonly nowIso: string;
  readonly postedBy: string;
}

/**
 * Settle ONE step whose subject has left the monitor's condition, or that a newer card for the same subject
 * supersedes.
 *
 * @param definition the monitor the step belongs to
 * @param did what the settlement records; the monitor's own clearing line when omitted
 * @param stepId the open step this settles
 * @param home the state home the register lives under
 * @param nowIso the instant to record
 * @param postedBy which session is running the pass
 * @param fire false decides and writes nothing
 * @returns what happened, as one row
 */
async function settleDeparture({
  definition,
  did = clearedBy({ definition }),
  stepId,
  home,
  nowIso,
  postedBy,
  fire,
}: SettleContext & { did?: string; stepId: string }): Promise<PassAction> {
  const monitorId = definition.id;
  if (!fire) {
    return { detail: `would settle: ${did}`, kind: "settled", monitorId, stepId };
  }
  const settled = await appendHandRow({
    home,
    nowIso,
    row: { bySession: postedBy, did, id: stepId, kind: "settled", settledIso: nowIso },
  });
  if (settled.isErr()) {
    return { detail: settled.error.message, kind: "refused", monitorId, stepId };
  }
  if (definition.floats !== true) {
    return { detail: did, kind: "settled", monitorId, stepId };
  }
  // A floating monitor raised this card's note itself, so it takes the note down with the card — the note the
  // owner needs gone once the repair row is done, not left on their screen over a settled row.
  const closed = dismissHandNote({ home, id: stepId, nowIso });
  if (closed.isErr()) {
    return { detail: `${did}; its note did not close: ${closed.error.message}`, kind: "settled", monitorId, stepId };
  }
  return { detail: did, kind: "settled", monitorId, stepId };
}

/**
 * Settle every open step of one monitor whose key names a subject already over ({@link MonitorDefinition.lapsesAt}).
 *
 * @param definition the monitor whose steps are checked
 * @param openIds every open hand-step id
 * @param home the state home the register lives under
 * @param nowIso the instant a lapse is judged against, and recorded
 * @param postedBy which session is running the pass
 * @param fire false decides and writes nothing
 * @returns one settlement per lapsed step, none for a monitor that declares no lapse
 */
export async function lapsedSettlements({
  definition,
  openIds,
  home,
  nowIso,
  postedBy,
  fire,
}: {
  definition: MonitorDefinition;
  openIds: readonly string[];
  home: string;
  nowIso: string;
  postedBy: string;
  fire: boolean;
}): Promise<readonly PassAction[]> {
  const { lapsesAt } = definition;
  if (lapsesAt === undefined) {
    return [];
  }
  const opening = `${MONITOR_STEP_PREFIX}${definition.prefix}-`;
  const settled: PassAction[] = [];
  for (const stepId of openIdsForMonitor({ openIds, prefix: definition.prefix })) {
    const lapse = lapsesAt({ key: occurrenceBase({ id: stepId }).slice(opening.length) });
    if (lapse === undefined || Date.parse(lapse) > Date.parse(nowIso)) {
      continue;
    }
    const did = `the subject it named was over at ${lapse}, settled with no reading of its source`;
    settled.push(await settleDeparture({ definition, did, fire, home, nowIso, postedBy, stepId }));
  }
  return settled;
}

/**
 * A measured pass's lapsed cards settled, and whether an open card is left — which a firing
 * {@link MonitorDefinition.holdsWhileFiring} monitor holds, and every other monitor folds as usual.
 *
 * @param definition the monitor
 * @param openIds every open hand-step id, of every monitor
 * @param nowIso the instant a lapse is judged against, and recorded
 * @param postedBy which session is running the pass
 * @param fire false decides and writes nothing
 * @param subjectKeys the keys this pass's firing subjects carry, compared through {@link MonitorDefinition.holdRevision}
 * @returns the lapse settlements and, beside a held current card, every other card of this monitor settled as
 *   superseded; `holding` when a card of this monitor is still open past them; and every open id but the lapsed
 *   ones for the pass that re-cuts the card
 */
export async function heldWhileFiring({
  definition,
  fire,
  home,
  nowIso,
  openIds,
  postedBy,
  subjectKeys,
}: {
  definition: MonitorDefinition;
  fire: boolean;
  home: string;
  nowIso: string;
  openIds: readonly string[];
  postedBy: string;
  subjectKeys: readonly string[];
}): Promise<{ lapsed: readonly PassAction[]; holding: boolean; openIds: readonly string[] }> {
  const lapsed = await lapsedSettlements({ definition, fire, home, nowIso, openIds, postedBy });
  // A settle the register refused leaves its card open, so it is still held rather than joined by a second one.
  const gone = new Set(lapsed.filter((action) => action.kind === "settled").map((action) => action.stepId));
  const rest = openIds.filter((id) => !gone.has(id));
  const open = [...openIdsForMonitor({ openIds: rest, prefix: definition.prefix })];
  const { holdRevision } = definition;
  if (holdRevision === undefined) {
    return { holding: open.length > 0, lapsed, openIds: rest };
  }
  // A held card is held only while it was cut for the same revision of what the subject is about: a card cut
  // before a plan was paused or resumed would otherwise stand for ever over a fleet it no longer describes.
  // A lapsed card whose settle was refused holds whatever its revision, or the pass would open a second beside it.
  const stuck = lapsed.some((action) => action.kind === "refused");
  const opening = `${MONITOR_STEP_PREFIX}${definition.prefix}-`;
  const wanted = new Set(subjectKeys.flatMap((key) => revisionsOf({ holdRevision, key })));
  const isCurrent = (stepId: string): boolean =>
    revisionsOf({ holdRevision, key: occurrenceBase({ id: stepId }).slice(opening.length) }).some((revision) =>
      wanted.has(revision),
    );
  if (!open.some(isCurrent)) {
    return { holding: stuck, lapsed, openIds: rest };
  }
  // The current card is held, and every other card of this monitor still open beside it — a legacy key, or a stale
  // revision whose supersede the register refused — is settled now, so holding never keeps one alive to its hour.
  const did = "superseded by the card cut for the fleet as it stands, which stays open";
  const tried = new Set(lapsed.map((action) => action.stepId));
  const superseded: PassAction[] = [];
  for (const stepId of open.filter((candidate) => !isCurrent(candidate) && !tried.has(candidate))) {
    superseded.push(await settleDeparture({ definition, did, fire, home, nowIso, postedBy, stepId }));
  }
  return { holding: true, lapsed: [...lapsed, ...superseded], openIds: rest };
}

/** A key's hold revision as a zero- or one-element list, so a key carrying none matches nothing. */
function revisionsOf({
  holdRevision,
  key,
}: {
  holdRevision: NonNullable<MonitorDefinition["holdRevision"]>;
  key: string;
}): readonly string[] {
  const revision = holdRevision({ key });
  return revision === undefined ? [] : [revision];
}

/**
 * Settle every card whose replacement this pass recorded: a departed subject's, and a returned subject's old
 * ones, superseded by its fresh occurrence.
 *
 * @param departed the bases whose subject left the reading
 * @param openByBase every open card, grouped by the base id it is an occurrence of
 * @param replacedBy the ids this pass posted
 * @param returned the bases that came back and were re-posted
 * @param settle what every settlement this monitor writes shares
 * @returns one settlement per card
 */
export async function settleReplaced({
  departed,
  openByBase,
  reading,
  replacedBy,
  returned,
  settle,
}: {
  departed: readonly string[];
  openByBase: ReadonlyMap<string, readonly string[]>;
  reading: FiringReading | ClearReading | SteeredReading;
  replacedBy: readonly string[];
  returned: ReadonlySet<string>;
  settle: SettleContext;
}): Promise<PassAction[]> {
  const { definition } = settle;
  const did = settledLine({ definition, reading, replacedBy });
  // A card the owner put down — snoozed, or a Later from the ledger — says so FIRST, so a monitor that holds the owner's closes by
  // what the row says (`./meetingPrepDue.ts` `dismissedKeys`) holds this one too: the entry is pruned once the card
  // closes.
  const actions: PassAction[] = [];
  for (const stepId of departed.flatMap((base) => openByBase.get(base)!)) {
    const line = putDownLine({ did, home: settle.home, stepId });
    actions.push(await settleDeparture({ ...settle, did: line, stepId }));
  }
  for (const base of returned) {
    // A per-subject monitor settles while one subject's re-post is HELD (`./pass.ts`), so a returned base with no
    // replacement this pass keeps its card: nothing newer exists to supersede it.
    const replacement = replacedBy.find((id) => occurrenceBase({ id }) === base);
    if (replacement === undefined) {
      continue;
    }
    const superseded = `${SUPERSEDED_SETTLE_OPENING}${replacement}, a newer card for the same subject`;
    for (const stepId of openByBase.get(base)!) {
      actions.push(await settleDeparture({ ...settle, did: superseded, stepId }));
    }
  }
  return actions;
}

/**
 * A departed card's settle line, opened with the owner's own press when the owner had put its note down.
 *
 * @param did the line the departure records otherwise
 * @param stepId the departed card
 * @returns the line the settled row records
 */
function putDownLine({ did, home, stepId }: { did: string; home: string; stepId: string }): string {
  if (snoozeHeld({ home, id: stepId })) {
    return `${PUT_DOWN_SETTLE_OPENINGS.snoozed}${did}`;
  }
  if (laterHeld({ home, id: stepId })) {
    return `${PUT_DOWN_SETTLE_OPENINGS.later}${did}`;
  }
  return did;
}

/**
 * What a departed card's settlement records, by the reading that departed it.
 *
 * @param reading the monitor's reading this pass
 * @param replacedBy the ids this pass posted
 * @returns the sentence the settled row records
 */
function settledLine({
  definition,
  reading,
  replacedBy,
}: {
  definition: MonitorDefinition;
  reading: FiringReading | ClearReading | SteeredReading;
  replacedBy: readonly string[];
}): string {
  if (reading.state === "firing") {
    return departedWhileFiring({ definition, replacedBy });
  }
  if (reading.state === "steered") {
    return steeredBy({ steers: reading.steers });
  }
  return clearedBy({ definition });
}

/**
 * A subject still current with more than one open card keeps its newest and settles the rest, whatever else
 * the pass does: one card stays open for it either way, so this can only ever repair a race.
 *
 * @param departed the bases whose subject left — their cards all settle as departures instead
 * @param openByBase every open card, grouped by the base id it is an occurrence of
 * @param settle what every settlement this monitor writes shares
 * @returns one settlement per superseded card
 */
export async function settleDuplicates({
  departed,
  openByBase,
  settle,
}: {
  departed: ReadonlySet<string>;
  openByBase: ReadonlyMap<string, readonly string[]>;
  settle: SettleContext;
}): Promise<PassAction[]> {
  const actions: PassAction[] = [];
  for (const [base, ids] of openByBase) {
    if (departed.has(base) || ids.length < 2) {
      continue;
    }
    const [keep, ...extra] = ids.toSorted((a, b) => occurrenceNumber({ id: b }) - occurrenceNumber({ id: a }));
    const did = `superseded by ${keep!}, a newer card for the same subject`;
    for (const stepId of extra) {
      actions.push(await settleDeparture({ ...settle, did, stepId }));
    }
  }
  return actions;
}
