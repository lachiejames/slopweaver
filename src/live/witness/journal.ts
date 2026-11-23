/**
 * The witness journal's pure logic: parse one line, fold every line into what is current per witness, decide
 * whether a dispatch may proceed, and plan the one terminal a settle would write.
 *
 * Pure — no filesystem, no clock (`nowIso` is passed in). `./journalStore.ts` is the effectful edge.
 *
 * The journal is append-only and a witness's state is the fold of its events: a `dispatched` row makes it
 * live, a `settled` row ends it, and nothing after a `settled` row re-opens it — bar a `dispatched` row after
 * a `failed` one, which reached no verdict on the claim and so opens a fresh attempt. Both refusals that matter
 * — a second worker for the same message, a second terminal — are decided HERE from the fold, which is why
 * the reader refuses a whole journal on one bad line rather than reading past it.
 */
import { err, ok, type Result } from "#lib/result.js";
import {
  type WitnessDispatchError,
  WitnessDispatchErrors,
  type WitnessJournalError,
  WitnessJournalErrors,
  type WitnessSettleError,
  WitnessSettleErrors,
} from "./errors.js";
import {
  threadStandDownIdOf,
  type WitnessCurrent,
  type WitnessJournalEvent,
  type WitnessKey,
  type WitnessMessageEvent,
  type WitnessOutcome,
  type WitnessRevisedEvent,
  type WitnessSelector,
  type WitnessSettledEvent,
  type WitnessSettleOutcome,
  witnessIdOf,
  witnessJournalEventSchema,
} from "./types.js";

/**
 * Parse one journal line into an event, or say exactly which line is wrong and how.
 *
 * @param line the raw line, without its newline
 * @param lineNumber the line's 1-based position, for the refusal
 * @param path the journal's path, for the refusal
 * @returns the event, or the malformed-line error naming the line
 */
export function parseWitnessJournalLine({
  line,
  lineNumber,
  path,
}: {
  line: string;
  lineNumber: number;
  path: string;
}): Result<WitnessJournalEvent, WitnessJournalError> {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "not JSON";
    return err(WitnessJournalErrors.lineMalformed({ detail, lineNumber, path }));
  }
  const parsed = witnessJournalEventSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return err(WitnessJournalErrors.lineMalformed({ detail, lineNumber, path }));
  }
  const event = parsed.data;
  if (event.kind === "thread-stood-down") {
    if (event.standDownId !== threadStandDownIdOf({ channel: event.channel, threadTs: event.threadTs })) {
      return err(
        WitnessJournalErrors.lineMalformed({
          detail: `standDownId ${event.standDownId} is not the id its own thread coordinates derive`,
          lineNumber,
          path,
        }),
      );
    }
    return ok(event);
  }
  if (event.witnessId !== witnessIdOf({ key: event })) {
    return err(
      WitnessJournalErrors.lineMalformed({
        detail: `witnessId ${event.witnessId} is not the id its own coordinates derive`,
        lineNumber,
        path,
      }),
    );
  }
  return ok(event);
}

/**
 * Fold every journal event into what is current per witness.
 *
 * A `dispatched` row records the worker; a `settled` row records the terminal. The FIRST terminal wins: the
 * writers refuse a second one, so a later one can only be a hand edit or a race, and the earlier one is what
 * every reader before it already acted on.
 *
 * The one exception is a `dispatched` row AFTER a `failed` terminal: that is a fresh attempt, which
 * `witnessDispatchPermit` admits, so it clears the terminal and the first-terminal rule applies again within
 * it. A `dispatched` row after any other terminal can only be a hand edit, and re-opens nothing. The fold keeps
 * only the newest attempt's workspace, which is why `dispatchWitness` closes the failed attempt's window
 * BEFORE it writes the new row and refuses when it cannot: an old worker left running would settle into the
 * new attempt and close the new worker's window.
 *
 * A `revised` row is not a terminal and never touches `settled`: it is admitted only as the FIRST revision of a
 * witness settled `posted` whose `postedTs` it names, and any other revision row — a second one, one before the
 * terminal, one naming another ts — can only be a hand edit and changes nothing, `latestIso` included.
 *
 * A `thread-stood-down` row is about a thread, not a witness, so it folds into no record; `threadStandDown`
 * (`./standDown.ts`) is its one reader.
 *
 * @param events every journal event, in file order
 * @returns the current record per witness id
 */
