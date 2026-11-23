/**
 * The Codex pairing floor as `github enqueue`'s own finding.
 *
 * Two small translations from `../../../codex/landingGate.js`'s verdict into this verb's
 * acknowledgeable-finding vocabulary. Its own module because `./enqueueCore.ts` sits against the file-size
 * ratchet and this is the cohesive piece that arrived last: the floor is one concern, so it lifts whole and
 * leaves the core about queueing.
 *
 * The ratchet-bump witness's read sits here too, because it answers for the same pull-request head the floor
 * does ({@link pullRequestHeadOf}) — but it is a hold, never one of this verb's acknowledgeable findings.
 */

import type { DoorAcknowledgement } from "../../../admit/types.js";
import type { BaselineBumpWitnessReader } from "../../../codex/baselineBumpWitnessRun.js";
import {
  associateCodexLoop,
  CODEX_LOOP_SUBJECT,
  type CodexLoopInspection,
  codexLoopFinding,
  codexLoopFindingLines,
  codexLoopWaiver,
  type PullRequestHead,
} from "../../../codex/landingGate.js";
import type { LocalCodexLoopReader } from "../../../codex/landingGateRun.js";
import type { MergeQueuePrState } from "../../../live/github/mergeQueue.js";
import { baselineBumpRefusal } from "./baselineBumpGate.js";
import type { GithubEnqueueArgs } from "./enqueueArgs.js";
// Type-only, so it is erased at runtime and the pair is not a module cycle: `./enqueueFindings.ts` imports
// this module's `codexLoopFindingFor` as a VALUE, and this one takes only its finding shape back.
import type { EnqueueFinding } from "./enqueueFindings.js";

/**
 * The acknowledgement to RECORD, when the pairing floor was raised and then waived.
 *
 * Returns `undefined` unless all three hold: the finding was actually raised, it is no longer standing, and
 * a reason was given. Supplying the flags on a clean loop must not manufacture an audit entry for something
 * nobody waived — that would make the ledger's waiver count useless in the opposite direction.
 *
 * @param args the parsed invocation, for its acknowledgements and reason
 * @param findings every finding the guard produced
 * @param unacknowledged the findings still standing
 * @returns the acknowledgement to write at the door, or `undefined`
 */
export function codexLoopAcknowledgement({
  args,
  findings,
  unacknowledged,
}: {
  args: GithubEnqueueArgs;
  findings: readonly EnqueueFinding[];
  unacknowledged: readonly EnqueueFinding[];
}): DoorAcknowledgement | undefined {
  const raised = findings.some((finding) => finding.subject === CODEX_LOOP_SUBJECT);
  const stillStanding = unacknowledged.some((finding) => finding.subject === CODEX_LOOP_SUBJECT);
  if (!raised || stillStanding) {
    return undefined;
  }
  return codexLoopWaiver({ acknowledge: args.acknowledge, acknowledgeAll: args.acknowledgeAll, reason: args.reason });
}

/**
 * The pairing floor as one finding, or nothing when the local checkout cleared it.
 *
 * Several obligations are joined into one detail rather than raised as several findings, because a kind here
 * raises at most one finding and the kind IS the acknowledgement subject — splitting them would invent
 * subjects an operator could waive one at a time while believing they had waived less.
 *
 * @param inspection what the local checkout said about this pull request, from `../../../codex/landingGate.js`
 * @returns the finding, or an empty list
 */
export function codexLoopFindingFor({ inspection }: { inspection: CodexLoopInspection }): readonly EnqueueFinding[] {
  const finding = codexLoopFinding({ inspection });
  if (finding === undefined) {
    return [];
  }
  return [{ detail: finding.details.join("; "), kind: CODEX_LOOP_SUBJECT, subject: CODEX_LOOP_SUBJECT }];
}

/**
 * Read the pairing floor for the pull request in front of us, through the verb's own seam.
 *
 * Its own function because BOTH of this verb's reads compose the same head from the same pull request, and
 * the second one exists precisely to disagree with the first when the ledger moved underneath it — a second
 * spelling of the head is the one way that comparison could go wrong without anybody noticing.
 *
 * It takes the two edges it uses rather than the verb's whole `GithubEnqueueDeps`, which keeps the import
 * one-way: the runner imports this module, never the reverse.
 *
 * @param args the parsed invocation, for the repository it names
 * @param deps the injectable edges: where the verb runs from, and the pairing-floor evidence reader
 * @param home the state home holding the pass records
 * @param pr the pull request being landed
 * @returns what this machine records about that pull request's loop
 */
export async function readFloorFor({
  args,
  deps,
  home,
  pr,
}: {
  args: GithubEnqueueArgs;
  deps: { readonly cwd: () => string; readonly readCodexLoop: LocalCodexLoopReader };
  home: string;
  pr: MergeQueuePrState;
}): Promise<CodexLoopInspection> {
  const head = pullRequestHeadOf({ args, pr });
  return associateCodexLoop({ head, local: await deps.readCodexLoop({ cwd: deps.cwd(), head, home }) });
}

