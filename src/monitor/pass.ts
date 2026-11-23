/**
 * One pass: read every monitor, fold arrivals against the register, post what is new, settle what cleared.
 *
 * The effectful half of the lane, and deliberately thin — every decision it takes is made by a pure function
 * it calls (`./evaluate.ts`, `./arrival.ts`, `./card.ts`), so what is left here is ordering and I/O.
 *
 * ## The order is READ, POST, SETTLE, and each step is separately reported
 *
 * A pass that failed halfway must leave a reader able to say what it did. So the outcome carries every
 * posting, every settling and every refusal as its own row rather than one exit code: rule 6's failure mode
 * is a run that stopped somewhere and said nothing, and a monitor lane that could do that would be the joke
 * version of itself.
 *
 * ## Posting is QUIET, and the banner is `hand push`'s job — except for a monitor that FLOATS
 *
 * `hand post` draws the floating note by default, which is right for one step a session posts by hand and
 * wrong for a sweep: a first pass over twenty parked runs would put twenty panels on the owner's screen at once.
 * The lane posts quietly and leaves the single arrival banner to `slopweaver hand push`, which already
 * collapses an outstanding set into one notification and already reads no clock.
 *
 * A monitor declaring `floats` (`recipe-stopped`, `corpus-sync-stopped` and the
 * `recipe-repairing` notice) has each newly posted step's note raised through the injected
 * {@link NoteRaiser}: every arrival's note stacks in front of the notes already up, in the next cascade slot, at the
 * monitor's own window level. A raise that fails never takes the recorded step back — it is reported as its own
 * `refused` row. Settling a floating monitor's card takes its note down (`./passSettle.ts`).
 *
 * Posting an arrival is `./passPost.ts`; every way a card SETTLES is `./passSettle.ts`; this module decides when
 * each applies.
 */
import { foldOpenCards } from "./openCards.js";
import { arrivalActions, type NoteRaiser, type PageOpener } from "./passPost.js";
import { heldWhileFiring, lapsedSettlements, type PassAction, settleDuplicates, settleReplaced } from "./passSettle.js";
import { type MonitorDefinition, monitorDefinition } from "./registry.js";
import { type MonitorInputs, readAllMonitors } from "./sources.js";
import type { ClearReading, FiringReading, MonitorReading, SteeredReading, UnmeasurableReading } from "./types.js";

export { monitorNoteLevel, type NoteRaiser, type PageOpener } from "./passPost.js";

/** Everything one pass saw and did. */
export interface PassOutcome {
  readonly readings: readonly MonitorReading[];
  readonly actions: readonly PassAction[];
}

/** Why a fired pass that lost its lease wrote nothing more for a reading. */
const LEASE_LOST =
  "this pass ran past its fired-pass lease and a later pass took it over, so it wrote nothing for this monitor — the later pass answers it";

/**
 * Run one pass.
 *
 * @param inputs the home, the instant, and any document handed in
 * @param nowIso the instant to record on every row this pass writes
 * @param postedBy which session is running it — provenance, never proof
 * @param fire whether to WRITE: false reads and decides without touching the register
 * @param openIds every open hand-step id, read by the caller so this stays one register read per pass
 * @param openWithDecision the open ids whose recorded step carries a decision, off that same read
 * @param postedIds every posted hand-step id, open or settled, off that same read — the append guard refuses a card
 * beside an occurrence of it this read never saw (`./passPost.ts`)
 * @param raiseNote draws the note for a floating monitor's newly posted step — never called without `fire`
 * @param openPage opens the page a newly posted step carries as `opened` — never called without `fire`
 * @param consoleBase the console origin every posted card's own link opens on (`hand/consoleLink.ts`)
 * @param stillHeld the fired-pass lease's fence, checked before each reading's writes: once a later pass took the
 * lease over, this one writes nothing more (`./firedPassLock.ts`) — always held for a rehearsal, which writes nothing
 * @returns every reading and every action
 */
export async function runMonitorPass({
  inputs,
  nowIso,
  postedBy,
  fire,
  openIds,
  openWithDecision,
  postedIds,
  raiseNote,
  openPage,
  consoleBase,
  stillHeld = () => true,
}: {
  inputs: MonitorInputs;
  nowIso: string;
  postedBy: string;
  fire: boolean;
  openIds: readonly string[];
  openWithDecision: ReadonlySet<string>;
  postedIds: readonly string[];
  raiseNote: NoteRaiser;
  openPage: PageOpener;
  consoleBase: string;
  stillHeld?: () => boolean;
}): Promise<PassOutcome> {
  const readings = await readAllMonitors({ inputs });
  const shared = {
    consoleBase,
    fire,
    home: inputs.home,
    nowIso,
    openIds,
    openPage,
    openWithDecision,
    postedBy,
    postedIds,
    raiseNote,
  };
  // One reading at a time, in the order they were read, so every write lands in the order the pass reports it.
  const actions: PassAction[] = [];
  for (const reading of readings) {
    if (fire && !stillHeld()) {
      actions.push({ detail: LEASE_LOST, kind: "refused", monitorId: reading.monitorId, stepId: reading.monitorId });
      continue;
    }
    actions.push(...(await readingActions({ ...shared, reading })));
  }
  return { actions, readings };
}

