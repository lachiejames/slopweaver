/**
 * Effectful shell for `slopweaver github enqueue` — the verb that presses GitHub's own "Merge when ready".
 *
 * ## The order is the contract
 *
 *   parse → merge hold → token → read the pull request → resolve its LANDING branch → read that branch's
 *   queue and required contexts → verdict → [refused or already stops here] → private-terms sweep of the
 *   prospective tree (`./enqueuePrivateTerms.ts`; a hold or an unwaived unchecked stops here) → [dry run stops
 *   here] → Codex floor re-read → ratchet-bump witness (a hold: no acknowledgement reaches it) → resolve the
 *   author's own walkthrough threads → door → write → confirm → report
 *
 * Four points are load-bearing rather than incidental:
 *
 *  - **The dry run stops before any WRITE, not before the reads.** Unlike `github merge`'s report path,
 *    which measures two local git refs, every fact this verb judges lives on GitHub — so a preview that
 *    reached no network could only report a guess. It performs no door record, no mutation, no asynchronous
 *    poll and no wait. The one thing it CAN leave behind is `noteStaleHolds`' warning: reading the hold is
 *    what publishes a stale one (`./holdDeps.ts`'s header says why nothing polls for it), and that read
 *    happens before this verb knows it is a dry run. Suppressing it would make a dry run silently swallow a
 *    warning the fleet depends on, so it stands — named here rather than left as a surprise, after a Codex
 *    review read the shorter claim as a promise this verb does not keep.
 *  - **Success is reported only after a read-back of `mergeQueueEntry`.** The mutation's own payload carries
 *    an entry and it is discarded, for the reason `github ready` re-reads its transition: a mutation that
 *    reports its own success is exactly the class of claim this repository refuses.
 *  - **The LANDING branch is not always the pull request's base.** A native-stack member above the bottom
 *    targets the branch of the member below it; the queue lives on the stack's own base. `./enqueueTarget.ts`
 *    resolves it, and the queue read, the required-context read and every refusal use what it answers.
 *  - **Membership picks the transport, before the door.** GitHub's GraphQL mutation refuses a stack member,
 *    so one goes through the asynchronous merge REST request instead — sent inside the door exactly as the
 *    mutation is, and followed by the bounded confirmation loop in `./enqueueAsyncRun.ts`. There is no flag:
 *    the choice is a property of the pull request.
 *
 * ## The merge hold runs FIRST, before the token and before the network
 *
 * A standing hold refuses this verb exactly as it refuses `github merge`, and it is read before the token so
 * a session told to wait learns that from one local file read rather than after three GitHub round-trips.
 * `outbound/github/mergeHold.ts`'s header carries the measurement that made this caller necessary: with the
 * gate on `merge` alone, every hold placed after the queue landed stood on a base where nobody merges.
 *
 * `--dequeue` is exempt, on this verb's own reasoning about it: leaving a queue only ever narrows what
 * happens next, so refusing it would refuse the one act that clears a competing entry out of the holder's
 * way.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorAcknowledgement } from "../../../admit/types.js";
import type { CodexLoopInspection } from "../../../codex/landingGate.js";
import type { MergeQueuePrState } from "../../../live/github/mergeQueue.js";
import { holdFor, mergeHoldGate } from "../../../outbound/github/mergeHold.js";
import type { GithubMergeQueueApi } from "../../../outbound/github/mergeQueue.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { GITHUB_ENQUEUE_USAGE, type GithubEnqueueArgs, parseGithubEnqueueArgs } from "./enqueueArgs.js";
import { readFloorFor, recheckedFloorWaivers, refusedByBump } from "./enqueueCodexLoop.js";
import { enqueueDoorRequest, enqueueJsonDocument, enqueueVerdict, enqueueWitnessOutcome } from "./enqueueCore.js";
import { type GithubEnqueueDeps, productionGithubEnqueueDeps } from "./enqueueDeps.js";
import { mutateAndConfirm } from "./enqueueMutate.js";
import { enqueuePrivateTermsStep } from "./enqueuePrivateTerms.js";
import { type EnqueueState, readEnqueueState } from "./enqueueRead.js";
import type { EnqueueTarget } from "./enqueueTarget.js";
import { noteStaleHolds } from "./holdDeps.js";
import { clearWalkthroughsBeforeLanding } from "./walkthroughStep.js";

const VERB_ARG_OFFSET = 4;

/**
 * Consult the merge hold, printing whatever it has to say and reporting whether this invocation is refused.
 *
 * The same read `github merge` performs, so the two landing verbs can never disagree about who owns the
 * queue, and it is also the observation that publishes a stale hold's warning — see `./holdDeps.ts`'s header
 * for why nothing polls.
 *
 * @param args this invocation's parsed arguments
 * @param deps the injectable edges
 * @param home the state home holding the document
 * @returns whether the enqueue is refused by a standing hold
 */
