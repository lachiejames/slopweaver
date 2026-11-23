/**
 * REVIEW ROUNDS — how many times one ask has been sent back for review, what the last round left unresolved,
 * and the point past which a further round may no longer be bought with a brand-new nit.
 *
 * ## The measured failure this exists for
 *
 * The same ask `../../admit/requestedDeliverables.ts` names: SIX review rounds over roughly two
 * hours, six reviewer workspaces, every round rigorous — and every round spent on a gate evaluation, a
 * before/after and an inconclusive characterisation the owner had never asked for, while the one artifact the
 * ask existed for was missing the whole time. The owner asks for backtests roughly daily and cannot have each
 * one cost two hours; the owner's constraint on the fix is exact, so it is stated here rather than softened:
 * this does not lower the quality bar, and correctness of whatever IS delivered stays strict.
 *
 * ## Why a round CAP is not a bar, and what is capped instead
 *
 * The obvious cap — refuse to open round N+1 — is the wrong instrument twice over. It would block the
 * fix-and-re-review path that a `broken` verdict exists to open, and it would end an ask on "no verdict, no
 * send" for an answer that was getting better every round. So nothing here refuses a round.
 *
 * What the cap changes is what a LATE round is allowed to be about. Past {@link REVIEW_ROUND_CAP} the packet
 * carries {@link roundNarrowingLines}, composed by code exactly like every other instruction the reviewer
 * reads, and it says: the standing claims still bind, the claims earlier rounds NAMED still bind, and a claim
 * newly discovered in scope the question never requested is `low` impact and cannot make the outcome
 * `broken`. Correctness of what was asked for is untouched — a new high-impact finding about a requested
 * deliverable is still a new high-impact finding. Only self-assigned scope stops being able to buy a round.
 *
 * ## Carrying what the last round found, so a round is a continuation
 *
 * A round that cannot see the previous round's unresolved claims re-derives them, and re-derives a different
 * set — which is the other half of how six rounds happen. {@link carriedForwardOf} lifts the high-impact
 * claims the last verdict left `unsupported` or `unverifiable` into the next record, and
 * {@link reviewRoundLines} puts them in the packet, so round N opens on round N-1's list rather than on a
 * blank page. A round whose reviewer died carries the previous round's list forward unchanged: nothing was
 * resolved, so nothing is dropped.
 *
 * ## Carrying what the last round SETTLED, two ways — and the starvation the first way measured out at
 *
 * The settled carry ({@link settledHighImpactClaims}) hands the next round the high-impact
 * claims the previous reviewer marked `supported` and declared to rest on the answer's own bytes. MEASURED
 * over the 127 verdicts of the measured week: a reviewer classified 15.06 claims a round and was
 * handed 0.18; 107 of 127 verdicts yielded nothing carryable; 3 of 120 packets on disk carried the block.
 * Two causes, each answered here:
 *
 * - **The standing-phrase filter took a superset while canon disagreed with itself** on whether voice was
 *   standing, and the voice phrase alone removed 123 of the 238 otherwise-eligible claims. Settled
 *   (owner ruling on `canon-contradicts-itself-on-how-many-review-claims`): two standing claims,
 *   deliverable and supersession; voice is a material claim classified every round and carried like any
 *   other answer-resting one, because the change list above the carried block already names the moved
 *   paths a reviewer re-verifies against.
 * - **1,501 of 1,913 claims rested on live state**, and the median verdict settled seven high-impact live
 *   claims the next round rediscovered from nothing — not just "is it still true" but that the claim exists,
 *   what settles it and how to look. A live claim can never be carried as settled, so
 *   {@link reReadHighImpactClaims} carries it as a RE-READ: the claim, the previous reviewer's evidence, and
 *   the exact command and instant of the read it rested on, which the next round re-runs.
 *
 * Re-run the measurement (whole home; the window figures above used `-newermt '<window start>'`):
 *
 * ```
 * cd "$SLOPWEAVER_HOME/live/slack/reviews"
 * find . -name 'verdict*.json' -print0 | xargs -0 cat | jq -s '[.[]|.claims|length]|add/length'   # classified
 * grep -rl 'What the last round already' --include=packet.md . | wc -l                             # carried
 * ```
 *
 * {@link carryStarvationBreakage} is the witness: a round opened on a verdict that settled at least one
 * high-impact LIVE claim and carried none of them as a re-read writes a breakage row. Replayed over that
 * week's 81 superseded verdicts it fires on 81 — no verdict on disk yet names its read.
 */
