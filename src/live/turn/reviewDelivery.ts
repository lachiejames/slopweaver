/**
 * Whether a reviewer's pickup was ever actually SUBMITTED to its workspace — the delivery witness the
 * dispatch leg has had since `dispatch.ts`'s `unwitnessedPickupCorroboration`, and the review leg did not.
 *
 * ## The measured hole this closes
 *
 * The ask at message ts `1788325215.000100`: the reviewer booted into workspace:987, its full pickup line was
 * TYPED into the input box, and the Enter that submits it never took. cmux listed no
 * `latest_submitted_message` and no `latest_submitted_at` for that workspace, no verdict was ever written,
 * and the reviewer sat there for fourteen minutes. Over the same day, all three stranded WORKER pickups were
 * settled by `turn dispatch --sweep` against cmux's own delivery record, because the dispatch leg asks it.
 * The review leg asked nothing, so a stranded reviewer was reconciled by nothing at all.
 *
 * `turn review --poll` made it worse rather than merely missing it: its truth had one default arm, `working`,
 * reached whenever no verdict file was there, so it printed `reviewer still working — no verdict yet` for the
 * reviewer that was genuinely mid-verdict AND for the one that had never read a word. A default arm that is
 * false in the REASSURING direction is the shape that costs hours, and only the per-ask stall bound in
 * `turn resume`'s step 3 (`give up after ~20 minutes`) surfaced it at all.
 *
 * ## What the delivery record can and cannot say
 *
 * `cmux/sendEvidence.ts` carries the measurement and the direction it is safe in: the PRESENCE of a matching
 * `latest_submitted_message` is evidence of delivery; its ABSENCE is not evidence of non-delivery, because a
 * queued send left the field empty on workspace:398 while populating it immediately on
 * workspace:410. So {@link reviewerDelivery} answers three ways rather than two, and `none` is a REPORTABLE
 * DOUBT, never a proof.
 *
 * That is exactly why {@link reviewerPickupResubmission} needs a second, independent signal before it will
 * act: the pickup text VISIBLE on an idle screen. A reviewer whose prompt is rendered in its input box while
 * nothing is running and nothing is queued is not a session that consumed its instruction — it is one whose
 * Enter was dropped. Re-submitting THAT is pressing Enter on text already there, which is a different act
 * from re-SENDING the pickup: `cmux/pickupWitnessWindow.ts`'s `sendPickupOnceThenWitness` measured two duplicate pickups
 * from re-sending, and the damage there was a SECOND COPY of the text firing when the first turn
 * ended. Nothing here adds a copy.
 *
 * ## The composer wraps MID-TOKEN, so this module owns its own containment check
 *
 * {@link composerHoldsText} strips whitespace entirely rather than collapsing it, and that is the difference
 * between a gate that fires and one that never does. Measured against Claude Code v2.1.258 on a
 * live workspace, and reproduced here as a unit fixture: the composer hard-wraps a long line at the pane
 * width without regard for word boundaries and indents the continuation, so a pickup renders as
 * `…/packet.m` then `  d in full …`. `cmux/witness.ts`'s `witnessFromScreen` normalises that newline plus
 * indent to ONE space, leaving `packet.m d` against an expected `packet.md`, and its `includes` can never
 * match. Every real pickup line is long enough to wrap, so a gate built on that function held every single
 * time, on exactly the case it exists for. Reproduce with
 * `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/live/turn/reviewDelivery.test.ts -t wrapped`.
 *
 * **`witnessFromScreen` is deliberately NOT widened to fix this**, and the reason is that it answers the
 * opposite question. It asks whether a line was DELIVERED, where matching text that is merely typed and
 * unsent would report a stranded session as working. This module asks whether a line is SITTING UNSENT, so
 * matching exactly that is the goal rather than the hazard. Two questions, two comparisons, and collapsing
 * them would break the other caller.
 */
import { submittedMessageConfirmsSend } from "../../cmux/sendEvidence.js";
import { hostShowsQueuedMessage, hostShowsRunningTurn, runningTurnIsAssertable } from "../../cmux/turnBusy.js";
import { classifyTurnScreen } from "../../cmux/turnState.js";
import type { VisibleSessionHost } from "../../supervisor/session.js";
import { CHECKLIST_STALL_AFTER_MS } from "./liveStatus.js";