function refusedByHold({
  args,
  deps,
  home,
}: {
  args: GithubEnqueueArgs;
  deps: GithubEnqueueDeps;
  home: string;
}): boolean {
  if (args.dequeue) {
    return false;
  }
  const holds = noteStaleHolds({ deps: deps.hold, holds: deps.hold.readHolds({ home }), home });
  const gate = mergeHoldGate({
    hold: holdFor({ holds, repo: `${args.owner}/${args.repo}` }),
    nowIso: deps.hold.nowIso(),
    number: args.number,
  });
  for (const line of gate.lines) {
    deps.writeDiagnostic(gate.refused ? `refused: ${line}` : line);
  }
  return gate.refused;
}

/** The state home: `--home` when given, else the resolved default. */
function stateHomeOf({ args, deps }: { args: GithubEnqueueArgs; deps: GithubEnqueueDeps }): string {
  if (args.home === undefined) {
    return deps.home();
  }
  return args.home;
}

/** Print one already-decided outcome in the selected output mode. */
function report({
  deps,
  args,
  lines,
  outcome,
  pr,
}: {
  deps: GithubEnqueueDeps;
  args: GithubEnqueueArgs;
  lines: readonly string[];
  outcome: string;
  pr: MergeQueuePrState;
}): void {
  if (args.json) {
    deps.out(enqueueJsonDocument({ lines, outcome, pr }));
    return;
  }
  for (const line of lines) {
    deps.out(line);
  }
}

/**
 * Hold on an unwitnessed ratchet bump (`./baselineBumpGate.ts`), then resolve the author's own open
 * walkthrough threads before the press, or say that the press would. The bump hold has no acknowledgement —
 * the verdict's waivers never reach it — and a dry run reads it too, so the preview cannot promise a press
 * the real run refuses. `--dequeue` reads neither: leaving a queue is not a landing.
 *
 * @param dryRun whether to say what would happen and write nothing
 * @param pr the pull request being landed
 * @returns whether the press may go ahead
 */
async function clearWalkthroughs({
  args,
  deps,
  dryRun,
  home,
  pr,
}: {
  args: GithubEnqueueArgs;
  deps: GithubEnqueueDeps;
  dryRun: boolean;
  home: string;
  pr: MergeQueuePrState;
}): Promise<boolean> {
  if (args.dequeue) {
    return true;
  }
  if (await refusedByBump({ args, deps, home, pr })) {
    return false;
  }
  return clearWalkthroughsBeforeLanding({
    deps: deps.walkthrough,
    dryRun,
    home,
    target: { headOid: pr.headOid, number: pr.number, owner: args.owner, repo: args.repo, url: pr.url },
    verb: "github enqueue",
    write: deps.writeDiagnostic,
  });
}