import type { ReviewOutcome, ReviewVerdict } from "../../admit/reviewVerdict.js";
import type { AskIdentity } from "../ask/identity.js";
import type { LoopBreakage } from "./loopBreakage.js";

/**
 * The round past which a NEW claim about unrequested scope can no longer raise the outcome.
 *
 * Three, because the measured failure ran six and the owner's complaint was the cost of the tail: rounds one
 * to three are an answer converging on what it was asked for, and this file's header says what rounds four
 * to six actually contained. It is not a limit on how many rounds may run.
 */
export const REVIEW_ROUND_CAP = 3;

/**
 * The high-impact claims a verdict left unresolved — every claim the reviewer marked `high` impact and did
 * not mark `supported`. These are exactly the claims the door refuses a send on, so they are exactly the
 * ones the next round exists to settle.
 *
 * @param verdict the round's own verdict
 * @returns each unresolved claim's text, in the verdict's own order
 */
export function unresolvedHighImpactClaims({ verdict }: { verdict: ReviewVerdict }): readonly string[] {
  return verdict.claims
    .filter((claim) => claim.impact === "high" && claim.support !== "supported")
    .map((claim) => claim.text);
}

/**
 * The TWO claims a packet makes STANDING, quoted so the instruction that asks for them (`./review.ts`'s
 * verdict section), the late-round rider ({@link roundNarrowingLines}), the skill
 * (`skills/loop/reference/reviewer-packet.md`) and this filter cannot drift apart.
 *
 * Two, by owner ruling on `canon-contradicts-itself-on-how-many-review-claims` — the header
 * carries the anchor. This list was the union of three while canon disagreed, and the voice phrase alone
 * removed 123 of the 238 claims that were otherwise eligible that week. Voice is still a material
 * high-impact claim in every verdict (section 9 of the packet); it is not standing, so a previous round's
 * `answer`-resting voice verdict is carried like any other, under the change list that names which paths
 * moved.
 *
 * Neither of these is ever carried, however the reviewer typed it. Supersession is judged against the live
 * thread and decays the moment it is written. Deliverable is section 1's whole point — classified FIRST,
 * every round, against the question — and a round that inherits it is a round that skipped the check that
 * six rounds once missed.
 *
 * Each phrase is a SUBSTRING of its canonical claim (`DELIVERABLE_STANDING_CLAIM`, `THREAD_STANDING_CLAIM`),
 * deliberately shorter so a reviewer's "The answer delivers…" still matches.
 *
 * @internal — exported so a test can bind each phrase to the constant the packet renders.
 */
export const STANDING_CLAIM_PHRASES: readonly string[] = [
  "delivers every artifact the question asked for",
  "has not already answered or contradicted this",
];

/** One claim a previous round settled, carried with the evidence that settled it. */
export interface SettledClaim {
  readonly text: string;
  readonly evidence: string;
}

/**
 * One live-resting claim a previous round settled, carried as the read that settled it rather than as a
 * settlement — the next round re-runs `readCommand`, and `readAtIso` says how stale the previous read is.
 */
export interface ReReadClaim {
  readonly text: string;
  readonly evidence: string;
  readonly readCommand: string;
  readonly readAtIso: string;
}

