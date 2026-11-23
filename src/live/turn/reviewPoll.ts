/**
 * The READ side of one review — how its verdict file reads, what that means about the reviewer right now,
 * and the lines `turn review --poll` prints for it. Pure: `./reviewStore.ts` does the files,
 * `../../cli/commands/turn/review.ts` does cmux, and `./review.ts` composes the packet this never reads.
 *
 * Split out of `./review.ts` along the seam its own header already names: that module is the RECORD and the
 * PACKET — an address and a briefing composed from the answer's bytes — while everything here is a judgement
 * about a running reviewer made from evidence the record does not carry. Nothing here is imported by the
 * packet side, so the dependency runs one way.
 *
 * ## Reading a verdict and closing a reviewer are two acts
 *
 * They used to be one, and that was a defect with a measured cost. `--poll` closed `record.reviewer` whenever
 * a verdict file parsed — and the verdict path is fixed per ask, so a file a PREVIOUS round's reviewer left
 * there made every poll tear down the reviewer that was mid-verdict. Twelve reviewer workspaces died that way
 * across two hours. {@link reviewPollTruth} is the one classification both verbs read, and
 * {@link reviewPollClosure} is the only thing that may act on it.
 */

import { basename } from "node:path";

import type { ReviewOutcome, ReviewVerdict } from "../../admit/reviewVerdict.js";
import type { PhantomReason, WorkspaceLiveness } from "../../cmux/liveness.js";
import type { LoopBreakage } from "./loopBreakage.js";
import { type ReviewRecord, reviewerPickupPrompt } from "./review.js";
import { type ReviewerDelivery, reviewerStrandedness, unsubmittedReviewerMinutes } from "./reviewDelivery.js";

/** What `--poll` found for one review, read fresh. */
export type ReviewPollTruth =
  | {
      readonly kind: "verdict";
      readonly outcome: ReviewOutcome;
      readonly path: string;
      readonly digestMatches: boolean;
    }
  | { readonly kind: "superseded"; readonly path: string; readonly wroteIt: string }
  | { readonly kind: "working"; readonly reconciledDoubt: string | undefined }
  | {
      readonly kind: "pickup-unsent";
      readonly waitedMinutes: number;
      readonly workspaceRef: string;
      readonly reason: string;
    }
  | {
      readonly kind: "delivery-unwitnessed";
      readonly waitedMinutes: number;
      readonly workspaceRef: string;
      readonly reason: string;
    }
  | { readonly kind: "phantom"; readonly reason: string; readonly why: PhantomReason }
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * How the verdict file read, before liveness is consulted.
 *
 * `present` means the RECORDED reviewer's own verdict and nothing else. A file written by a previous round's
 * reviewer reads `superseded`, never `present`, so no caller can treat it as this review's answer by reading
 * one field and stopping — see {@link verdictSpeaksForReviewer}.
 */
export type VerdictFileRead =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly verdict: ReviewVerdict }
  | { readonly kind: "superseded"; readonly verdict: ReviewVerdict; readonly wroteIt: string }
  | { readonly kind: "invalid"; readonly reason: string };