/** The door round-trip, the mutation and its witness, carrying every waiver the verdict judged. */
async function press({
  acknowledgements,
  api,
  args,
  deps,
  home,
  pr,
  target,
}: {
  acknowledgements: readonly DoorAcknowledgement[];
  api: GithubMergeQueueApi;
  args: GithubEnqueueArgs;
  deps: GithubEnqueueDeps;
  home: string;
  pr: MergeQueuePrState;
  target: EnqueueTarget;
}): Promise<number> {
  // `--dequeue` is exempt and must not reach ANY of this: it raises no finding, so a caller who supplied the
  // flags anyway would otherwise have a waiver recorded for a finding nothing raised. That regression was
  // introduced by moving this re-read into `press`, and caught by the next Codex review of it.
  if (args.dequeue) {
    return pressThroughDoor({ acknowledgements: [], api, args, deps, home, pr, target });
  }
  // Re-read the floor immediately before the mutation, exactly as `github merge --admin` does. The verdict
  // above was computed before the queue and required-context reads were awaited, and a review finishing
  // BROKEN in that window would otherwise queue behind a floor that had since become unmet. Found by a Codex
  // review. NARROWED, NEVER CLOSED, and the canon says so rather than claiming otherwise: nothing locks the
  // ledger, so a concurrent review can still publish a CURRENT BROKEN record between this read and the
  // mutation. Closing it needs a lock this repository does not have; what this buys is that the common case
  // — a review that finished during the awaited GitHub reads — is caught.
  const inspection = await readFloorFor({ args, deps, home, pr });
  const rows = recheckedFloorWaivers({ acknowledgements, args, inspection, write: deps.writeDiagnostic });
  if (rows === undefined) {
    return EXIT_ERROR;
  }
  // LAST, after every finding and the floor's re-read, so the only refusal still to come is GitHub's answer
  // to the mutation — which on `acme/acme-admin` is exactly an open conversation (`./walkthroughStep.ts`).
  // The ratchet-bump witness is read first inside it, so it too sits after the floor's re-read.
  if (!(await clearWalkthroughs({ args, deps, dryRun: false, home, pr }))) {
    return EXIT_ERROR;
  }
  return pressThroughDoor({ acknowledgements: rows, api, args, deps, home, pr, target });
}

/**
 * The door round-trip, the mutation and its witness — everything after the pairing floor has been judged.
 *
 * @param acknowledgements every waiver this invocation made, as the door ledger records them
 * @returns the process exit code
 */
async function pressThroughDoor({
  api,
  args,
  deps,
  home,
  pr,
  target,
  acknowledgements,
}: {
  api: GithubMergeQueueApi;
  args: GithubEnqueueArgs;
  deps: GithubEnqueueDeps;
  home: string;
  pr: MergeQueuePrState;
  target: EnqueueTarget;
  acknowledgements: readonly DoorAcknowledgement[];
}): Promise<number> {
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => mutateAndConfirm({ api, args, deps, pr, target }),
    request: enqueueDoorRequest({ acknowledgements, args, home }),
  });
  if (!through.performed) {
    const command = args.dequeue ? "slopweaver github enqueue --dequeue" : "slopweaver github enqueue";
    for (const line of notPerformedLines({ command, through })) deps.writeDiagnostic(line);
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    for (const problem of through.result.error) deps.writeDiagnostic(problem);
    return EXIT_ERROR;
  }
  const witness = enqueueWitnessOutcome({ dequeue: args.dequeue, pr: through.result.value, target });
  report({
    args,
    deps,
    lines: witness.lines,
    // A witness that FAILED is never reported as the act succeeding. The label used to read `queued` on
    // both paths, so a `--json` consumer saw `outcome: "queued"` beside an UNCONFIRMED line and a non-zero
    // exit — three signals, one of them wrong. Found while adding the asynchronous path, which produces
    // that state far more often than the GraphQL one does.
    outcome: witnessOutcomeLabel({ dequeue: args.dequeue, failed: witness.failed }),
    pr: through.result.value,
  });
  return witness.failed ? EXIT_ERROR : EXIT_OK;
}

/**
 * The one-word outcome a `--json` consumer branches on.
 *
 * @param dequeue whether the invocation ran backwards, out of the queue
 * @param failed whether the read-back failed to witness what the write asked for
 * @returns the label
 */