/**
 * The ratchet-bump witness, read immediately before the press — after the pairing floor's re-read, so a review
 * that finished BROKEN during the GitHub reads is seen. A HOLD, not a finding: nothing here reads the
 * invocation's acknowledgements, so neither `--acknowledge` nor `--acknowledge-all` reaches it.
 *
 * A native-stack member above the bottom is judged against the tip of the branch the WHOLE stack lands on,
 * never its own base: GitHub lands it together with every unmerged member below it, so a bump a lower member
 * carries is part of this press. A tip that cannot be read leaves the base unknown, which
 * the reader refuses.
 *
 * @param deps the injectable edges: where the verb runs from, the witness reader and the diagnostic channel
 * @param home the state home holding the pass records
 * @param pr the pull request being landed, its base commit and stack included
 * @returns whether the press is refused, its refusal already printed
 */
export async function refusedByBump({
  args,
  deps,
  home,
  pr,
}: {
  args: GithubEnqueueArgs;
  deps: {
    readonly cwd: () => string;
    readonly readBumpWitness: BaselineBumpWitnessReader;
    readonly writeDiagnostic: (line: string) => void;
  };
  home: string;
  pr: MergeQueuePrState;
}): Promise<boolean> {
  const head = pullRequestHeadOf({ args, pr });
  const lines = await baselineBumpRefusal({
    cwd: deps.cwd(),
    head,
    home,
    landingBranch: stackLandingBranch({ pr }),
    read: deps.readBumpWitness,
  });
  for (const line of lines) deps.writeDiagnostic(`refused: ${line}`);
  return lines.length > 0;
}

/**
 * The branch a native-stack member's whole stack lands on, when that is not the member's own base.
 *
 * @param pr the pull request being landed, its stack included when it has one
 * @returns the stack's landing branch, or `undefined` for a lone pull request or the stack's bottom member
 */
function stackLandingBranch({ pr }: { pr: MergeQueuePrState }): string | undefined {
  return pr.stack !== undefined && pr.stack.baseRefName !== pr.baseRefName ? pr.stack.baseRefName : undefined;
}

/**
 * The pull request as the pairing floor and the bump witness both see it — one spelling, so the two reads
 * can never disagree about which head or which base they answered for.
 *
 * @param args the parsed invocation, for the repository it names
 * @param pr the pull request as GitHub reports it
 * @returns the head, branch, base commit and repository
 */
function pullRequestHeadOf({ args, pr }: { args: GithubEnqueueArgs; pr: MergeQueuePrState }): PullRequestHead {
  return {
    baseSha: pr.baseRefOid,
    branch: pr.headRefName,
    headSha: pr.headOid,
    repository: `${args.owner}/${args.repo}`,
  };
}

/**
 * The waivers the press carries after the pairing floor's re-read just before the mutation, printing any
 * finding that read raises whether or not it is waived.
 *
 * @param acknowledgements every waiver the verdict judged, the floor's now-stale one included
 * @param args the parsed invocation, for its acknowledgements and reason
 * @param inspection the floor as re-read just before the mutation
 * @param write the verb's diagnostic channel
 * @returns the waivers to record, or `undefined` when a standing floor finding was not acknowledged
 */
export function recheckedFloorWaivers({
  acknowledgements,
  args,
  inspection,
  write,
}: {
  acknowledgements: readonly DoorAcknowledgement[];
  args: GithubEnqueueArgs;
  inspection: CodexLoopInspection;
  write: (line: string) => void;
}): DoorAcknowledgement[] | undefined {
  const standing = codexLoopFinding({ inspection });
  const waiver = codexLoopWaiver({
    acknowledge: args.acknowledge,
    acknowledgeAll: args.acknowledgeAll,
    reason: args.reason,
  });
  // Every waiver the VERDICT judged except the pairing floor's, which this second read owns: the floor is
  // the only subject re-asked here, so the verdict's answer for it is the stale one, while its answers for
  // every other subject were computed over the same GitHub state the mutation is about to use.
  const rows = acknowledgements.filter((row) => row.subject !== CODEX_LOOP_SUBJECT);
  if (standing === undefined) {
    return rows;
  }
  // PRINT it either way. A finding raised only by this second read was never in the verdict above, so
  // waiving it silently would act on a finding the operator was never shown — and the canon's promise is
  // that every finding is printed whether or not it is acknowledged. Found by a Codex review.
  const state = waiver === undefined ? "refused" : "ACKNOWLEDGED";
  for (const line of codexLoopFindingLines({ finding: standing, state })) {
    write(line);
  }
  if (waiver === undefined) {
    return undefined;
  }
  return [...rows, waiver];
}
