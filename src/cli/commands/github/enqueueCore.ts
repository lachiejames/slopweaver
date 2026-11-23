/**
 * `slopweaver github enqueue` — every DECISION this verb makes, as pure functions. The effectful shell in
 * `./enqueueRun.ts` resolves the token, reads GitHub, routes the mutation through the door and reads the
 * queue entry back; nothing here touches the network, the clock or the filesystem.
 *
 * ## What this verb is, and what it is NOT
 *
 * It presses GitHub's own **Merge when ready** — the button that puts a pull request into the repository's
 * native merge queue and lets GitHub land it once the queue's own required checks pass on the merged
 * result. It is not `github merge --admin`, which squash-merges immediately through the administrator's
 * branch-protection bypass, and it is not `github hold`/`release`, which govern slopweaver's OWN advisory
 * serial lane and touch nothing outside the machine. A repository whose base branch has a merge queue is
 * the only place this verb has anything to press.
 *
 * Distinct from `hold`/`release` is not independent of them: a standing hold REFUSES this verb, in
 * `./enqueueRun.ts` before any read, exactly as it refuses `github merge`. Nothing here judges it — the
 * refusal is not a finding and cannot be acknowledged, because the escape is a named act somebody performs
 * (`github release`) rather than a flag this invocation carries.
 *
 * ## The guard, and why it acknowledges rather than judges
 *
 * The same shape `github merge` uses, deliberately: every reason not to queue is printed as a FINDING, a
 * finding still standing refuses the write, and the escape is explicit — `--acknowledge <subject,...>` for
 * named findings, `--acknowledge-all` paired with `--reason "…"` for all of them. This verb runs no model,
 * so it cannot decide whether "CI has not finished" is acceptable on a given day; only the visible session
 * can. **Queueing while checks are still running is the ordinary case a merge queue exists for**, so that
 * finding will often be acknowledged — which is the point of printing it rather than silently allowing it.
 *
 * The CI half of that guard has TWO subjects rather than one, because the two states it can be in call for
 * different acts. A red check still standing on the head is `ci-not-green`. A head whose checks all passed
 * under a rollup GitHub still reads as `FAILURE` — the rollup folds in every check suite on the commit, so a
 * run a re-run already replaced keeps pinning it — is `ci-rollup-superseded`, and the finding NAMES the runs
 * doing the pinning. Splitting them is what keeps the second, which this repository's own landing sequence
 * produces on almost every pull request, from training a reflex that also clears the first.
 *
 * Four states are REFUSALS instead, and cannot be acknowledged. Three of them are cases where the write is
 * IMPOSSIBLE — a pull request that is not open, one that is still a draft, and a landing branch with no
 * merge queue at all — and the fourth is the case where it is possible and unsafe: a queue requiring NO
 * status-check contexts, which would merge the entry on arrival without ever testing the merged result.
 * Acknowledging any of them could not make the press do what the caller asked for.
 *
 * ## A native-stack member lands on the STACK's base, and takes a different transport
 *
 * GitHub's GraphQL `enqueuePullRequest` refuses a member of a native stack, and only the bottom member of
 * one targets the branch the stack actually lands on. So every branch-shaped judgement here — the no-queue
 * refusal, the ungated-queue refusal, the required contexts, the code-owner wording — is made against the
 * EFFECTIVE landing branch that `./enqueueTarget.ts` computes, and the shell routes the write by the same
 * fact. The two coincide for an ordinary pull request and for the bottom of a stack, which is exactly why
 * the defect only ever surfaced as GitHub's own rejection message.
 *
 * `--dequeue` is judged by none of it. Removing a pull request from a queue only ever narrows what happens
 * next, so a guard on it would refuse the very action a caller reaches for when something is wrong.
 */
