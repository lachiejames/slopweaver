/**
 * REVIEW THROUGHPUT — the parts of a reviewer round that decide how LONG it takes rather than what it checks.
 *
 * ## The measured cost this exists for
 *
 * Every bot turn of one measured day, 15 asks, 14 answered: on the 7 PUBLIC turns tag-to-answer was
 * mean 72.7 min, and the review phase was 36.0 min of it (49%). Pure reviewer wait — packet handed over to
 * verdict written — was 5.7 to 23.2 min a round, median 12, so one round cost about as much as the whole
 * investigation on a routine ask. Three turns ran past `REVIEW_ROUND_CAP`, which narrows scope and bounds no
 * clock. The per-turn phase table is `$SLOPWEAVER_HOME/pages/bot-turns-15-sep/index.html`; the rounds
 * are re-countable from the review records themselves:
 *
 * ```
 * cd "$SLOPWEAVER_HOME/live/slack/reviews"
 * find . -name record.json -exec jq -r '[.round,.spawnedAt]|@tsv' {} +
 * ```
 *
 * The reviewer is doing real work in those minutes — it caught a false revert claim, five wrong-repo PR links
 * and a stale whitelist that day — so nothing here removes a check. Four things change how the time is spent:
 *
 * - **Verify in parallel** ({@link parallelReadLines}): enumerate the claims, then fan every independent live
 *   read out at once, rather than one read, one wait, one read.
 * - **A clock on every round** ({@link roundClockLines}, {@link reviewNowLine}): the packet says how long this
 *   ask has already spent in review and what a round measured, and the live card says how long THIS round has
 *   been open. There is no deadline in either: a per-ask deadline is unruled (`./budgetMarks.ts`).
 * - **A re-review is scoped to what moved** ({@link reReviewScopeLines}): the change list `./answerChange.ts`
 *   computes reaches every round two, not only the rounds that carried a settled claim.
 * - **No second round after a clean one** — `../../cli/commands/turn/reviewAfterClean.ts`, which prints the
 *   code diff of the two answer files and refuses instead of booting a reviewer.
 */
import { CARD_LINE_CAP, clampVisible } from "./answer.js";
import { type AnswerChange, answerChangeLines } from "./answerChange.js";
import { elapsedWords } from "./progressCard.js";
import {
  type ReReadClaim,
  reReadClaimLines,
  reviewRoundLines,
  type SettledClaim,
  settledClaimLines,
} from "./reviewRounds.js";

/**
 * The packet's preamble — the round's terms, its clock and how to verify — every block unnumbered, because
 * each is about THIS round rather than evidence about the answer.
 *
 * @param carriedUnresolved what the previous round left high-impact and unresolved
 * @param clock when round 1 of this ask opened and when this round's reviewer was booted
 * @param round which round this is, 1-based
 * @returns the preamble's lines, in order
 */
export function roundTermsLines({
  carriedUnresolved,
  clock,
  round,
}: {
  carriedUnresolved: readonly string[];
  clock: { readonly reviewStartedAt: string | undefined; readonly spawnedAt: string };
  round: number;
}): readonly string[] {
  return [
    ...reviewRoundLines({ carriedUnresolved, round }),
    ...roundClockLines({ reviewStartedAt: clock.reviewStartedAt, round, spawnedAt: clock.spawnedAt }),
    ...parallelReadLines(),
  ];
}

/**
 * What a re-review inherits, placed AFTER the answer and the evidence: the settled claims, the reads to
 * re-run, and where this round's work is — the change list printed once, whichever block carries it. Never
 * before: a reviewer handed prior conclusions first is being anchored, and independence is the whole point
 * of it being a separate session. See `settledClaimLines`.
 *
 * @param carriedReads the live claims the last round settled with a recorded read
 * @param carriedSettled the answer-resting claims the last round settled
 * @param changes what moved since the last verdict, or `undefined` when nothing sound says
 * @param round which round this is, 1-based
 * @returns the blocks' lines, in order — empty on round 1
 */