/**
 * The high-impact claims a verdict settled that a later round may carry instead of re-deriving.
 *
 * Three conditions, and every one of them fails closed. The claim must be `supported`; it must carry
 * `restsOn: "answer"`, which only the reviewer can declare and whose absence means `live`; and it must not be
 * one of {@link STANDING_CLAIM_PHRASES}. A claim without evidence is dropped too — carrying "settled" with
 * nothing under it would hand the next round an assertion rather than a finding.
 *
 * Matched to a standing phrase by containment rather than equality, because reviewers write them with their
 * own prefix (`STANDING: the answer delivers …`), so an equality test would carry every one of them.
 *
 * @param verdict the round's own verdict
 * @returns each carryable claim with its evidence, in the verdict's own order
 */
export function settledHighImpactClaims({ verdict }: { verdict: ReviewVerdict }): readonly SettledClaim[] {
  return verdict.claims
    .filter((claim) => claim.impact === "high" && claim.support === "supported")
    .filter((claim) => claim.restsOn === "answer")
    .filter((claim) => !isStandingClaim({ text: claim.text }))
    .flatMap((claim) => (claim.evidence === undefined ? [] : [{ evidence: claim.evidence, text: claim.text }]));
}

/**
 * The high-impact LIVE claims a verdict settled, carried as the read each rested on rather than as settled.
 *
 * The same closed conditions as {@link settledHighImpactClaims} — `supported`, `high`, not standing, with
 * evidence — with the dependency inverted: `restsOn` is anything but `answer` (absent means `live`), and the
 * reviewer wrote BOTH `readCommand` and `readAtIso`. A live claim without its read is dropped, because a
 * re-read the next round cannot run is a settlement in disguise.
 *
 * @param verdict the round's own verdict
 * @returns each carryable claim with its evidence and read, in the verdict's own order
 */
export function reReadHighImpactClaims({ verdict }: { verdict: ReviewVerdict }): readonly ReReadClaim[] {
  return verdict.claims
    .filter((claim) => claim.impact === "high" && claim.support === "supported")
    .filter((claim) => claim.restsOn !== "answer")
    .filter((claim) => !isStandingClaim({ text: claim.text }))
    .flatMap((claim) =>
      claim.evidence === undefined || claim.readCommand === undefined || claim.readAtIso === undefined
        ? []
        : [{ evidence: claim.evidence, readAtIso: claim.readAtIso, readCommand: claim.readCommand, text: claim.text }],
    );
}

/**
 * How many high-impact LIVE claims a verdict settled — every `supported`, `high`, non-standing claim whose
 * `restsOn` is not `answer` — whether or not a read was recorded for it. The denominator
 * {@link carryStarvationBreakage} compares the re-read list against: the pool the 40% window is spent on is
 * this one, and the settled carry's own pool is not what starves once voice carries.
 *
 * @param verdict the round's own verdict
 * @returns the count
 */
export function settledLiveHighImpactCount({ verdict }: { verdict: ReviewVerdict }): number {
  return verdict.claims.filter(
    (claim) =>
      claim.impact === "high" &&
      claim.support === "supported" &&
      claim.restsOn !== "answer" &&
      !isStandingClaim({ text: claim.text }),
  ).length;
}

/** Whether a claim's text is one the packet makes standing, however the reviewer prefixed it. */
function isStandingClaim({ text }: { text: string }): boolean {
  const lower = text.toLowerCase();
  return STANDING_CLAIM_PHRASES.some((phrase) => lower.includes(phrase));
}

/** What one round hands the next — the shape {@link carriedForwardOf} returns. */
export interface CarriedForward {
  readonly round: number;
  readonly carriedUnresolved: readonly string[];
  readonly carriedSettled: readonly SettledClaim[];
  readonly carriedReads: readonly ReReadClaim[];
  readonly settledDigest: string | undefined;
  /** How many high-impact LIVE claims the previous verdict settled, read or not — 0 when it wrote none. */
  readonly previousSettledLiveCount: number;
  /** The outgoing round's own outcome — `clean` is what refuses a further reviewer round. Absent without a verdict. */
  readonly previousOutcome: ReviewOutcome | undefined;
  /** When round 1 of this ask opened, carried round to round — absent on round 1 and on a pre-clock record. */
  readonly reviewStartedAt: string | undefined;
}