import type { DoorAcknowledgement, DoorRequest } from "../../../admit/types.js";
import type { CodexLoopInspection } from "../../../codex/landingGate.js";
import type { MergeQueuePrState, MergeQueueState } from "../../../live/github/mergeQueue.js";
import { advisoryOnlyNames } from "../../../review/gatingChecks.js";
import { enqueueAcknowledgements } from "./enqueueAcknowledgements.js";
import type { GithubEnqueueArgs } from "./enqueueArgs.js";
import {
  enqueueFindings,
  enqueueRefusals,
  enqueueReportLines,
  unacknowledgedEnqueueFindings,
} from "./enqueueFindings.js";
import { type EnqueueTarget, enqueueScopeLines } from "./enqueueTarget.js";

/**
 * The lines naming exactly which pull request, head, base and queue this report is about.
 *
 * Printed before every finding, always — the same reason `github merge` prints the tree it measured: a
 * verdict about the wrong subject is indistinguishable from a true one unless its subject is on the page.
 *
 * A native-stack member earns three more, because the scope of the act is wider than its subject: the
 * stack it belongs to, its own base when that is not the landing branch, and what else GitHub will queue
 * alongside it. See `./enqueueTarget.ts`.
 *
 * @param pr the pull request's queue-relevant state
 * @param queue the landing branch's merge queue, or `undefined` when it has none
 * @param repo the `owner/name` slug
 * @param target where this pull request really lands, and the transport that implies
 * @param args the parsed invocation, for its direction
 * @returns the identity lines
 */
export function enqueueIdentityLines({
  pr,
  queue,
  repo,
  target,
  args,
  requiredContexts,
}: {
  pr: MergeQueuePrState;
  queue: MergeQueueState | undefined;
  repo: string;
  target: EnqueueTarget;
  args: GithubEnqueueArgs;
  requiredContexts: readonly string[];
}): readonly string[] {
  const queueLine = queue === undefined ? `${target.branch} has NO merge queue` : `${queue.branch}  ${queue.url}`;
  const entryLine =
    pr.entry === undefined ? "not queued" : `position ${String(pr.entry.position)}, state ${pr.entry.state}`;
  const gatesLine = requiredContexts.length === 0 ? "NONE — the queue gates on nothing" : requiredContexts.join(", ");
  const advisory = advisoryOnlyNames({ checks: pr.checks.checks, requiredContexts, truncated: pr.checks.truncated });
  const advisoryLines =
    advisory === undefined ? [] : [`advisory red: ${advisory.join(", ")} — outside what the queue gates on`];
  return [
    `pull request: ${repo}#${String(pr.number)}  ${pr.url}`,
    `head:         ${pr.headOid}`,
    ...enqueueScopeLines({ dequeue: args.dequeue, number: pr.number, prBaseRefName: pr.baseRefName, target }),
    `queue:        ${queueLine}`,
    `entry:        ${entryLine}`,
    `gated by:     ${gatesLine}`,
    ...advisoryLines,
  ];
}

/**
 * What this invocation should do next.
 *
 * Three outcomes rather than a boolean, because "already in the state you asked for" is neither a refusal
 * nor a write: reporting it as either would make a second, harmless invocation look like a failure or like
 * a duplicate press.
 *
 * @internal the shell branches on it by value; no caller outside this verb names the type.
 */
export type EnqueueDisposition = "refused" | "already" | "proceed";

/**
 * The complete verdict for one invocation: every line to print, and what to do next.
 *
 * @internal the return shape of `enqueueVerdict`; no caller outside this verb names it.
 */
export interface EnqueueVerdict {
  readonly lines: readonly string[];
  readonly disposition: EnqueueDisposition;
  /**
   * Every finding this invocation actually waived, as the rows the door ledger records. EMPTY whenever
   * nothing was waived, so passing the flags over a guard that found nothing cannot manufacture an audit
   * entry for something nobody waived — `./enqueueAcknowledgements.ts` holds that rule for both subjects.
   */
  readonly acknowledgements: readonly DoorAcknowledgement[];
}