/**
 * Classify one review's current state from its verdict file and, when that file does not speak for the
 * RECORDED reviewer, the reviewer workspace's liveness. A verdict this reviewer wrote outranks any liveness
 * verdict — a reviewer that wrote its file and then exited is DONE, not a phantom, exactly as
 * `liveScreenRead.ts` treats a worker's marker. A malformed verdict is reported as such rather than as "still
 * working", because the reviewer is not going to fix it unprompted.
 *
 * ## Whose verdict it is, before what it says
 *
 * The verdict path is fixed per ask, so a re-opened review can find the PREVIOUS round's file sitting in it.
 * That file is not evidence about the reviewer now recorded, and `reviewStore.ts`'s header carries what
 * treating it as such cost: twelve reviewer workspaces closed mid-verdict across two hours.
 * `superseded` is the arm that keeps the two apart, matched on `reviewerSession` — which the packet MINTED
 * for this reviewer from its own workspace ref and id, so it names one round and no other. Never matched on
 * elapsed time or on how far the reviewer had got: how long one survived was only how soon its worker polled.
 * `reviewStore.ts` archives such a file when the round opens, and that is NOT enough to make `superseded`
 * unreachable: a previous round's reviewer still alive can write its verdict AFTER the next round opened.
 * Measured on workspace:971, ask `C0SYN000002/1792725097.691199`. So `--poll` archives a
 * late one itself and records the breakage ({@link lateReviewerVerdictBreakage}); this arm stays the pure
 * classification that keeps a foreign verdict from ever reading as `present`.
 *
 * ## `working` is no longer the one default arm, and that was the reassuring lie
 *
 * Every read that was not a verdict, a phantom or a bad file used to fall through to `working`, so a
 * reviewer that had never been handed its instruction reported identically to one mid-verdict. Measured
 * On the ask at message ts `1788325215.000100`: fourteen minutes of `reviewer still working — no verdict yet`
 * over a workspace whose pickup was typed and never submitted. That is what the delivery witness closed —
 * `./reviewDelivery.ts` holds it and its bound.
 *
 * ## …and the missing delivery record is not the OPPOSITE certainty either
 *
 * The first fix asserted the mirror-image lie. A single `never-started` arm was reached whenever cmux held
 * no delivery record past the bound, and it told the worker to re-submit with `turn dispatch --sweep` — over
 * a reviewer that was mid-verification. Observed live on the staging-pool ask, workspace:295
 * read WORKING at 5m22s while the poll called it never started. The absence of a delivery record is not
 * evidence of non-delivery (`./reviewDelivery.ts`'s header carries the queued-send measurement that settles
 * it), so absence alone can only ever be a DOUBT.
 *
 * So the screen this poll already reads decides, through the one classifier the sweep's own re-submission
 * arm routes on ({@link reviewerStrandedness}): a reviewer visibly mid-turn is `working` and carries the
 * reconciliation in its own line, a pickup provably typed into an idle box is `pickup-unsent`, and
 * everything else is `delivery-unwitnessed` — reported as a doubt whose remedy is to look, not to act.
 *
 * @param record the review being polled — its `answerDigest` is the current one, and what a present verdict is
 *   checked against; the verdict file's own digest is never treated as authoritative
 * @param verdictRead how the verdict file read
 * @param liveness what cmux says about the reviewer's workspace, consulted whenever the file is not this
 *   reviewer's own verdict
 * @param delivery what cmux's own delivery record says about the reviewer's pickup. Required rather than
 *   defaulted: a default would have to be one of the arms, and every arm but `none` reads as reassurance —
 *   which is the exact failure this parameter was added to remove
 * @param screen the reviewer surface's rendered text, or `undefined` when it could not be read. Required for
 *   the same reason `delivery` is: defaulting it to `undefined` would silently turn every caller that forgot
 *   it into one that can only report the doubt, and a working reviewer would go on being called stranded
 * @param nowIso the current instant, which is what turns "no delivery record" into a duration worth reporting
 * @returns the review's current truth
 */