/** When round 1 opened, read off the outgoing record: its own carried instant, else its spawn when it WAS round 1. */
function reviewStartOf({
  outgoing,
}: {
  outgoing: { readonly round: number; readonly spawnedAt?: string; readonly reviewStartedAt?: string | undefined };
}): string | undefined {
  if (outgoing.reviewStartedAt !== undefined) {
    return outgoing.reviewStartedAt;
  }
  return outgoing.round === 1 ? outgoing.spawnedAt : undefined;
}

/**
 * What the incoming round inherits: its number, and the claims the outgoing round left open.
 *
 * A reviewer that DIED carries its predecessor's unresolved list forward unchanged, because nothing was
 * resolved — but carries NO settled list, NO re-read list and NO digest. A round that wrote no verdict
 * settled nothing, and the round before it judged an answer that has since changed twice; inheriting a
 * settlement across that gap is the one place this could launder an old approval onto bytes nobody checked
 * it against.
 *
 * @param outgoing the record of the round being replaced — absent for the first review of an ask
 * @param previousVerdict the outgoing round's OWN verdict, when it wrote one
 * @returns the incoming round's number, its unresolved claims, what the last round settled (as settled and
 *   as re-reads), the digest that settlement was bound to — the key the previous answer is read back by —
 *   how many high-impact claims the last round settled in total, its outcome, and when round 1 opened
 */
export function carriedForwardOf({
  outgoing,
  previousVerdict,
}: {
  outgoing:
    | {
        readonly round: number;
        readonly carriedUnresolved: readonly string[];
        readonly spawnedAt?: string;
        readonly reviewStartedAt?: string | undefined;
      }
    | undefined;
  previousVerdict: ReviewVerdict | undefined;
}): CarriedForward {
  // No outgoing round is the first review of the ask, so it opens round 1.
  const round = outgoing === undefined ? 1 : outgoing.round + 1;
  const reviewStartedAt = outgoing === undefined ? undefined : reviewStartOf({ outgoing });
  if (previousVerdict !== undefined) {
    return {
      carriedReads: reReadHighImpactClaims({ verdict: previousVerdict }),
      carriedSettled: settledHighImpactClaims({ verdict: previousVerdict }),
      carriedUnresolved: unresolvedHighImpactClaims({ verdict: previousVerdict }),
      previousOutcome: previousVerdict.outcome,
      previousSettledLiveCount: settledLiveHighImpactCount({ verdict: previousVerdict }),
      reviewStartedAt,
      round,
      settledDigest: previousVerdict.answerDigest,
    };
  }
  return {
    carriedReads: [],
    carriedSettled: [],
    carriedUnresolved: outgoing === undefined ? [] : outgoing.carriedUnresolved,
    previousOutcome: undefined,
    previousSettledLiveCount: 0,
    reviewStartedAt,
    round,
    settledDigest: undefined,
  };
}

/**
 * The breakage row a round owes the ledger when it opens on a verdict that settled at least one high-impact
 * LIVE claim and carries NONE of those as a re-read — the starvation the header measures, made durable per
 * round so a recurrence is a count in the ledger rather than a re-measurement someone has to think to run.
 *
 * Live, not any: replayed over the 81 superseded verdicts of the measured week with only the voice phrase
 * dropped, "settled something and carried nothing" fires on 5, because the voice claim alone now carries on
 * most of them — while the median verdict's seven live claims are still rediscovered. So the witness asks the
 * narrower question the fix exists for. It now fires for one reason: the previous reviewer
 * settled live claims and wrote `readCommand`/`readAtIso` on none of them. It is a fact about the previous
 * verdict, recorded when the next round opens, and it never refuses the round.
 *
 * @param askIdentity the ask being reviewed again
 * @param atIso when the round opened
 * @param inherited what this round inherits — the row is owed only when it carries no re-read
 * @returns the row to append, or nothing when a re-read is carried or the last round settled nothing live
 */