/** The verdict's closing line — what happens next, stated rather than left for the reader to infer. */
function closingLine({
  unacknowledged,
  dryRun,
  dequeue,
}: {
  unacknowledged: number;
  dryRun: boolean;
  dequeue: boolean;
}): string {
  if (unacknowledged > 0) {
    return (
      `verdict: REFUSED — ${String(unacknowledged)} finding(s) unacknowledged. Accept each with ` +
      '--acknowledge <subject,...>, or all of them with --acknowledge-all --reason "…".'
    );
  }
  const act = dequeue ? "taking it back out of the queue now" : "pressing 'Merge when ready' now";
  return dryRun
    ? `verdict: nothing stands unacknowledged. This invocation only REPORTS — drop --dry-run to act (${act}).`
    : `verdict: nothing stands unacknowledged — ${act}.`;
}

/**
 * The verdict for `--dequeue`, which no finding governs.
 *
 * Leaving a queue only ever narrows what happens next, so guarding it would refuse the very action a caller
 * reaches for when something is wrong. The only question is whether there is an entry to remove.
 *
 * @param pr the pull request's queue-relevant state
 * @param identity the identity lines already computed for this report
 * @param dryRun whether this invocation only reports
 * @returns the lines to print and what to do next
 */
function dequeueVerdict({
  pr,
  identity,
  dryRun,
}: {
  pr: MergeQueuePrState;
  identity: readonly string[];
  dryRun: boolean;
}): EnqueueVerdict {
  if (pr.entry === undefined) {
    return {
      acknowledgements: [],
      disposition: "already",
      lines: [...identity, `#${String(pr.number)} holds no queue entry — there is nothing to dequeue.`],
    };
  }
  return {
    acknowledgements: [],
    disposition: "proceed",
    lines: [...identity, closingLine({ dequeue: true, dryRun, unacknowledged: 0 })],
  };
}

/**
 * The full verdict: the identity lines, the report lines, and what this invocation should do next.
 *
 * @param pr the pull request's queue-relevant state
 * @param queue the base branch's merge queue, or `undefined` when it has none
 * @param repo the `owner/name` slug
 * @param args the parsed invocation, for its direction, acknowledgements and dry-run mode
 * @param target where this pull request really lands, and the transport that implies
 * @param requiredContexts the status-check contexts the base requires; empty means the queue gates on nothing
 * @param inspection what the local checkout said about the Codex pairing floor
 * @returns the lines to print, what to do next, and every acknowledgement to record at the door
 */
export function enqueueVerdict({
  pr,
  queue,
  repo,
  args,
  target,
  requiredContexts,
  requiresCodeOwnerReviews,
  inspection,
}: {
  pr: MergeQueuePrState;
  queue: MergeQueueState | undefined;
  repo: string;
  args: GithubEnqueueArgs;
  target: EnqueueTarget;
  requiredContexts: readonly string[];
  requiresCodeOwnerReviews: boolean | undefined;
  inspection: CodexLoopInspection;
}): EnqueueVerdict {
  const identity = enqueueIdentityLines({ args, pr, queue, repo, requiredContexts, target });
  if (args.dequeue) {
    return dequeueVerdict({ dryRun: args.dryRun, identity, pr });
  }
  const refusals = enqueueRefusals({ pr, queue, repo, requiredContexts, target });
  if (refusals.length > 0) {
    return {
      acknowledgements: [],
      disposition: "refused",
      lines: [...identity, ...refusals.map((line) => `refused: ${line}`)],
    };
  }
  if (pr.entry !== undefined) {
    return {
      acknowledgements: [],
      disposition: "already",
      lines: [
        ...identity,
        `#${String(pr.number)} is ALREADY queued at position ${String(pr.entry.position)} ` +
          `(${pr.entry.state}) — nothing to press.`,
      ],
    };
  }
  return judgeFindings({ args, identity, inspection, pr, requiredContexts, requiresCodeOwnerReviews, target });
}

/**
 * The verdict once nothing refuses outright: the findings, what is still standing, and the closing line.
 *
 * Split from {@link enqueueVerdict} so that function stays a readable sequence of short-circuits and this
 * holds the one branch that has to weigh acknowledgements.
 *
 * @param identity the lines naming this invocation's subject, already composed
 * @returns the lines to print, what to do next, and every acknowledgement to record at the door
 */