export function reviewPollTruth({
  record,
  verdictRead,
  liveness,
  delivery,
  screen,
  nowIso,
}: {
  record: ReviewRecord;
  verdictRead: VerdictFileRead;
  liveness: WorkspaceLiveness;
  delivery: ReviewerDelivery;
  screen: string | undefined;
  nowIso: string;
}): ReviewPollTruth {
  if (verdictRead.kind === "present") {
    return {
      digestMatches: verdictRead.verdict.answerDigest === record.answerDigest,
      kind: "verdict",
      outcome: verdictRead.verdict.outcome,
      path: record.verdictPath,
    };
  }
  if (liveness.kind === "phantom") {
    return { kind: "phantom", reason: liveness.reason, why: liveness.why };
  }
  if (verdictRead.kind === "invalid") {
    return { kind: "unreadable", reason: verdictRead.reason };
  }
  if (verdictRead.kind === "superseded") {
    return { kind: "superseded", path: record.verdictPath, wroteIt: verdictRead.wroteIt };
  }
  const waitedMinutes = unsubmittedReviewerMinutes({ delivery, nowIso, spawnedAt: record.spawnedAt });
  if (waitedMinutes === undefined) {
    return { kind: "working", reconciledDoubt: undefined };
  }
  const stranded = reviewerStrandedness({
    delivery,
    host: record.reviewer.host,
    pickup: reviewerPickupPrompt({ packetPath: record.packetPath, verdictPath: record.verdictPath }),
    screen,
  });
  if (stranded.kind === "mid-turn") {
    return { kind: "working", reconciledDoubt: stranded.reason };
  }
  const workspaceRef = record.reviewer.workspaceRef;
  if (stranded.kind === "typed-unsent") {
    return { kind: "pickup-unsent", reason: stranded.reason, waitedMinutes, workspaceRef };
  }
  return { kind: "delivery-unwitnessed", reason: stranded.reason, waitedMinutes, workspaceRef };
}

/**
 * Whether a parsed verdict was written by the reviewer a record names, rather than by a previous round's.
 *
 * Applied in the READ path (`reviewStore.ts`'s `readVerdictFile`) rather than at each use, so that no caller
 * anywhere can obtain a foreign verdict as `present`. The one field that settles it is `reviewerSession`,
 * which the packet mints from the reviewer's own workspace ref AND id — the id being what keeps the name
 * pointing at one session after cmux renumbers refs.
 *
 * The digest is deliberately NOT part of this question. Whose verdict it is and which bytes it bound to are
 * two separate checks, and conflating them is how a re-review of the SAME bytes would read as somebody
 * else's: `record.json`'s `answerDigest` is the current one, the verdict file's is only ever a claim about
 * what that reviewer saw, and `admit/answerQualityGate.ts` re-derives the truth from the answer's own bytes.
 *
 * @param reviewerSession the recorded reviewer's name, from `record.json`
 * @param verdict the parsed verdict found at the record's verdict path
 * @returns whether the file speaks for that reviewer
 */
export function verdictSpeaksForReviewer({
  reviewerSession,
  verdict,
}: {
  reviewerSession: string;
  verdict: ReviewVerdict;
}): boolean {
  return verdict.reviewerSession === reviewerSession;
}

/**
 * What `--close` may actually do to a reviewer, and why — the decision that used to be an inline
 * `truth.kind === "verdict"` and closed a working reviewer every time a stale file was on disk.
 *
 * TWO answers rather than one, because the workspace and the session-ledger row can be in different states.
 * A `workspace-gone` phantom has nothing left to close — asking cmux again would only produce a `not_found`
 * for an operator to read past — but its ledger row is still standing open and IS the caller's to release,
 * or the board keeps naming a reviewer that no longer exists. Collapsing the two would leak one or the other.
 *
 * Releasing is permitted by exactly the truths that prove the reviewer is not working: its OWN verdict is
 * written, or cmux says the workspace is a phantom. Never elapsed time, and never "a verdict file parsed".
 *
 * @param truth the review's current truth
 * @returns whether to ask cmux to close the workspace, whether to fold the ledger row, and the reason
 */