export function carryStarvationBreakage({
  askIdentity,
  atIso,
  inherited,
}: {
  askIdentity: AskIdentity;
  atIso: string;
  inherited: CarriedForward;
}): LoopBreakage | undefined {
  if (inherited.previousSettledLiveCount === 0 || inherited.carriedReads.length > 0) {
    return undefined;
  }
  return {
    atIso,
    cause:
      "the previous reviewer settled live claims without recording a `readCommand` and `readAtIso` for any of " +
      "them, so the next round has nothing it can re-run and inherits a blank page",
    didInstead:
      "opened the round with no read to re-run — the previous reviewer wrote `readCommand` and `readAtIso` " +
      "on none of them; the reviewer rediscovers every one of those claims from nothing",
    error:
      `the previous verdict settled ${String(inherited.previousSettledLiveCount)} high-impact live claim(s) ` +
      `and round ${String(inherited.round)} carries none of them as a re-read`,
    thread: `${askIdentity.channel}/${askIdentity.messageTs}`,
    what: `turn review opened round ${String(inherited.round)} for this ask`,
  };
}

/**
 * The packet's round preamble — unnumbered, because it is the terms of THIS round rather than another piece
 * of evidence about the answer, and because the numbered sections are a contract other prose cites by number.
 *
 * @param carriedUnresolved what the previous round left `high`-impact and unresolved
 * @param round which round this is, 1-based
 * @returns the block's lines, in order
 */
export function reviewRoundLines({
  carriedUnresolved,
  round,
}: {
  carriedUnresolved: readonly string[];
  round: number;
}): readonly string[] {
  if (round <= 1) {
    return ["## This round", "", "Round 1 — the first review of this ask. Nothing has been sent back yet.", ""];
  }
  const outstanding =
    carriedUnresolved.length === 0
      ? ["- the previous round left no high-impact claim unresolved; it ended on something else."]
      : carriedUnresolved.map((claim) => `- ${claim}`);
  return [
    "## This round",
    "",
    `Round ${String(round)} of review for this ask. The answer has been sent back ${String(round - 1)} time(s)`,
    "already, and a round exists to SETTLE what the last one named — not to open a new front:",
    "",
    ...outstanding,
    "",
    "Classify each of those against the answer in front of you. One that the answer now handles is",
    "`supported`; one it still does not is `unsupported`, and say what is still missing.",
    "",
  ];
}

/**
 * The rider the "What to write" section carries once an ask has run past {@link REVIEW_ROUND_CAP} — empty
 * before that, so an ordinary review reads exactly as it always did.
 *
 * It narrows what a LATE round may escalate, and nothing else. Read the header for why that is not the
 * quality bar moving: the standing claims bind, the named claims bind, and a new finding about a requested
 * deliverable is still `high` impact. What stops earning another round is a new finding about analysis the
 * question never asked for.
 *
 * @param round which round this is, 1-based
 * @returns the rider's lines, or nothing when this ask is still inside the cap
 */