function judgeFindings({
  args,
  identity,
  inspection,
  pr,
  requiredContexts,
  requiresCodeOwnerReviews,
  target,
}: {
  args: GithubEnqueueArgs;
  identity: readonly string[];
  inspection: CodexLoopInspection;
  pr: MergeQueuePrState;
  requiredContexts: readonly string[];
  requiresCodeOwnerReviews: boolean | undefined;
  target: EnqueueTarget;
}): EnqueueVerdict {
  const findings = enqueueFindings({ inspection, pr, requiredContexts, requiresCodeOwnerReviews, target });
  const unacknowledged = unacknowledgedEnqueueFindings({
    acknowledge: args.acknowledge,
    acknowledgeAll: args.acknowledgeAll,
    findings,
  });
  const lines = [
    ...identity,
    ...enqueueReportLines({
      acknowledge: args.acknowledge,
      acknowledgeAll: args.acknowledgeAll,
      findings,
      stacked: target.kind === "stack",
    }),
  ];
  if (args.acknowledgeAll && findings.length > 0) {
    // `reason` is REQUIRED alongside --acknowledge-all and the parser refuses without it, so the assertion
    // is honest rather than defensive: coalescing to "" would print an acceptance with no stated reason.
    lines.push(`acknowledged ALL findings above — reason: ${args.reason!}`);
  }
  lines.push(closingLine({ dequeue: false, dryRun: args.dryRun, unacknowledged: unacknowledged.length }));
  return {
    acknowledgements: enqueueAcknowledgements({ args, findings, unacknowledged }),
    disposition: unacknowledged.length > 0 ? "refused" : "proceed",
    lines,
  };
}

/**
 * What the read-back after the mutation proves.
 *
 * The entry GitHub returns from its own mutation payload is deliberately not consulted: a mutation that
 * reports its own success establishes nothing, and this read is the same fact the next invocation would see.
 *
 * The target is the one PRE-WRITE fact carried in: GitHub may already have changed the stack by the time
 * this read-back happens, so the scope this invocation ASKED FOR is what gets reported, never a scope
 * re-derived from state the act itself moved.
 *
 * @param pr the pull request as the read-back found it
 * @param dequeue whether the invocation ran backwards, out of the queue
 * @param target where this pull request lands, as it read BEFORE the write
 * @returns the lines to print, and whether the invocation must exit non-zero
 */
export function enqueueWitnessOutcome({
  pr,
  dequeue,
  target,
}: {
  pr: MergeQueuePrState;
  dequeue: boolean;
  target: EnqueueTarget;
}): {
  readonly lines: readonly string[];
  readonly failed: boolean;
} {
  if (dequeue) {
    return dequeueWitness({ pr });
  }
  const unwitnessed = enqueueUnwitnessed({ pr });
  if (unwitnessed !== undefined) {
    return { failed: true, lines: [unwitnessed] };
  }
  return { failed: false, lines: queuedLines({ pr, target }) };
}

/** The queue entry as `--json` reports it: `null` when the pull request is not queued, so the key is never dropped. */
function jsonEntryOf({ pr }: { pr: MergeQueuePrState }): NonNullable<MergeQueuePrState["entry"]> | null {
  if (pr.entry === undefined) {
    return null;
  }
  return pr.entry;
}

/**
 * The document `github enqueue --json` prints for one already-decided outcome.
 *
 * @param pr the pull request the outcome is about, whose queue entry and URL the document carries
 * @param lines the outcome's human lines, carried verbatim
 * @param outcome the outcome's one-word name
 * @returns the pretty-printed JSON document
 */
export function enqueueJsonDocument({
  pr,
  lines,
  outcome,
}: {
  pr: MergeQueuePrState;
  lines: readonly string[];
  outcome: string;
}): string {
  return JSON.stringify({ entry: jsonEntryOf({ pr }), lines, outcome, pullRequest: pr.url }, undefined, 2);
}

