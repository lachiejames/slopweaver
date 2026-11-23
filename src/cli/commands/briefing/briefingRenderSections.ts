/**
 * The five briefing sections that read the state home DIRECTLY — freshness, Nothing stale, the owner's
 * beliefs, the quiz, and the steps waiting on the owner's hands.
 *
 * Depth 0 of the family, beside the vocabulary and importing neither it nor anything above it. That is the
 * point rather than an accident: each of these carries a comment saying it reads the home directly
 * rather than through the injected seam, and in one file that was a claim every reader had to keep. Here
 * `BriefingRenderDeps` is not in scope at all, so none of them CAN reach the seam.
 */
import { projectHandSteps } from "../../../briefing/handSteps.js";
import { projectOwnerBeliefs } from "../../../briefing/ownerBeliefs.js";
import { projectQuiz } from "../../../briefing/quiz.js";
import { waitingHandSteps } from "../../../hand/step.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import { questionFor } from "../../../knowledge/quiz/select.js";
import { readQuiz } from "../../../knowledge/quiz/store.js";
import { scanVoice } from "../../../knowledge/voice/scan.js";
import { readProposals } from "../../../knowledge/voice/store.js";
import { openProposals } from "../../../knowledge/voice/unit.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type {
  BriefingHandSteps,
  BriefingOwnerBeliefs,
  BriefingQuiz,
  BriefingSection,
} from "../../../outbound/briefing/types.js";
import { type BriefingCommandError, BriefingCommandErrors } from "./errors.js";
import { gatherFreshnessSection } from "./freshnessProjection.js";
import { gatherNothingStaleSection } from "./nothingStaleProjection.js";

/**
 * The freshness section, when the run asked for one.
 *
 * Its own function rather than a ternary inline, because the projection reads this machine's whole resync
 * roster and every atlas's manifest — a real gather, and one a reader of the render's own shell should see
 * named rather than buried in an argument.
 *
 * @param wanted whether `--freshness` was passed
 * @param home the state home to read
 * @param nowIso the instant ages are measured against
 * @returns the section, or `undefined` when the run asked for none
 */
export async function freshnessSection({
  wanted,
  home,
  nowIso,
}: {
  wanted: boolean;
  home: string;
  nowIso: string;
}): Promise<BriefingSection | undefined> {
  if (!wanted) {
    return undefined;
  }
  return (await gatherFreshnessSection({ home, nowIso })).section;
}

/**
 * The "Nothing stale" section, when the run asked for one.
 *
 * Reads the state home directly, like {@link freshnessSection}. A document it cannot read is a line of the
 * section rather than a refusal; what refuses is the section itself failing its byte budget or its schema,
 * carried through as the projection's own message.
 *
 * @param wanted whether `--nothing-stale` was passed; when it was not, nothing is read at all
 * @param home the state home to read
 * @param nowIso the page's ready instant, which every document's freshness is judged at
 * @returns the section, `undefined` when the run asked for none, or the refusal
 */
export function nothingStaleSection({
  wanted,
  home,
  nowIso,
}: {
  wanted: boolean;
  home: string;
  nowIso: string;
}): Result<BriefingSection | undefined, BriefingCommandError> {
  if (!wanted) {
    return ok(undefined);
  }
  return gatherNothingStaleSection({ home, nowIso }).mapErr((error) =>
    BriefingCommandErrors.upstreamRefused({ reasons: [error.message] }),
  );
}

/**
 * Project the proposal queue into the correction block, or nothing at all when the run asked for none.
 *
 * Reads the state home directly rather than through an injected seam, the same call `freshnessSection`
 * above makes and for its reason: both read durable local state under `$SLOPWEAVER_HOME` that no sweep
 * document carries, so there is nothing for a caller to pass along and a seam would only be a second place
 * the path is spelled.
 *
 * ## Why it scans the owner's voice sources at all
 *
 * For one field: `wrapped`. Whether a quote came out of the tick ledger's own record of what the owner said or out
 * of a turn FILE a supervisor wrote around the owner's words is a property of the UNIT, not of the proposal, and it
 * decides how the page may present the quote to the owner — asking them to correct a belief read out of the
 * fleet's own prose without saying so would be asking the owner to ratify it. MEASURED on their real home: 22,055
 * recordings fold to 451 distinct units (`slopweaver knowledge voice --batch 1 --json | jq .watermark`), so
 * the scan is a directory walk of that size rather than anything a render has to be careful about.
 *
 * An UNREADABLE queue is a refusal rather than an empty block, exactly as `../../../knowledge/voice/store.ts`
 * refuses: the two answers lead to opposite conclusions, and "the owner has answered everything" is the one this
 * whole mechanism is trying to reach.
 *
 * @param wanted whether `--owner-beliefs` was passed
 * @param home the state home this run reads
 * @returns the projected block, absent when the run asked for none, or the refusal
 */