/**
 * What one pass does for one monitor's reading, in order.
 *
 * @param openIds every open hand-step id, off the caller's one register read
 * @param postedIds every posted hand-step id, open or settled, off that same read
 * @returns the actions for this reading alone
 */
async function readingActions({
  reading,
  consoleBase,
  fire,
  home,
  nowIso,
  openIds,
  openPage,
  openWithDecision,
  postedBy,
  postedIds,
  raiseNote,
}: {
  reading: MonitorReading;
  consoleBase: string;
  fire: boolean;
  home: string;
  nowIso: string;
  openIds: readonly string[];
  openPage: PageOpener;
  openWithDecision: ReadonlySet<string>;
  postedBy: string;
  postedIds: readonly string[];
  raiseNote: NoteRaiser;
}): Promise<readonly PassAction[]> {
  if (reading.state === "unmeasurable") {
    return unmeasurableActions({ fire, home, nowIso, openIds, postedBy, reading });
  }
  const definition = monitorDefinition({ monitorId: reading.monitorId });
  const refusal = readingShapeRefusal({ definition, reading });
  if (refusal !== undefined) {
    return [{ detail: refusal, kind: "refused", monitorId: reading.monitorId, stepId: reading.monitorId }];
  }
  const measured = {
    consoleBase,
    fire,
    home,
    nowIso,
    openPage,
    openWithDecision,
    postedBy,
    postedIds,
    raiseNote,
    reading,
  };
  if (definition.holdsWhileFiring === true && reading.state !== "firing") {
    return measuredActions({ ...measured, openIds });
  }
  // A lapsed card settles first on EVERY measured pass, not only an unmeasurable one: a partial read departs
  // nothing (`measuredActions`), so a card naming a meeting already under way would otherwise stand until the
  // ledger read whole again. Empty for a monitor that declares no `lapsesAt`.
  const subjectKeys = reading.state === "firing" ? reading.subjects.map((subject) => subject.key) : [];
  const held = await heldWhileFiring({ definition, fire, home, nowIso, openIds, postedBy, subjectKeys });
  if (held.holding && definition.holdsWhileFiring === true) {
    return [...held.lapsed];
  }
  return [...held.lapsed, ...(await measuredActions({ ...measured, openIds: held.openIds }))];
}

/**
 * An unmeasurable reading's refusal, and its lapsed cards settled.
 *
 * No settle on what the read would have said: a monitor that cannot see its source has not observed anything
 * clearing, and settling the owner's open steps on a failed read is the flood's mirror image — silence the owner did not ask
 * for. A step whose own key says its subject is OVER is the one exception, and it reads no source.
 */
async function unmeasurableActions({
  reading,
  fire,
  home,
  nowIso,
  openIds,
  postedBy,
}: {
  reading: UnmeasurableReading;
  fire: boolean;
  home: string;
  nowIso: string;
  openIds: readonly string[];
  postedBy: string;
}): Promise<PassAction[]> {
  return [
    { detail: reading.because, kind: "refused", monitorId: reading.monitorId, stepId: reading.monitorId },
    ...(await lapsedSettlements({
      definition: monitorDefinition({ monitorId: reading.monitorId }),
      fire,
      home,
      nowIso,
      openIds,
      postedBy,
    })),
  ];
}

/**
 * Why a measured reading may not reach the register, or `undefined` when it may.
 *
 * The form, not the evaluator's good behaviour, is what makes a fan-out impossible: a monitor that does not
 * declare {@link MonitorDefinition.perSubject} and reads more than one subject posts NOTHING and settles
 * nothing, and the pass says so. MEASURED: 25 notes in one second, one per parked run,
 * each a question already on the owner's queue. Checked before any fold, so a refused reading has no effect at all.
 *
 * @param definition the monitor that answered
 * @param reading what it answered, already known measurable
 * @returns the refusal's sentence, or `undefined`
 */