export function reviewPollClosure({ truth }: { truth: ReviewPollTruth }): {
  readonly closeWorkspace: boolean;
  readonly releaseLedger: boolean;
  readonly reason: string;
} {
  if (truth.kind === "verdict") {
    return { closeWorkspace: true, releaseLedger: true, reason: "its own verdict is written" };
  }
  if (truth.kind === "phantom") {
    return truth.why === "host-exited"
      ? { closeWorkspace: true, releaseLedger: true, reason: "the host exited and left an idle shell" }
      : {
          closeWorkspace: false,
          releaseLedger: true,
          reason: "cmux no longer lists the workspace — nothing left to close, but its board row was still open",
        };
  }
  if (truth.kind === "pickup-unsent") {
    return {
      closeWorkspace: false,
      releaseLedger: false,
      reason:
        "the reviewer's pickup is sitting typed and unsent — it wants re-submitting rather than its workspace " +
        "closing",
    };
  }
  if (truth.kind === "delivery-unwitnessed") {
    return {
      closeWorkspace: false,
      releaseLedger: false,
      reason:
        "cmux holds no delivery record for this reviewer's pickup, which is a doubt and not proof it stopped — " +
        `${truth.reason}`,
    };
  }
  return { closeWorkspace: false, releaseLedger: false, reason: "nothing proves the reviewer has stopped working" };
}

/** The `cause` a reviewer-death row carries, per checkable reason cmux gave for the missing session. */
const PHANTOM_CAUSE: Readonly<Record<PhantomReason, string>> = {
  "host-exited": "host-exited: the reviewer's workspace still exists but the agent host process in it exited",
  "workspace-gone": "workspace-gone: the reviewer's cmux workspace no longer exists, so its session went with it",
};

/**
 * The breakage row a reviewer's death is worth, from everything the record still knows about it.
 *
 * The point is the LAST KNOWN STATE, not the fact of the death: a row saying "the reviewer died" is what the
 * poll line already says. Which workspace, under which session name, spawned when, bound to which digest, and
 * how the verdict file read is what a reader an hour later actually needs, and it is all in the record the
 * poll is holding at the moment it finds out.
 *
 * @param atIso when the death was discovered — injected, never read from a clock here
 * @param record the review whose reviewer is gone
 * @param truth the phantom truth, carrying cmux's own reason
 * @returns the row to append
 */
export function reviewerDeathBreakage({
  atIso,
  record,
  truth,
}: {
  atIso: string;
  record: ReviewRecord;
  truth: Extract<ReviewPollTruth, { kind: "phantom" }>;
}): LoopBreakage {
  const { cwd, host, sessionName, workspaceId, workspaceRef } = record.reviewer;
  // Both fields are optional on a `FreshVisibleSessionRef`, and the row has to say WHICH — a reader chasing a
  // dead reviewer by name needs to know the record never held one, not read a plausible-looking placeholder
  // as the name itself (`no-silent-fallback`).
  let named = `session ${String(sessionName)}`;
  if (sessionName === undefined) {
    named = "session (the record carries no session name)";
  }
  let where = `cwd ${String(cwd)}`;
  if (cwd === undefined) {
    where = "cwd (the record carries no cwd)";
  }
  return {
    atIso,
    cause: PHANTOM_CAUSE[truth.why],
    didInstead: `reported the death to the poll's caller and left ${record.verdictPath} untouched; the answer still has no verdict, so re-run turn review to open a fresh reviewer`,
    error: truth.reason,
    thread: `${record.channel}/${record.messageTs}`,
    what:
      `the reviewer for this ask died before writing a verdict — workspace ${workspaceRef} ` +
      `(${workspaceId}), ${named}, host ${host}, spawned ${record.spawnedAt}, bound to ` +
      `${record.answerDigest}, ${where}, cause ${truth.why}`,
  };
}

/**
 * The instant a LATE previous-round verdict is archived under: one millisecond before the round now standing
 * was spawned.
 *
 * The round that wrote it was spawned at some instant nothing on disk still holds — its `record.json` was
 * overwritten when this round opened, and it had no verdict then for `archiveSupersededVerdict` to name. The
 * latest instant it can have been spawned at is just before the round that displaced it, and that is what
 * places it strictly BEFORE the standing round in `./checkpoint.ts`'s ordering, where it belongs.
 *
 * @param record the review now standing
 * @returns the ISO instant to archive the late verdict under
 */