/**
 * How long a reviewer may show NO delivery record at all before that is reported as its own state rather
 * than folded into "still working".
 *
 * Shares {@link CHECKLIST_STALL_AFTER_MS} rather than choosing a second number, the same way
 * `dispatch.ts`'s `uncarriedAnswerDetail` does, and for the same reason: both answer "is the reader still
 * being told the truth?". It is NOT a fresh measurement of reviewer boot time and must not be read as one.
 * What the stranded-reviewer incident fixes is the CEILING — `turn resume`'s step 3 tells a worker to give up polling
 * after ~20 minutes, so any bound below that surfaces the stall before the poll loop ends, and five minutes
 * is comfortably clear of a boot (`cmux/spawn.ts`'s whole boot-plus-verify budget is ~45 ticks, well under
 * one minute). Reproduce the ceiling with
 * `grep -n 'give up after' src/cli/commands/turn/resume.ts`.
 */
export const REVIEWER_UNSUBMITTED_AFTER_MS = CHECKLIST_STALL_AFTER_MS;

/**
 * What cmux's own delivery record says about one reviewer workspace.
 *
 * Three answers, not two. `none` means cmux has never recorded ANYTHING submitted to this workspace, which
 * is the doubt worth reporting; `other-traffic` means something was submitted that is not this reviewer's
 * pickup, which is a workspace being used for something else and never a stranded pickup.
 */
export type ReviewerDelivery =
  | { readonly kind: "confirmed"; readonly submittedAtIso: string | undefined }
  | { readonly kind: "other-traffic"; readonly submittedAtIso: string | undefined }
  | { readonly kind: "none" };

/**
 * Classify a reviewer workspace's delivery record against the pickup it was supposed to receive.
 *
 * The comparison is `cmux/sendEvidence.ts`'s truncation-aware PREFIX check, never equality: cmux keeps only
 * the first 240 characters of a submitted message and the reviewer's pickup line is longer than that, so an
 * `includes` or `===` check could never match.
 *
 * @param pickup the exact pickup text this reviewer was sent, rebuilt from its record
 * @param workspace the workspace row cmux's inventory holds for it, or `undefined` when the inventory names
 *   no such workspace
 * @returns what the delivery record says
 */
export function reviewerDelivery({
  pickup,
  workspace,
}: {
  pickup: string;
  workspace:
    | { readonly latestSubmittedMessage: string | undefined; readonly latestSubmittedAtIso: string | undefined }
    | undefined;
}): ReviewerDelivery {
  if (workspace === undefined) {
    return { kind: "none" };
  }
  if (submittedMessageConfirmsSend({ latestSubmittedMessage: workspace.latestSubmittedMessage, sentText: pickup })) {
    return { kind: "confirmed", submittedAtIso: workspace.latestSubmittedAtIso };
  }
  if (workspace.latestSubmittedMessage !== undefined || workspace.latestSubmittedAtIso !== undefined) {
    return { kind: "other-traffic", submittedAtIso: workspace.latestSubmittedAtIso };
  }
  return { kind: "none" };
}

/**
 * How long a reviewer with NO delivery record has been sitting, once that is past
 * {@link REVIEWER_UNSUBMITTED_AFTER_MS} and therefore worth reporting as its own state.
 *
 * Pure — the clock is injected, never read. `undefined` for every other delivery, for an unparseable
 * instant, and inside the bound, so a caller that gets a number has a fact rather than a suspicion.
 *
 * @param delivery what cmux's delivery record says
 * @param spawnedAt when the reviewer's workspace was booted, from its own record
 * @param nowIso the current instant
 * @param quietAfterMs how long no delivery record may go unremarked; defaults to
 *   {@link REVIEWER_UNSUBMITTED_AFTER_MS}
 * @returns whole minutes waited, or `undefined` when there is nothing to report
 */
export function unsubmittedReviewerMinutes({
  delivery,
  spawnedAt,
  nowIso,
  quietAfterMs = REVIEWER_UNSUBMITTED_AFTER_MS,
}: {
  delivery: ReviewerDelivery;
  spawnedAt: string;
  nowIso: string;
  quietAfterMs?: number;
}): number | undefined {
  if (delivery.kind !== "none") {
    return undefined;
  }
  const spawned = Date.parse(spawnedAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(spawned) || Number.isNaN(now)) {
    return undefined;
  }
  const waitedMs = now - spawned;
  return waitedMs < quietAfterMs ? undefined : Math.floor(waitedMs / 60_000);
}

/** Every run of whitespace, removed rather than collapsed — see {@link composerHoldsText}. */
const WHITESPACE = /\s+/gu;