export function foldWitnessJournal({
  events,
}: {
  events: readonly WitnessJournalEvent[];
}): ReadonlyMap<string, WitnessCurrent> {
  const current = new Map<string, WitnessCurrent>();
  for (const event of events) {
    if (event.kind === "thread-stood-down") {
      continue;
    }
    const next = foldWitnessEvent({ earlier: current.get(event.witnessId), event });
    if (next !== undefined) {
      current.set(event.witnessId, next);
    }
  }
  return current;
}

/** One event folded onto its witness's record so far, or undefined when the event changes nothing. */
function foldWitnessEvent({
  earlier,
  event,
}: {
  earlier: WitnessCurrent | undefined;
  event: WitnessMessageEvent;
}): WitnessCurrent | undefined {
  const key: WitnessKey = { channel: event.channel, messageTs: event.messageTs, threadTs: event.threadTs };
  let base: WitnessCurrent = {
    dispatched: undefined,
    key,
    latestIso: event.tsIso,
    revised: undefined,
    settled: undefined,
    witnessId: event.witnessId,
  };
  if (earlier !== undefined) {
    base = earlier;
  }
  const latestIso = event.tsIso > base.latestIso ? event.tsIso : base.latestIso;
  if (event.kind === "revised") {
    return revisionAdmitted({ base, event }) ? { ...base, latestIso, revised: event } : undefined;
  }
  if (event.kind === "dispatched") {
    // A fresh attempt after a `failed` terminal clears it; after any other terminal it re-opens nothing.
    const retried = base.settled?.outcome === "failed";
    return retried
      ? { ...base, dispatched: event, latestIso, settled: undefined }
      : { ...base, dispatched: event, latestIso };
  }
  return base.settled === undefined ? { ...base, latestIso, settled: event } : undefined;
}

/** Whether a `revised` row is the first revision of the posted reply it names. */
function revisionAdmitted({ base, event }: { base: WitnessCurrent; event: WitnessRevisedEvent }): boolean {
  const { revised, settled } = base;
  return (
    revised === undefined &&
    settled?.outcome === "posted" &&
    settled.postedTs !== undefined &&
    settled.postedTs === event.postedTs
  );
}

/**
 * Whether a worker may be dispatched for this message: never twice, never after it is settled with a verdict,
 * and never while ANY other witness worker is still live. The last is the owner's ruling on this run: one
 * unasked peer-bot thread investigation at a time, so the owner always knows what their own fleet is
 * carrying. The owner's own tags of the bot are not witnesses and are never counted here.
 *
 * A `failed` terminal does not bury the check: it reached no verdict on the claim, so the visible loop may
 * dispatch it again — never automatically (rule 2), only on its own judgement of the line.
 *
 * @param current the folded journal
 * @param key the witnessed message's coordinates
 * @returns ok when no live worker and no verdict exist and nothing else is live, else which one blocks it
 */
export function witnessDispatchPermit({
  current,
  key,
}: {
  current: ReadonlyMap<string, WitnessCurrent>;
  key: WitnessKey;
}): Result<void, WitnessDispatchError> {
  const witnessId = witnessIdOf({ key });
  const record = current.get(witnessId);
  const settled = record?.settled;
  if (settled !== undefined && settled.outcome !== "failed") {
    return err(WitnessDispatchErrors.alreadySettled({ outcome: settled.outcome, witnessId }));
  }
  if (settled === undefined && record?.dispatched !== undefined) {
    return err(WitnessDispatchErrors.alreadyDispatched({ witnessId, workspaceRef: record.dispatched.workspaceRef }));
  }
  const live = [...current.values()].find((other) => other.dispatched !== undefined && other.settled === undefined);
  if (live !== undefined) {
    return err(WitnessDispatchErrors.anotherLive({ liveId: live.witnessId, witnessId }));
  }
  return ok(undefined);
}

/** The `--why` an outcome demands: silence and failure must each say what they rest on. */
const WHY_REQUIRED: ReadonlySet<WitnessOutcome> = new Set(["nothing-material", "failed"]);