export function lateVerdictArchiveInstant({ record }: { record: ReviewRecord }): string {
  return new Date(Date.parse(record.spawnedAt) - 1).toISOString();
}

/**
 * The breakage row a late previous-round verdict is worth, once the poll has archived it.
 *
 * MEASURED on ask `C0SYN000002/1792725097.691199`: the previous round's reviewer
 * (workspace:971) wrote `verdict.json` AFTER the next round opened, so the archive at round open had nothing to
 * move and every poll refused on a file no verb could clear. The worker `mv`'d it by hand and round 2 then
 * completed, and the loop-breakage ledger gained no row, because the class was a session's to remember. The
 * poll now archives it itself and writes this row, so the incident is counted by the code that saw it.
 *
 * @param archivedPath where the poll moved the file
 * @param atIso when the poll found and moved it — injected, never read from a clock here
 * @param record the review now standing, whose reviewer is still owed its own verdict
 * @param wroteIt the `reviewerSession` the moved verdict names — the previous round's reviewer
 * @returns the row to append
 */
export function lateReviewerVerdictBreakage({
  archivedPath,
  atIso,
  record,
  wroteIt,
}: {
  archivedPath: string;
  atIso: string;
  record: ReviewRecord;
  wroteIt: string;
}): LoopBreakage {
  return {
    atIso,
    cause:
      "the previous round's reviewer wrote its verdict after this round opened, so the archive at round open " +
      "had nothing to move and the fixed verdict path held a verdict that speaks for no reviewer now recorded",
    didInstead:
      `turn review --poll archived it to ${archivedPath} and kept polling ${record.reviewerSession}, ` +
      "whose own verdict lands at the same path",
    error: `${record.verdictPath} holds a PREVIOUS round's verdict, written by ${wroteIt}`,
    thread: `${record.channel}/${record.messageTs}`,
    what:
      `turn review --poll found a late verdict from ${wroteIt} over the round spawned ${record.spawnedAt} ` +
      `(${record.reviewerSession}) — archived as ${basename(archivedPath)}`,
  };
}

/**
 * What a CLEAN verdict entitles a worker to do, said at the moment it reads one.
 *
 * MEASURED in the weekend private dogfood: one ask reached review round SIX over three and a half
 * hours while holding a clean verdict since round 3, and never posted. Its worker was treating the LOW-impact
 * claims a clean verdict still lists as work to do — in its own words, *"each fix invalidates the digest and
 * costs another spawn"*, a stopping rule it reasoned out for itself at round 6.
 *
 * `../reviewRounds.ts`'s `REVIEW_ROUND_CAP` could not catch it and did not fail: that caps what a late round
 * may be ABOUT, and it worked — outcomes went clean at round 3 and stayed clean. It measures whether the
 * ANSWER is acceptable. Nothing measured whether the WORKER keeps volunteering new ones.
 *
 * The coupling is what makes a polish non-convergent rather than merely wasteful, so the line names it: a
 * verdict binds an answer DIGEST, so revising after clean voids the very verdict that cleared it. Every
 * improvement destroys its own permission to post.
 *
 * ## The trade this makes, stated rather than denied
 *
 * Codex's review pass killed an earlier wording that claimed this lowered no bar. It does lower one, and
 * the counterexample is exact: a reviewer that lists "the backup retention period is 30 days" as
 * unsupported but LOW impact, on an answer where 7 is the truth, returns `clean` — and
 * `../../admit/answerQualityGate.ts`'s `claimFindings` only blocks on `high`, while the answer form checks
 * shape and citations rather than entailment. Nothing else catches it. So this line rests on the
 * REVIEWER'S IMPACT CLASSIFICATION being right, and a misclassification now ships instead of being caught
 * by a round the worker would otherwise have taken.
 *
 * That is accepted deliberately against a MEASURED cost on the other side — six rounds and three and a
 * half hours on one ask, twice in one day — and it is why the line says clean is enough for POLISH rather
 * than clean is enough full stop. A claim that is materially wrong is not polish, and the worker is told
 * so in the same breath.
 *
 * The same exception has to reach the RECOVERY advice, and Codex's second pass caught that it did not. An
 * earlier wording told any worker that had edited after a pass to restore the reviewed bytes and send.
 * That reverses a SUBSTANTIVE correction — a reviewer can mark a high-impact claim `supported` in error,
 * the worker can then find the claim is false and fix it, and "restore and send" would put the false one
 * back, where the door's high-impact check passes it because the verdict called it supported. So the limb
 * now branches on what the edit WAS, and restoring is offered only for a polish. The same pass also noted
 * that editing and a mis-bound digest can coexist, so restoring is described as the cheap path to TRY
 * rather than a guaranteed repair.
 *
 * @internal — one home for the wording, so this file and its test quote the same bytes.
 */