function witnessOutcomeLabel({ dequeue, failed }: { dequeue: boolean; failed: boolean }): string {
  if (failed) {
    return "unconfirmed";
  }
  return dequeue ? "dequeued" : "queued";
}

/**
 * Everything after the two reads: the verdict, the short-circuits, and the door round-trip.
 *
 * Split out of the command so the shell stays a parse-resolve-read sequence and this holds the one decision
 * that has branches — the same split `./readyRun.ts` uses for the same reason.
 *
 * @param state the pull request and its base branch's queue, as the reads found them
 * @returns the process exit code
 */
async function judgeAndAct({
  api,
  args,
  deps,
  home,
  state,
}: {
  api: GithubMergeQueueApi;
  args: GithubEnqueueArgs;
  deps: GithubEnqueueDeps;
  home: string;
  state: EnqueueState;
}): Promise<number> {
  const { pr, queue, requiredContexts, requiresCodeOwnerReviews, target } = state;
  // Read the LOCAL checkout only once the remote head is known, so the association is made against the pull
  // request GitHub actually holds rather than against whatever this session believes it pushed.
  //
  // `--dequeue` is exempt and must not even READ the ledger: leaving a queue only ever narrows what happens
  // next, so there is nothing for the floor to protect. `enqueueVerdict` short-circuits dequeue anyway, so an
  // unconditional read here would still be harmless to the verdict — and it was written that way first, until
  // a test that throws from the seam proved the read happened. A guard that runs where it has no business
  // running is how an exemption quietly stops being one.
  const inspection: CodexLoopInspection = args.dequeue
    ? { failures: [], kind: "examined", leftovers: [] }
    : await readFloorFor({ args, deps, home, pr });
  const verdict = enqueueVerdict({
    args,
    inspection,
    pr,
    queue,
    repo: `${args.owner}/${args.repo}`,
    requiredContexts,
    requiresCodeOwnerReviews,
    target,
  });
  const proceeds = verdict.disposition === "proceed";
  // A private-terms refusal prints only its own lines: the verdict's would announce a press that will not happen.
  const terms = enqueuePrivateTermsStep({ args, deps, home, pr, proceeds, target });
  if (terms.refused) {
    report({ args, deps, lines: terms.lines, outcome: "refused", pr });
    return EXIT_ERROR;
  }
  const lines = [...terms.lines, ...verdict.lines];
  if (!proceeds || args.dryRun) {
    // A dry run that hides a write the real run would make is a lie about what the press is going to do, and
    // one the real run would refuse on is a lie about whether it will.
    const lands = !proceeds || (await clearWalkthroughs({ args, deps, dryRun: true, home, pr }));
    report({ args, deps, lines, outcome: verdict.disposition, pr });
    return verdict.disposition === "refused" || !lands ? EXIT_ERROR : EXIT_OK;
  }
  if (!args.json) {
    // Under --json the whole invocation answers with ONE object, so the verdict's prose would corrupt it.
    // The findings are not lost: what refuses a write is reported through the refused path above.
    for (const line of lines) {
      deps.out(line);
    }
  }
  const acknowledgements = [...verdict.acknowledgements, ...terms.acknowledgements];
  return press({ acknowledgements, api, args, deps, home, pr, target });
}

/**
 * Run the enqueue, or its `--dequeue` inverse.
 *
 * @param rest argv after `github enqueue`
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubEnqueue({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubEnqueueDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "github", rest, verb: "enqueue" });
  if (gated !== undefined) {
    return gated;
  }
  const parsed = parseGithubEnqueueArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_ENQUEUE_USAGE);
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = stateHomeOf({ args, deps });
  if (refusedByHold({ args, deps, home })) {
    return EXIT_ERROR;
  }
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const state = await readEnqueueState({ api, args });
  if (state.isErr()) {
    for (const problem of state.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  return judgeAndAct({ api, args, deps, home, state: state.value });
}

/** `slopweaver github enqueue`. */
export const githubEnqueueCommand = defineCommand({
  run: (argv) => runGithubEnqueue({ deps: productionGithubEnqueueDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
