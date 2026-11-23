/**
 * The two pre-door verdicts `github merge --admin` takes on a pull request: that GitHub holds the change the
 * guard measured, and what the Codex pairing floor decided. Split from `./mergeAdminRun.ts`, which owns the
 * order these run in and every refusal they feed; neither function here refuses or merges anything itself.
 */
import type { DoorAcknowledgement } from "../../../admit/types.js";
import {
  associateCodexLoop,
  CODEX_LOOP_SUBJECT,
  codexLoopFinding,
  codexLoopFindingLines,
  codexLoopWaiver,
} from "../../../codex/landingGate.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { AdminMergePr, GithubAdminMergeApi } from "../../../outbound/github/adminMerge.js";
import { adminMergeHeadOf, measuredTheSameChange } from "./mergeAdminCore.js";
import type { AdminMergeRequest, GithubAdminMergeDeps } from "./mergeAdminTypes.js";

/** What the pairing floor decided for this merge: refuse with these lines, or proceed carrying this waiver. */
type CodexPairingVerdict =
  | { readonly kind: "standing"; readonly lines: readonly string[] }
  | { readonly kind: "clear"; readonly acknowledgement: DoorAcknowledgement | undefined };

/**
 * Apply the Codex pairing floor to this administrator merge.
 *
 * Runs after `readAndAgree` — so the association is made against the pull request GitHub actually holds —
 * and BEFORE the admin/protection reads and the door, so a refusal costs no privileged read and can never
 * race the merge itself. The same four association facts and the same acknowledgement rule `github enqueue`
 * applies, from `../../../codex/landingGate.js`, so the two landing verbs cannot drift apart on what the
 * standing rule requires.
 *
 * @param pr the pull request as the authoritative read found it
 * @param request this invocation, for its checkout root, repository slug and acknowledgements
 * @returns the refusal lines, or the waiver to carry to the door
 */
export async function judgeCodexPairingFloor({
  deps,
  pr,
  request,
  announce = false,
}: {
  announce?: boolean;
  deps: GithubAdminMergeDeps;
  pr: AdminMergePr;
  request: AdminMergeRequest;
}): Promise<CodexPairingVerdict> {
  const head = adminMergeHeadOf({ pr, repo: request.repo });
  const inspection = associateCodexLoop({
    head,
    local: await deps.readCodexLoop({ cwd: request.repoRoot, head, home: request.home }),
  });
  // The body from the SAME authoritative read as the head, so the re-read before the merge judges its own body.
  const finding = codexLoopFinding({ inspection });
  if (finding === undefined) {
    // Say so when an EARLIER read raised the floor and this one does not. Nothing is waived — the floor was
    // met at the decisive read, so `codexLoopWaiver` must not manufacture a ledger entry for it — but a log
    // showing a finding raised and then nothing at all reads as a finding that vanished. Found by a Codex
    // review asking what a reader sees across the two reads.
    if (announce) {
      deps.out({ line: `${CODEX_LOOP_SUBJECT}: cleared before the merge — the floor was met on the second read` });
    }
    return { acknowledgement: undefined, kind: "clear" };
  }
  const acknowledgement = codexLoopWaiver({
    acknowledge: request.acknowledgement.acknowledge,
    acknowledgeAll: request.acknowledgement.acknowledgeAll,
    reason: request.acknowledgement.reason,
  });
  if (acknowledgement !== undefined) {
    // Every waived obligation, then the reason: the canon's promise is that every finding is printed whether or
    // not it is acknowledged, and a reason alone told a dry run nothing about what it was landing over
    // (`codexLoopFindingLines`). Only the announcing re-read prints, so the decisive read speaks once.
    if (announce) {
      for (const line of codexLoopFindingLines({ finding, state: "ACKNOWLEDGED" })) {
        deps.out({ line });
      }
      deps.out({ line: `ACKNOWLEDGED: ${CODEX_LOOP_SUBJECT} — reason: ${acknowledgement.reason}` });
    }
    return { acknowledgement, kind: "clear" };
  }
  return {
    kind: "standing",
    lines: [
      ...finding.details.map((detail) => `${CODEX_LOOP_SUBJECT}: ${detail}`),
      `accept it with --acknowledge ${CODEX_LOOP_SUBJECT} --reason "…", which is written to the door ledger`,
    ],
  };
}

/**
 * Read the pull request and prove it is the change the guard measured, or say exactly how it differs.
 *
 * @returns the authoritative pull request, or the read failure or disagreement lines
 */
export async function readAndAgree({
  api,
  request,
  owner,
  repo,
  baseBranch,
  headSha,
}: {
  api: GithubAdminMergeApi;
  request: AdminMergeRequest;
  owner: string;
  repo: string;
  baseBranch: string;
  headSha: string;
}): Promise<Result<AdminMergePr>> {
  const read = await api.read({ number: request.number, owner, repo });
  if (read.isErr()) {
    return err([read.error.message]);
  }
  const disagreements = measuredTheSameChange({ baseBranch, headSha, pr: read.value });
  return disagreements.length > 0 ? err(disagreements) : ok(read.value);
}