export const CLEAN_IS_SUFFICIENT =
  "clean is ENOUGH for POLISH — revising now rewrites the answer digest and VOIDS this verdict, so a " +
  "tidy-up costs a whole round. A remaining unsupported claim that is materially WRONG is not polish: " +
  "the reviewer misjudged its impact, and fixing it is worth the round.";

/**
 * What to say when a verdict exists but is bound to other bytes than the answer in hand.
 *
 * Split from {@link reviewPollLines} rather than inlined, because the CLEAN arm has to carry a real
 * decision — see {@link CLEAN_IS_SUFFICIENT}'s note on why restoring is offered only for a polish — and
 * that pushed the caller past the `max-function-lines` cap.
 *
 * @param outcome the outcome the mis-bound verdict carries
 * @returns the advice lines, which the caller prints after the mismatch line itself
 */
function mismatchAdvice({ outcome }: { outcome: ReviewOutcome }): readonly string[] {
  if (outcome !== "clean") {
    return ["the reviewer bound its verdict to different bytes: review again rather than editing either file"];
  }
  return [
    "that verdict was CLEAN, and it is bound to bytes other than the ones you hold.",
    "If your edit was a POLISH, restoring the reviewed bytes is the cheap path — and if the door",
    "still refuses them, the reviewer mis-bound its verdict and this needs a fresh review anyway.",
    "If your edit CORRECTED something the review got wrong, KEEP it and take the round. Never",
    "restore your way past a real fix.",
  ];
}

/**
 * The one re-submission instruction, worded so it can never be read as an instruction to type.
 *
 * Its own constant because BOTH unwitnessed arms end in it and they must say the identical thing — the
 * provable one as the act to take now, the doubtful one as the act to take only after looking. A second
 * wording is how one of them would drift into advising a hand re-send, which is the act
 * `../../cmux/pickupWitnessWindow.ts`'s `sendPickupOnceThenWitness` measured firing a duplicate pickup.
 *
 * @internal — one home for the wording, so this file and its test quote the same bytes.
 */
const RESUBMIT_INSTRUCTION =
  "re-submit it with slopweaver turn dispatch --sweep, which presses Enter on the copy already in the box. " +
  "Never type the line in by hand";

/**
 * What `--poll` prints for a reviewer cmux holds no delivery record for — the two arms that used to be one
 * `NEVER STARTED` certainty.
 *
 * Split out of {@link reviewPollLines} for the reason {@link mismatchAdvice} was: the doubt arm has to carry
 * the confirmation step, the working reading and the conditional remedy, and inlining three lines of it
 * pushed the caller past the `max-function-lines` cap.
 *
 * @param truth whichever unwitnessed arm the poll reached
 * @returns the lines to print, in order
 */