/**
 * Whether a rendered screen is showing this text in its composer, tolerant of the composer's mid-token wrap.
 *
 * Whitespace is REMOVED from both sides rather than collapsed, which is the whole point — see this module's
 * header for the measurement and for why `cmux/witness.ts`'s narrower check must stay narrow. The cost is
 * that a screen whose visible characters happen to concatenate to the pickup would match, which no real
 * terminal produces and which the other two conditions in {@link reviewerPickupResubmission} still bound.
 *
 * @param screen the surface's rendered text
 * @param text the exact line to look for
 * @returns whether the screen is showing it
 */
function composerHoldsText({ screen, text }: { screen: string; text: string }): boolean {
  const needle = text.replace(WHITESPACE, "");
  return needle.length > 0 && screen.replace(WHITESPACE, "").includes(needle);
}

/**
 * What one look at a reviewer's workspace says about whether it is WORKING, STRANDED, or neither.
 *
 * @internal — {@link reviewerStrandedness}'s return type; its two consumers are
 * {@link reviewerPickupResubmission} and `./review.ts`'s `reviewPollTruth`.
 */
export type ReviewerStrandedness =
  | { readonly kind: "mid-turn"; readonly reason: string }
  | { readonly kind: "typed-unsent"; readonly reason: string }
  | { readonly kind: "undetermined"; readonly reason: string };

/**
 * Classify a reviewer cmux holds no delivery record for: visibly working, provably stranded, or neither.
 *
 * ## The class this closes, in both of the directions it has failed
 *
 * Two verbs have now judged a live reviewer by a PROXY rather than by whether it is mid-verdict:
 *
 * - `turn dispatch --sweep` closed a mid-verdict reviewer on the PARENT's lease clock, until
 *   `./leaseJudgement.ts`'s `lease-held` made "an independent reviewer is mid-verdict" an answer that
 *   outranks the wall clock — three reviewers reaped (`./dispatch.ts`'s
 *   `terminalSweepAction`).
 * - `turn review --poll` reported a round-2 reviewer `NEVER STARTED` and prescribed `turn dispatch --sweep`
 *   while that reviewer was mid-verification. Observed live on the staging-pool ask:
 *   `cmux read-screen` showed workspace:295 running a turn at 5m22s, while the poll — which reads that same
 *   screen and was discarding it — asserted the reviewer had never read a word.
 *
 * The delivery record is the proxy in both, and this module's header states its limit: the PRESENCE of a
 * matching `latest_submitted_message` is evidence of delivery, its ABSENCE is evidence of nothing. The
 * DISPATCH leg has always treated it that way — an unwitnessed pickup is recorded `dispatch-unwitnessed`,
 * the worker is tracked like a running one, the line forbids a hand re-send, and a later sweep prints
 * `dispatch-witnessed (reconciled)` off cmux's own record. The review leg was the one reading absence as
 * certainty. So this function is where the question is asked once, and both legs route on it.
 *
 * ## Three answers, and why the busy check comes FIRST
 *
 * A session mid-turn renders its own pickup in its TRANSCRIPT, so {@link composerHoldsText} matches a
 * working reviewer as readily as a stranded one — it cannot tell them apart and was never meant to. Only
 * `cmux/turnBusy.ts`'s measured `esc to interrupt` and queued-message chrome distinguishes them, so it is
 * asked before anything else the screen can say. Under the previous order both paths reached the same
 * `hold`, so nothing was visibly wrong; the moment a caller needs "is it WORKING" rather than "may I press
 * Enter", the order IS the answer.
 *
 * `undetermined` is the honest majority answer and is a DOUBT, never a finding: an unreadable screen, a
 * screen showing neither the pickup nor a running turn, a HOST whose busy footer has never been measured
 * here, and a delivery record that says something all land there. A caller acts on `typed-unsent`, leaves
 * `mid-turn` alone, and on `undetermined` reports and confirms rather than prescribing an act that is
 * destructive if the doubt resolves the other way.
 *
 * **The host gate is the same defect one host over.** A reviewer inherits its WORKER's host
 * (`cli/commands/turn/review.ts`'s `planReviewSession` call), so a codex reviewer is reachable, not
 * hypothetical, and a host with no measured busy marker answers `false` from `hostShowsRunningTurn` while
 * hard at work. The busy read is the reviewer's OWN host's markers, never the union, so text in the other
 * host's shape printed in its transcript changes nothing. Reading that `false` as "idle" is judging the reviewer by a proxy exactly as the delivery
 * record did. So a host this module cannot read is `undetermined` by construction, whatever its composer
 * shows. Both hosts are readable now: `cmux/turnBusy.ts` carries Claude Code's footer and
 * Codex's measured `• Working (` status line and its queued header. A codex reviewer is `typed-unsent` only
 * when its screen also classifies `idle` under Codex's own composer (`cmux/turnState.ts`), so a screen in
 * some other host's shape never licenses an Enter into a Codex input box.
 *
 * @param delivery what cmux's delivery record says
 * @param host which model CLI the reviewer's workspace booted, from its own record
 * @param pickup the exact pickup text this reviewer was sent
 * @param screen the reviewer surface's rendered text, or `undefined` when it could not be read
 * @returns which of the three this reviewer is, and the observation that settled it
 */