/**
 * Plan the terminal a `settle` would write, or refuse it.
 *
 * The invariants, in the order they are checked:
 *
 * 1. `posted` requires a `postedTs`; every other outcome refuses one.
 * 2. `nothing-material` and `failed` require a non-blank `why`.
 * 3. A witness already settled is never settled again.
 * 4. A witness with no record at all may end only `nothing-checkable`, and only when named by coordinates —
 *    the loop's own judgement on a line no worker was ever booted for. An unknown id is `WITNESS_UNKNOWN`.
 *
 * @param current the folded journal
 * @param selector the witness being settled, by id or by coordinates
 * @param outcome how it ended
 * @param why what the ending rests on, when the outcome demands it
 * @param postedTs the ts of the posted witness form, for `posted` only
 * @param nowIso the instant to stamp the terminal with
 * @returns the event to append, or the refusal
 */
export function planWitnessSettlement({
  current,
  selector,
  outcome,
  why,
  postedTs,
  nowIso,
}: {
  current: ReadonlyMap<string, WitnessCurrent>;
  selector: WitnessSelector;
  outcome: WitnessSettleOutcome;
  why: string | undefined;
  postedTs: string | undefined;
  nowIso: string;
}): Result<WitnessSettledEvent, WitnessSettleError> {
  const fields = settlementWhy({ outcome, postedTs, why });
  if (fields.isErr()) {
    return err(fields.error);
  }
  const keptWhy = fields.value;
  const witnessId = selector.kind === "id" ? selector.witnessId : witnessIdOf({ key: selector.key });
  const resolved = settlementKey({ current, outcome, selector, witnessId });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const key = resolved.value;
  return ok({
    channel: key.channel,
    kind: "settled",
    messageTs: key.messageTs,
    outcome,
    ...(postedTs === undefined ? {} : { postedTs }),
    schemaVersion: 1,
    threadTs: key.threadTs,
    tsIso: nowIso,
    ...(keptWhy === undefined ? {} : { why: keptWhy }),
    witnessId,
  });
}

/** Invariants 1 and 2: the `postedTs` and `why` an outcome demands or refuses; the kept `why` when they hold. */
function settlementWhy({
  outcome,
  why,
  postedTs,
}: {
  outcome: WitnessOutcome;
  why: string | undefined;
  postedTs: string | undefined;
}): Result<string | undefined, WitnessSettleError> {
  if (outcome === "posted" && postedTs === undefined) {
    return err(WitnessSettleErrors.postedTsRequired());
  }
  if (outcome !== "posted" && postedTs !== undefined) {
    return err(WitnessSettleErrors.postedTsForbidden({ outcome }));
  }
  const trimmedWhy = why === undefined ? undefined : why.trim();
  const keptWhy = trimmedWhy !== undefined && trimmedWhy.length > 0 ? trimmedWhy : undefined;
  if (WHY_REQUIRED.has(outcome) && keptWhy === undefined) {
    return err(WitnessSettleErrors.whyRequired({ outcome }));
  }
  return ok(keptWhy);
}

/** Invariants 3 and 4: the coordinates the terminal is written under, or why this witness cannot settle. */
function settlementKey({
  current,
  outcome,
  selector,
  witnessId,
}: {
  current: ReadonlyMap<string, WitnessCurrent>;
  outcome: WitnessOutcome;
  selector: WitnessSelector;
  witnessId: string;
}): Result<WitnessKey, WitnessSettleError> {
  const record = current.get(witnessId);
  if (record?.settled !== undefined) {
    return err(WitnessSettleErrors.alreadySettled({ outcome: record.settled.outcome, witnessId }));
  }
  if (record !== undefined) {
    return ok(record.key);
  }
  if (selector.kind === "id") {
    return err(WitnessSettleErrors.unknown({ witnessId }));
  }
  if (outcome !== "nothing-checkable") {
    return err(WitnessSettleErrors.notDispatched({ key: selector.key, outcome }));
  }
  return ok(selector.key);
}

/**
 * Every current witness, newest first by its latest event — what `witness list` prints.
 *
 * @param current the folded journal
 * @returns the records, newest first; ties keep journal order
 */
export function witnessesNewestFirst({
  current,
}: {
  current: ReadonlyMap<string, WitnessCurrent>;
}): readonly WitnessCurrent[] {
  return [...current.values()].toSorted((a, b) => b.latestIso.localeCompare(a.latestIso));
}