function unwitnessedReviewerLines({
  truth,
}: {
  truth: Extract<ReviewPollTruth, { kind: "delivery-unwitnessed" | "pickup-unsent" }>;
}): readonly string[] {
  const waited = `in the ${String(truth.waitedMinutes)}m since it was spawned`;
  if (truth.kind === "pickup-unsent") {
    return [
      `reviewer pickup TYPED AND UNSENT: nothing has been submitted to ${truth.workspaceRef} ${waited}, and ` +
        `${truth.reason}`,
      `this is not a slow review — ${RESUBMIT_INSTRUCTION}`,
    ];
  }
  return [
    `reviewer delivery UNWITNESSED: cmux holds no record of anything submitted to ${truth.workspaceRef} ` +
      `${waited} — ${truth.reason}`,
    "no delivery record found is a DOUBT and never proof the reviewer never started: confirm with slopweaver " +
      `cmux read-screen --workspace ${truth.workspaceRef} before re-submitting`,
    "a turn running on that screen means the reviewer is WORKING — poll again and leave it alone. Only a " +
      `pickup sitting in an IDLE input box wants re-submitting, and then you ${RESUBMIT_INSTRUCTION}`,
  ];
}

/**
 * The lines `--poll` prints for one truth, and whether that is a finished review.
 *
 * @param truth the review's current truth
 * @returns the lines, and `done` when the verdict exists and may be carried to the door
 */
export function reviewPollLines({ truth }: { truth: ReviewPollTruth }): {
  readonly lines: readonly string[];
  readonly done: boolean;
} {
  switch (truth.kind) {
    case "verdict":
      return {
        done: truth.digestMatches,
        lines: truth.digestMatches
          ? [
              `verdict: ${truth.outcome} ${truth.path}`,
              ...(truth.outcome === "clean"
                ? ["carry it to the door: slopweaver turn answer … --verdict " + truth.path, CLEAN_IS_SUFFICIENT]
                : [
                    "the door will refuse this — read the verdict's claims, fix the answer, re-validate and review again",
                  ]),
            ]
          : [
              `verdict: ${truth.outcome} ${truth.path} — but its answerDigest is not this answer's digest; the door will refuse it`,
              ...mismatchAdvice({ outcome: truth.outcome }),
            ],
      };
    case "superseded":
      return {
        done: false,
        lines: [
          `REFUSED: ${truth.path} holds a PREVIOUS round's verdict, written by ${truth.wroteIt} — not this reviewer's`,
          "it is not this answer's review and re-reading it will never make it current; record.json's answerDigest is the authoritative one",
          "turn review --poll archives a file like this itself and records it in the loop-breakage ledger — poll again; a refusal that repeats means that archive is failing, and the line before this one says why",
        ],
      };
    case "working":
      return {
        done: false,
        lines: [
          truth.reconciledDoubt === undefined
            ? "reviewer still working — no verdict yet; poll again"
            : "reviewer still working — no verdict yet; poll again. cmux holds no delivery record for its " +
              `pickup, which reconciles off the screen instead: ${truth.reconciledDoubt}`,
        ],
      };
    case "pickup-unsent":
    case "delivery-unwitnessed":
      return { done: false, lines: unwitnessedReviewerLines({ truth }) };
    case "phantom":
      return {
        done: false,
        lines: [`reviewer died before writing a verdict: ${truth.reason} — run turn review again`],
      };
    case "unreadable":
      return { done: false, lines: [`the verdict file exists but is not a valid verdict: ${truth.reason}`] };
  }
}

/**
 * Whether `--poll --wait` stops on this truth. Only `working` is worth reading again: every other arm is a
 * verdict to carry, or a state that another read will not change without somebody acting — a dead reviewer,
 * a superseded or malformed file, a pickup nobody saw land. Waiting on one of those would spend the whole
 * timeout to report what the first read already knew.
 *
 * @param truth the review's current truth
 * @returns true when the wait is over
 */
export function reviewWaitSettled({ truth }: { truth: ReviewPollTruth }): boolean {
  return truth.kind !== "working";
}