export function reviewerStrandedness({
  delivery,
  host,
  pickup,
  screen,
}: {
  delivery: ReviewerDelivery;
  host: VisibleSessionHost;
  pickup: string;
  screen: string | undefined;
}): ReviewerStrandedness {
  if (delivery.kind !== "none") {
    return { kind: "undetermined", reason: `cmux's delivery record for this workspace reads ${delivery.kind}` };
  }
  if (screen !== undefined && (hostShowsRunningTurn({ host, screen }) || hostShowsQueuedMessage({ host, screen }))) {
    return {
      kind: "mid-turn",
      reason:
        "a turn is running or a message is queued on its screen — this reviewer is working, and its own input is not yours",
    };
  }
  if (!runningTurnIsAssertable({ host })) {
    return {
      kind: "undetermined",
      reason: `nothing here has measured what a running turn looks like on ${host}, so an idle-looking screen proves nothing`,
    };
  }
  if (screen === undefined) {
    return {
      kind: "undetermined",
      reason: "the reviewer's screen could not be read, so nothing says what is in its input",
    };
  }
  if (host === "codex" && classifyTurnScreen({ host, screen }) !== "idle") {
    return {
      kind: "undetermined",
      reason: "the screen does not show Codex's own composer at rest, so nothing says the pickup sits in its input",
    };
  }
  if (!composerHoldsText({ screen, text: pickup })) {
    return { kind: "undetermined", reason: "the pickup line is not visible on the reviewer's screen" };
  }
  return {
    kind: "typed-unsent",
    reason: "the pickup line is typed into an idle input box and cmux has no record of it ever being submitted",
  };
}

/**
 * Whether the sweep may press Enter on a reviewer's typed-but-unsent pickup, and why.
 *
 * @internal — {@link reviewerPickupResubmission}'s return type; the only consumer is
 * `../../cli/commands/turn/reviewSurface.ts`, which maps it straight onto its own outcome.
 */
export type ReviewerPickupResubmission =
  { readonly kind: "submit"; readonly reason: string } | { readonly kind: "hold"; readonly reason: string };

/**
 * Whether a stranded reviewer's pickup is sitting TYPED AND UNSENT in its input box, and may therefore be
 * submitted by pressing Enter.
 *
 * Exactly {@link reviewerStrandedness}'s `typed-unsent` arm and nothing else, which is what stops this verb
 * and `turn review --poll` from ever disagreeing about one reviewer. Three conditions, all required, because
 * each one alone is ambiguous:
 *
 * - cmux holds NO delivery record for the workspace — necessary, and on its own not evidence of anything
 *   (see this module's header).
 * - nothing is running and nothing is queued (`cmux/turnBusy.ts`) — a session mid-turn owns its own input,
 *   and an Enter sent into one would submit whatever else is there.
 * - the pickup text is VISIBLE on the rendered screen ({@link composerHoldsText}, which tolerates the
 *   composer's mid-token wrap) — which, with no delivery record and no running turn, means it is in the
 *   input box rather than in a transcript, since a consumed prompt fires `UserPromptSubmit` and populates
 *   the record.
 *
 * An unreadable screen HOLDS. That direction is deliberate and matches `cmux/witness.ts`: a screen that will
 * not read is not evidence about what is in the box, and the cost of holding is one more sweep tick while
 * the cost of acting on a guess is a keystroke into a session doing real work.
 *
 * @param delivery what cmux's delivery record says
 * @param host which model CLI the reviewer's workspace booted, from its own record
 * @param pickup the exact pickup text this reviewer was sent
 * @param screen the reviewer surface's rendered text, or `undefined` when it could not be read
 * @returns whether to submit, and the reason either way
 */
export function reviewerPickupResubmission({
  delivery,
  host,
  pickup,
  screen,
}: {
  delivery: ReviewerDelivery;
  host: VisibleSessionHost;
  pickup: string;
  screen: string | undefined;
}): ReviewerPickupResubmission {
  const stranded = reviewerStrandedness({ delivery, host, pickup, screen });
  return stranded.kind === "typed-unsent"
    ? { kind: "submit", reason: stranded.reason }
    : { kind: "hold", reason: stranded.reason };
}