export function readingShapeRefusal({
  definition,
  reading,
}: {
  definition: MonitorDefinition;
  reading: FiringReading | ClearReading | SteeredReading;
}): string | undefined {
  if (reading.state !== "firing" || reading.subjects.length < 2 || definition.perSubject === true) {
    return undefined;
  }
  return (
    `${definition.id} posts one card for its whole set and read ${String(reading.subjects.length)} subjects — ` +
    "nothing posted or settled (rule 6: one note per step the owner can take)"
  );
}

/**
 * One measured monitor's arrivals, duplicate repairs and departures.
 *
 * @param reading the monitor's firing or clear reading
 * @param openIds every open hand-step id, of every monitor
 * @param openWithDecision the open ids whose recorded step carries a decision
 * @param consoleBase the console origin every posted card's own link opens on
 * @param postedIds every posted hand-step id exactly as the pass READ it, which a racing pass's later card is not among
 * @returns what the pass did for this monitor, in order
 */
async function measuredActions({
  consoleBase,
  fire,
  home,
  nowIso,
  openIds,
  openPage,
  openWithDecision,
  postedBy,
  postedIds,
  raiseNote,
  reading,
}: {
  consoleBase: string;
  fire: boolean;
  home: string;
  nowIso: string;
  openIds: readonly string[];
  openPage: PageOpener;
  openWithDecision: ReadonlySet<string>;
  postedBy: string;
  postedIds: readonly string[];
  raiseNote: NoteRaiser;
  reading: FiringReading | ClearReading | SteeredReading;
}): Promise<PassAction[]> {
  const definition = monitorDefinition({ monitorId: reading.monitorId });
  const settle = { definition, fire, home, nowIso, postedBy };
  const { folded, openByBase, returned } = foldOpenCards({ definition, openIds, openWithDecision, reading });
  const departing = new Set([...folded.departed, ...returned]);
  const actions = await settleDuplicates({ departed: departing, openByBase, settle });
  const posting = { consoleBase, definition, fire, home, nowIso, openPage, postedBy, postedIds, raiseNote };
  const arrivals = await arrivalActions({ ...posting, arrived: folded.arrived, monitorId: reading.monitorId });
  actions.push(...arrivals);
  const replacedBy = arrivals.filter((action) => action.kind === "posted").map((action) => action.stepId);
  const partial = reading.state === "firing" && reading.blindSpot !== undefined;
  if (partial) {
    actions.push({
      detail: reading.blindSpot,
      kind: "refused",
      monitorId: reading.monitorId,
      stepId: reading.monitorId,
    });
  }
  // Nothing departs when a card that should have gone up did not: a set that changed departs its old card
  // exactly when the new one is recorded, or a failed post leaves no card at all. A partial read departs
  // nothing unless a replacement went up in this same pass — a subject missing from it was never observed
  // clearing.
  const everyArrivalPosted = arrivalsAnswered({ arrivals, definition }) === folded.arrived.length;
  if (!everyArrivalPosted || (partial && replacedBy.length === 0)) {
    return actions;
  }
  actions.push(
    ...(await settleReplaced({ departed: folded.departed, openByBase, reading, replacedBy, returned, settle })),
  );
  return actions;
}

/**
 * How many of a pass's arrivals count as answered, so its departures may settle.
 *
 * A HELD arrival on a whole-set monitor answers nothing, so it departs nothing: a signal set that changed while
 * nothing is news leaves the old card standing rather than blanking the owner's screen. On a PER-SUBJECT monitor a held
 * arrival is that one subject's own answer — the owner's Done held until a probe re-tests it — and never keeps another
 * subject's departed card up. A failed post answers nothing on either.
 *
 * What that leaves, stated rather than closed: a post the register REFUSES — an append that fails, or a card a
 * register value pushes past a cap — still holds every departure of that pass, per-subject or not, and the next pass
 * retries. Which open card a refused arrival relates to is not knowable here, and departing anyway would leave a plan
 * whose fault changed episode with no card at all. Every value a PROBE supplies is bounded where the card is composed
 * (`./claudePlanUnusable.ts`), and so is every register value the card carries: the sign-in command goes without
 * past its cap, and an address or store path is fitted inside the sentence rather than cutting
 * it. No input known to reach a cap remains; an append that fails still holds the pass. The mechanism
 * that would close it is relating a departed card to its subject's own refused arrival.
 *
 * @param arrivals what the pass did for each arrival
 * @returns the arrivals answered
 */
function arrivalsAnswered({
  arrivals,
  definition,
}: {
  arrivals: readonly PassAction[];
  definition: MonitorDefinition;
}): number {
  const answers = new Set<PassAction["kind"]>(["posted"]);
  if (definition.perSubject === true) {
    answers.add("held");
  }
  return arrivals.filter((action) => answers.has(action.kind)).length;
}