export function roundNarrowingLines({ round }: { round: number }): readonly string[] {
  if (round <= REVIEW_ROUND_CAP) {
    return [];
  }
  return [
    `### This ask is on round ${String(round)} — what a claim at this depth may escalate is narrowed`,
    "",
    `Rounds one to ${String(REVIEW_ROUND_CAP)} are an answer converging. Past that, a round that finds a brand-new`,
    "problem in scope the question never requested is the failure this rule exists to stop: measured,",
    "six rounds over two hours, all of them rigorous, none of them about what the ask wanted. So for",
    "this verdict only:",
    "",
    "- the two standing claims still bind in full — the deliverable claim, the supersession claim — and so",
    "  does section 9's voice claim, exactly as on every round;",
    "- section 1c still binds in full: OPEN every attached image and record what you saw. A picture that is",
    "  unreadable at preview size, whose panel had not rendered, or whose axes and query a crop removed is a",
    "  `high`-impact finding on ANY round. It is not unrequested scope — it is the evidence the answer is",
    "  standing on, and it is what six clean rounds over the same two hours once shipped;",
    "- an image observation is never a settled `answer` claim and is never carried: an unchanged answer is not",
    "  an unchanged picture, because `images` are path strings and the answer digest cannot see the bytes move;",
    "- every claim listed under `This round` still binds in full;",
    "- a NEW claim about something the question DID ask for is `high` impact exactly as it always would be;",
    "- a NEW claim about analysis, comparison or characterisation the question did NOT ask for is `low`",
    "  impact, whatever it turns up, and never makes the outcome `broken` or `incomplete`. Write it down and",
    "  move on — it is worth the author knowing and is not worth another two hours.",
    "",
    "Nothing here lowers the bar on what is delivered. It stops unrequested scope from buying a round.",
    "",
  ];
}

/**
 * The breakage row an ask owes the ledger once it runs past the cap, so the pathology this file exists for is
 * durable rather than a line in whichever terminal happened to open the round.
 *
 * @param askIdentity the ask being reviewed again
 * @param atIso when the round opened
 * @param round which round this is, 1-based
 * @returns the row to append
 */
export function roundCapBreakage({
  askIdentity,
  atIso,
  round,
}: {
  askIdentity: AskIdentity;
  atIso: string;
  round: number;
}): LoopBreakage {
  return {
    atIso,
    cause:
      `this ask has already opened ${String(round - 1)} review round(s) without an answer clearing review, ` +
      `so another was opened past the cap of ${String(REVIEW_ROUND_CAP)}`,
    didInstead:
      "opened the round anyway with its packet narrowed — unrequested scope cannot raise the outcome past " +
      "the cap, and the answer still cannot post without a clean verdict",
    error: `review round ${String(round)} exceeds the cap of ${String(REVIEW_ROUND_CAP)}`,
    thread: `${askIdentity.channel}/${askIdentity.messageTs}`,
    what: `turn review opened round ${String(round)} for this ask`,
  };
}

/**
 * What the previous round settled, and what has moved in the answer since — the block that lets a round stop
 * re-deriving ground already covered, placed AFTER the answer and the evidence rather than in the preamble.
 *
 * Deliberately after: a reviewer that meets a list of prior conclusions before it has read the answer is
 * being anchored, and the whole value of an independent reviewer is that it is not. It reads the answer
 * first, then this.
 *
 * The wording is load-bearing and states the limits rather than assuming them. A carried claim is evidence to
 * inspect, never this round's verdict; the change list proves only which fields of the two answers differ and
 * proves nothing about live state; and a reviewer that reuses a finding says so rather than copying the
 * previous evidence string as though it had looked itself, which would forge the audit trail.
 *
 * Empty when the last round settled nothing carryable as settled — every claim it settled rested on live
 * state (those are {@link reReadClaimLines}'s), or was standing, or the round left no verdict at all.
 *
 * @param carriedSettled the high-impact, answer-resting claims the last round marked supported
 * @param changeLines `./answerChange.ts`'s account of which paths of the answer moved
 * @param round which round this is, 1-based
 * @returns the block's lines, in order
 */