export function ownerBeliefsBlock({
  wanted,
  home,
}: {
  wanted: boolean;
  home: string;
}): Result<BriefingOwnerBeliefs | undefined, BriefingCommandError> {
  if (!wanted) {
    return ok(undefined);
  }
  const queue = readProposals({ home });
  if (queue.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: [queue.error.message] }));
  }
  const units = new Map(scanVoice({ home }).units.map((unit) => [unit.id, unit]));
  return ok(projectOwnerBeliefs({ open: openProposals({ proposals: queue.value }), units }));
}

/**
 * Project the sweep's recorded question into the quiz block, or nothing when the run asked for none.
 *
 * Reads the state home directly, the same call `ownerBeliefsBlock` and `freshnessSection` make and for
 * their reason: the ledger is durable local state no sweep document carries.
 *
 * It READS the ledger and never cuts. `slopweaver knowledge quiz --sweep <tick-id>` is the one thing that
 * selects a question, so a sweep re-rendered after a new lesson landed shows the question it already asked
 * rather than a different one under the same id.
 *
 * @param sweep the sweep whose question to project, absent when the run asked for none
 * @param home the state home this run reads
 * @returns the projected block, absent when the run asked for none or the sweep asked nothing, or the refusal
 */
export function quizBlock({
  sweep,
  home,
}: {
  sweep: string | undefined;
  home: string;
}): Result<BriefingQuiz | undefined, BriefingCommandError> {
  if (sweep === undefined) {
    return ok(undefined);
  }
  const ledger = readQuiz({ home });
  if (ledger.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: [ledger.error.message] }));
  }
  const question = questionFor({ events: ledger.value, sweepId: sweep });
  if (question === undefined) {
    return err(BriefingCommandErrors.quizQuestionMissing({ sweep }));
  }
  return ok(projectQuiz({ question }));
}

/**
 * Project the hand register into the waiting-on-you section, or nothing when the run asked for none.
 *
 * Reads the state home directly, the same call `quizBlock` and `ownerBeliefsBlock` make and for their
 * reason: the register is durable local state under `$SLOPWEAVER_HOME` that no sweep document carries.
 *
 * ## A skipped line is COUNTED onto the page, never a refusal of the render
 *
 * `../../../hand/store.ts` reports a line it cannot parse and reads the rest, and this block takes the same
 * side for the same reason, measured in this feature's own incident: ONE unparseable line made
 * every `hand` verb exit 1, and the owner's floating card sat on the owner's screen
 * uncloseable by any verb. A render that refused over that line would have taken the second surface away at
 * the moment the first one was stuck, which is the same defect one layer up.
 *
 * What must not happen is the page carrying the gap SILENTLY — a section missing the one step the owner has been
 * sitting on reads as "nothing is waiting on you", the confident wrong answer on the surface the owner trusts most.
 * So the count rides the section (`unreadable`) and renders as its own line, and a register whose every line
 * is unreadable still puts a heading on the page saying so.
 *
 * An EMPTY register is neither: nothing waiting on the owner's hands is the state this feature is trying to reach,
 * and the page states it by omitting the section.
 *
 * @param wanted whether `--hand-steps` was passed
 * @param home the state home this run reads
 * @returns the projected section, absent when the run asked for none, or the register's own read failure
 */
export function handStepsBlock({
  wanted,
  home,
}: {
  wanted: boolean;
  home: string;
}): Result<BriefingHandSteps | undefined, BriefingCommandError> {
  if (!wanted) {
    return ok(undefined);
  }
  const register = readOpenHandSteps({ home });
  if (register.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: [register.error.message] }));
  }
  // A notice waits on nobody, so the section of what waits on the owner's hands never carries one.
  const steps = waitingHandSteps({ steps: register.value.steps });
  return ok(projectHandSteps({ steps, unreadable: register.value.unparsed.length }));
}