/** The dequeue half of the witness: the entry is gone, or it is not. */
function dequeueWitness({ pr }: { pr: MergeQueuePrState }): {
  readonly lines: readonly string[];
  readonly failed: boolean;
} {
  if (pr.entry === undefined) {
    return { failed: false, lines: [`dequeued #${String(pr.number)} — it holds no queue entry now  ${pr.url}`] };
  }
  return {
    failed: true,
    lines: [
      `UNCONFIRMED: GitHub accepted the dequeue but #${String(pr.number)} still reads back at position ` +
        `${String(pr.entry.position)} (${pr.entry.state}). Re-read it before retrying.`,
    ],
  };
}

/**
 * Why this read-back does not witness an enqueue, or `undefined` when it does.
 *
 * The state check leads the missing-entry one, and that order is the point: a queue entry is not evidence
 * the pull request is IN a queue, because GitHub can leave one behind on a pull request that has since
 * landed. Raised by a Codex review against the asynchronous path, where the window is wide by construction,
 * and closed here rather than only in that loop because this is the one place EITHER transport renders
 * success — a guard on the loop alone would not hold for the mutation's own race.
 *
 * @param pr the pull request as the read-back found it
 * @returns the refusal line, or `undefined` when the entry is real
 */
function enqueueUnwitnessed({ pr }: { pr: MergeQueuePrState }): string | undefined {
  if (pr.state !== "OPEN") {
    return (
      `UNCONFIRMED: #${String(pr.number)} reads back ${pr.state} rather than OPEN. Whatever queue entry it ` +
      "still carries, this invocation did not witness it entering a queue — re-read it before retrying."
    );
  }
  if (pr.entry === undefined) {
    return (
      `UNCONFIRMED: GitHub accepted the enqueue but #${String(pr.number)} reads back with no queue entry. ` +
      "Re-read it before retrying; do not assume it is queued."
    );
  }
  return undefined;
}

/**
 * The success lines for a witnessed entry, with the stack's wider scope named when there is one.
 *
 * @param pr the pull request as the read-back found it, entry present
 * @param target where it lands, as it read BEFORE the write
 * @returns the lines to print
 */
function queuedLines({ pr, target }: { pr: MergeQueuePrState; target: EnqueueTarget }): readonly string[] {
  // `enqueueUnwitnessed` has already refused an absent entry, so this assertion is honest rather than
  // defensive: reaching here with none would be a caller bypassing the guard directly above it.
  const entry = pr.entry!;
  const queued =
    `queued #${String(pr.number)} into ${target.branch} at position ${String(entry.position)} ` +
    `(${entry.state})  ${pr.url}`;
  if (target.kind !== "stack") {
    return [queued, "next: GitHub merges it once the queue's own required checks pass on the merged result."];
  }
  return [
    queued,
    `scope: #${String(pr.number)} and every unmerged pull request BELOW it in stack ` +
      `#${String(target.stack.number)} were requested together; the position above is the SELECTED ` +
      "pull request's own read-back, not a read of every entry.",
    "next: GitHub merges the group once the queue's own required checks pass on the merged result.",
  ];
}

/**
 * The external-write door request for one exact enqueue or dequeue.
 *
 * @param args the parsed repository, pull-request identity and direction
 * @param home the Slopweaver state home whose door records the write
 * @param acknowledgements every finding this invocation waived, when any were needed and given
 * @returns the exact external-write request admitted by the door
 */
export function enqueueDoorRequest({
  args,
  home,
  acknowledgements,
}: {
  args: GithubEnqueueArgs;
  home: string;
  acknowledgements: readonly DoorAcknowledgement[];
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: args.dequeue ? "enqueue --dequeue" : "enqueue" },
    artifact: { id: `${args.owner}/${args.repo}#${String(args.number)}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
    ...(acknowledgements.length === 0 ? {} : { acknowledgements }),
  };
}