export function settledClaimLines({
  carriedSettled,
  changeLines,
  round,
}: {
  carriedSettled: readonly SettledClaim[];
  changeLines: readonly string[];
  round: number;
}): readonly string[] {
  if (round <= 1 || carriedSettled.length === 0) {
    return [];
  }
  return [
    "## What the last round already settled",
    "",
    ...changeLines,
    "Each claim below was classified `supported` by the previous reviewer, which also declared that it rests",
    "on the ANSWER's own bytes rather than on live state — that is why it is here and a claim about the world",
    "never is (one whose read was recorded arrives in its own block, as a read to re-run). Previous support is",
    "evidence to inspect, not this round's verdict.",
    "",
    "You may reuse one: mark it `supported` and write, as its evidence, that it was settled in the previous",
    "round and which unchanged paths carry it. Do NOT copy the previous evidence string as though you read it",
    "yourself — `evidence` means where YOU looked, and copying forges the trail.",
    "",
    "Before reusing any of them, find the paths that express and qualify the claim. If a path in the change",
    "list above could contradict, qualify, re-source or change the impact of it, verify it from source",
    "instead. The change list proves only which fields of the two answers differ: it proves nothing about",
    "provider state, thread state, what a URL serves now, or what a file at a path contains now. Overturning a",
    "carried claim is a normal outcome, not an escalation.",
    "",
    "You still enumerate every material claim in the answer yourself, including the ones below.",
    "",
    ...carriedSettled.flatMap((claim) => [
      `- **${claim.text}**`,
      `  - the previous reviewer's evidence: ${claim.evidence}`,
    ]),
    "",
  ];
}

/**
 * What the previous round READ to settle its live claims — the block that hands a round the read to re-run
 * instead of the claim to rediscover. Placed after {@link settledClaimLines}, for the same reason that block
 * is placed after the answer: the reviewer reads the answer first, then what came before.
 *
 * The wording states what a re-read is and is not. The previous instant and command are the reviewer's
 * starting point, never its evidence: it runs the read NOW, writes its own `readCommand` and `readAtIso`,
 * and classifies what it sees. A read whose result has moved is an ordinary overturn. A command the reviewer
 * cannot run — a verb this checkout does not have, a query it cannot address — is verified from source as
 * on any round, and the packet says so rather than leaving the reviewer to infer that a re-read it cannot
 * perform is a claim it may skip.
 *
 * Empty when the last round recorded no read on any live claim it settled, or on round 1.
 *
 * @param carriedReads the high-impact, live-resting claims the last round marked supported with a read
 * @param round which round this is, 1-based
 * @returns the block's lines, in order
 */
export function reReadClaimLines({
  carriedReads,
  round,
}: {
  carriedReads: readonly ReReadClaim[];
  round: number;
}): readonly string[] {
  if (round <= 1 || carriedReads.length === 0) {
    return [];
  }
  return [
    "## What the last round read live — re-run the read, do not rediscover the claim",
    "",
    "Each claim below rests on LIVE state. The previous reviewer classified it `supported` and recorded the",
    "exact read that settled it and when. Nothing about that read is carried as true: the world may have",
    "moved since the instant shown, and the answer may no longer say what it said. What is carried is that",
    "the claim exists, what settles it, and how to look — so this round costs one read, not a rediscovery.",
    "",
    "For each: run the command yourself, NOW. Classify the claim from what YOU see. Write your own",
    "`readCommand` and `readAtIso` on it — never the previous instant, which would forge the trail — and",
    'keep `restsOn: "live"`. A result that has moved is an ordinary overturn, not an escalation. A command',
    "you cannot run as written is not a claim you may skip: verify it from source as on any round, and say",
    "in its evidence that the carried read could not be re-run and what you did instead.",
    "",
    "You still enumerate every material claim in the answer yourself, including the ones below.",
    "",
    ...carriedReads.flatMap((claim) => [
      `- **${claim.text}**`,
      `  - read at ${claim.readAtIso} by: \`${claim.readCommand}\``,
      `  - the previous reviewer's evidence: ${claim.evidence}`,
    ]),
    "",
  ];
}