export function carriedRoundLines({
  carriedReads,
  carriedSettled,
  changes,
  round,
}: {
  carriedReads: readonly ReReadClaim[];
  carriedSettled: readonly SettledClaim[];
  changes: readonly AnswerChange[] | undefined;
  round: number;
}): readonly string[] {
  const changeLines = answerChangeLines({ changes });
  const settled = settledClaimLines({ carriedSettled, changeLines, round });
  return [
    ...settled,
    ...reReadClaimLines({ carriedReads, round }),
    ...reReviewScopeLines({ changeLines, changes, changesShown: settled.length > 0, round }),
  ];
}

/**
 * The heading every packet's clock block opens with — the string `turn review` checks the WRITTEN packet for
 * before it hands the reviewer its pickup, so an edit that drops the block refuses rather than ships.
 */
export const ROUND_CLOCK_HEADING = "### The clock — this round is on the asker's critical path";

/**
 * The packet's clock block: which round, when it opened, and how long this ask has already been in review.
 *
 * States the measurement as a fact about rounds, never as a deadline for this one — the owner
 * has not ruled a per-ask deadline, and a number invented here would read to a reviewer as permission to stop.
 *
 * @param reviewStartedAt when round 1 of this ask opened, or `undefined` when an older record never said
 * @param round which round this is, 1-based
 * @param spawnedAt when THIS round's reviewer was booted
 * @returns the block's lines, in order
 */
export function roundClockLines({
  reviewStartedAt,
  round,
  spawnedAt,
}: {
  reviewStartedAt: string | undefined;
  round: number;
  spawnedAt: string;
}): readonly string[] {
  return [
    ROUND_CLOCK_HEADING,
    "",
    `Round ${String(round)} opened at ${spawnedAt}. ${spentLine({ reviewStartedAt, round, spawnedAt })}`,
    "",
    "Nobody sees the answer until your verdict is written. Measured over every public bot turn of one day,",
    "a round took 5.7 to 23.2 minutes, median 12, and review was 49% of the time from tag to answer. Spend the",
    "time on the claims, not on waiting for one read to finish before starting the next.",
    "",
  ];
}

/** What the clock block says about time already spent — never a guess when round 1's instant is unknown. */
function spentLine({
  reviewStartedAt,
  round,
  spawnedAt,
}: {
  reviewStartedAt: string | undefined;
  round: number;
  spawnedAt: string;
}): string {
  if (round <= 1) {
    return "This is the ask's first round.";
  }
  if (reviewStartedAt === undefined) {
    return `${String(round - 1)} earlier round(s); when round 1 opened was not recorded.`;
  }
  const spent = elapsedWords({ fromIso: reviewStartedAt, toIso: spawnedAt });
  if (spent === undefined) {
    return `${String(round - 1)} earlier round(s); when round 1 opened could not be read.`;
  }
  return `This ask has already spent ${spent} in review across ${String(round - 1)} earlier round(s).`;
}

/**
 * Whether a written packet carries its clock block — the fact `turn review` refuses a round on.
 *
 * @param packet the packet text as written to disk
 * @returns true when the heading is present
 */
export function packetCarriesClock({ packet }: { packet: string }): boolean {
  return packet.includes(ROUND_CLOCK_HEADING);
}

/**
 * How to spend a round: enumerate, then read in ONE parallel batch, then classify. Every round, round 1
 * included — the serial read is the cost on the first round as much as on the fifth.
 *
 * @returns the block's lines, in order
 */
