/**
 * Revising a posted witness: a later message showed the bot's OWN witness reply was wrong, so the claim is struck
 * where readers saw it, with a bold Correction line under it, and the journal records that it happened, once.
 *
 * Found in the field: a witness reply said a person was NZ-only "so the AU lookups would not find
 * them", and minutes later the peer bot corrected itself in a newer thread — she resolves in the AU lookup.
 * The witness lines in that newer thread could only settle `nothing-checkable`; nothing could touch the wrong post.
 *
 * Three properties are the design:
 *
 * - **The target comes from the journal, never the caller.** The reply's channel and ts are the `posted` terminal's
 *   own, so a revision cannot be aimed at any other message.
 * - **At most once.** The bot corrects itself at most once in a team thread and then lets the team run
 *   (`skills/loop-bot/reference/posting.md`), so a second revision is refused before any Slack effect.
 * - **The row lands AFTER the read-back, under the witness lock.** A row claiming a correction Slack does not show
 *   would be worse than none; the crash window between the two is closed by the correction seam treating the SAME
 *   correction already shown as landed, so re-running the identical command records it.
 *
 * The Slack half is `slack correct`'s own runner (door, voice rules, ownership, read-back), behind the `correct` seam.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { WitnessJournalError } from "./errors.js";
import { foldWitnessJournal } from "./journal.js";
import { type WitnessReviseError, WitnessReviseErrors } from "./reviseErrors.js";
import type { WitnessJournalEvent, WitnessRevisedEvent } from "./types.js";

/** What `witness revise` was asked to strike and say instead. */
export interface WitnessReviseRequest {
  readonly witnessId: string;
  /** The claim's exact words, as the posted reply states them once. */
  readonly wrong: string;
  /** What is true now: the one line under the bold `Correction:` label. */
  readonly correction: string;
  /** The permalink of the message that showed the reply was wrong. */
  readonly because: string;
  readonly dryRun: boolean;
}

/**
 * Plan the `revised` row, or refuse — every refusal before any Slack effect.
 *
 * At most once is judged on the RAW journal, not the fold: the fold admits only a revision that follows its own
 * posted terminal and names its ts, so a `revised` row it set aside (out of order, or naming another ts) would
 * otherwise let a second revision through. Any `revised` row for this witness refuses.
 *
 * @param events the witness journal, in file order
 * @param request what to strike and why
 * @param nowIso the instant the row is stamped with
 * @returns the row whose channel and posted ts come from the journal, or the refusal
 */
export function planWitnessRevision({
  events,
  nowIso,
  request,
}: {
  events: readonly WitnessJournalEvent[];
  nowIso: string;
  request: WitnessReviseRequest;
}): Result<WitnessRevisedEvent, WitnessReviseError> {
  const { witnessId } = request;
  const record = foldWitnessJournal({ events }).get(witnessId);
  if (record === undefined) {
    return err(WitnessReviseErrors.unknown({ witnessId }));
  }
  if (events.some((event) => event.kind === "revised" && event.witnessId === witnessId)) {
    return err(WitnessReviseErrors.alreadyRevised({ witnessId }));
  }
  const { settled } = record;
  if (settled === undefined) {
    return err(WitnessReviseErrors.notPosted({ outcome: "live", witnessId }));
  }
  if (settled.outcome !== "posted") {
    return err(WitnessReviseErrors.notPosted({ outcome: settled.outcome, witnessId }));
  }
  if (settled.postedTs === undefined) {
    return err(WitnessReviseErrors.postedTsMissing({ witnessId }));
  }
  return ok({
    because: request.because.trim(),
    channel: record.key.channel,
    correction: request.correction.trim(),
    kind: "revised",
    messageTs: record.key.messageTs,
    postedTs: settled.postedTs,
    schemaVersion: 1,
    threadTs: record.key.threadTs,
    tsIso: nowIso,
    witnessId,
    wrong: request.wrong,
  });
}

/** The seams {@link reviseWitness} runs over. */
export interface WitnessReviseDeps {
  readonly readJournal: () => Result<readonly WitnessJournalEvent[], WitnessJournalError>;
  readonly append: (args: { event: WitnessJournalEvent }) => Result<void, WitnessJournalError>;
  readonly nowIso: () => string;
  /** The home's one witness lock — the same one `witness dispatch`, `settle`, `help` and `stand-down` take. */
  readonly lock: () => Result<{ readonly release: () => void }, string>;
  /**
   * Strike the claim in the posted reply and read it back — `slack correct`'s runner. Ok when it landed, or when
   * the SAME correction is already shown; a dry run changes nothing and is ok when the edit would go through.
   */
  readonly correct: (args: {
    channel: string;
    postedTs: string;
    wrong: string;
    correction: string;
    dryRun: boolean;
  }) => Promise<Result<void, WitnessReviseError>>;
}

/** What a revision reports: the row it journalled, or the row a dry run would have. */
export interface WitnessRevised {
  readonly event: WitnessRevisedEvent;
  readonly dryRun: boolean;
}

/** The plan, the correction and the row, with the lock already held. */
async function reviseHeld({
  deps,
  request,
}: {
  deps: WitnessReviseDeps;
  request: WitnessReviseRequest;
}): Promise<Result<WitnessRevised, WitnessReviseError>> {
  const events = deps.readJournal();
  if (events.isErr()) {
    return err(WitnessReviseErrors.journal({ cause: events.error }));
  }
  const planned = planWitnessRevision({
    events: events.value,
    nowIso: deps.nowIso(),
    request,
  });
  if (planned.isErr()) {
    return err(planned.error);
  }
  const event = planned.value;
  const corrected = await deps.correct({
    channel: event.channel,
    correction: event.correction,
    dryRun: request.dryRun,
    postedTs: event.postedTs,
    wrong: event.wrong,
  });
  if (corrected.isErr()) {
    return err(corrected.error);
  }
  if (request.dryRun) {
    return ok({ dryRun: true, event });
  }
  const appended = deps.append({ event });
  if (appended.isErr()) {
    return err(WitnessReviseErrors.recordFailed({ cause: appended.error }));
  }
  return ok({ dryRun: false, event });
}

/**
 * Revise one posted witness reply: take the lock, plan from the journal, strike through `slack correct`'s runner,
 * then journal `revised` — never a new reply, never a delete.
 *
 * @param deps the journal, lock and correction seams
 * @param request what to strike, the line to say instead, and the message that showed it wrong
 * @returns the journalled row (or a dry run's planned one), or the refusal — no Slack effect on a planning refusal
 */
export async function reviseWitness({
  deps,
  request,
}: {
  deps: WitnessReviseDeps;
  request: WitnessReviseRequest;
}): Promise<Result<WitnessRevised, WitnessReviseError>> {
  const held = deps.lock();
  if (held.isErr()) {
    return err(WitnessReviseErrors.locked({ reason: held.error }));
  }
  try {
    return await reviseHeld({ deps, request });
  } finally {
    held.value.release();
  }
}