export function parallelReadLines(): readonly string[] {
  return [
    "### How to verify — enumerate, fan out, then classify",
    "",
    "1. Read the answer and write down every material claim BEFORE running anything.",
    "2. For each, name the one read that settles it. Then issue every read that does not need another's",
    "   output in ONE batch — several tool calls in the same message, and a subagent per heavy leg (a",
    "   Datadog walk, a multi-repo search). One read, one wait, one read is the serial shape this ends.",
    "3. Only a read whose input is another read's output waits for it.",
    "4. Classify every claim from what came back. Parallel is how you read; it lowers no bar on what counts.",
    "",
  ];
}

/**
 * The re-review's scope: what moved since the last verdict, and that the work of this round is there.
 *
 * Renders on every round two onward, which is the gap it closes: the change list used to reach a reviewer
 * only inside the settled-claims block, and measured over one week, 107 of 127 verdicts carried nothing
 * settled — so most re-reviews saw no change list at all and re-derived the whole answer. When that block
 * DID render it already printed the list, and `changesShown` stops it being printed twice.
 *
 * Fails closed: when the changes cannot be known, or the list touches the answer's root, the round is a
 * full review and says so.
 *
 * @param changes what moved since the reviewed answer, or `undefined` when there is nothing sound to compare
 * @param changeLines `./answerChange.ts`'s rendering of `changes`
 * @param changesShown whether the settled block above already printed `changeLines`
 * @param round which round this is, 1-based
 * @returns the block's lines, in order — empty on round 1
 */
export function reReviewScopeLines({
  changeLines,
  changes,
  changesShown,
  round,
}: {
  changeLines: readonly string[];
  changes: readonly AnswerChange[] | undefined;
  changesShown: boolean;
  round: number;
}): readonly string[] {
  if (round <= 1) {
    return [];
  }
  const heading = ["## Where this round's work is", ""];
  const list = changesShown ? [] : changeLines;
  if (changes === undefined || changes.some((change) => change.path === "/")) {
    return [...heading, ...list, "This round is a FULL review: nothing sound says which part of the answer moved.", ""];
  }
  return [
    ...heading,
    ...list,
    "The previous round's verdict covered this same answer everywhere the list above does not name. Verify",
    "from source: every claim a changed path expresses or qualifies, every claim under `This round`, the two",
    "standing claims, and every read in the re-read block. A claim resting ONLY on unchanged paths and the",
    "answer's own bytes may be classified by naming the previous round and the unchanged paths as evidence.",
    "A claim resting on live state is re-read, never reused — an unchanged answer is not an unchanged world.",
    "",
  ];
}

/**
 * The card's `now:` line while a reviewer round is open — the round, how long it has been open, and how long
 * the ask has been in review — so a reader in the thread can see the phase that measured half the wait.
 *
 * With a `turnClock` the line leads with the reader's whole wait, ahead of the clamp — the round's age alone
 * cannot tell the reader whether the turn started five minutes ago or fifty.
 *
 * @param record the ask's review record: its round, when it opened, and when round 1 did
 * @param nowIso the current instant
 * @param turnClock the reader's elapsed wait from `turnClockLead` or `stillWorkingLead`, when known
 * @returns the clamped line
 */
export function reviewNowLine({
  nowIso,
  record,
  turnClock,
}: {
  nowIso: string;
  record: { readonly round: number; readonly spawnedAt: string; readonly reviewStartedAt?: string | undefined };
  turnClock?: string | undefined;
}): string {
  const open = elapsedWords({ fromIso: record.spawnedAt, toIso: nowIso });
  const opened = open === undefined ? "" : ` · open ${open}`;
  const since = record.round > 1 && record.reviewStartedAt !== undefined ? record.reviewStartedAt : undefined;
  const total = since === undefined ? undefined : elapsedWords({ fromIso: since, toIso: nowIso });
  const phase = total === undefined ? "" : ` · ${total} in review so far`;
  const lead = turnClock === undefined ? "" : `${turnClock} · `;
  return clampVisible({
    cap: CARD_LINE_CAP,
    text: `now: ${lead}independent review, round ${String(record.round)}${opened}${phase}`,
  });
}
