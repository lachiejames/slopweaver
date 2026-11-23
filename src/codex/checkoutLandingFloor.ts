/**
 * The landing floor asked of THIS checkout's branch tip — what `codex status --check` refuses on.
 *
 * ## Why `--check` asks the landing reader rather than its own ledger
 *
 * `codex status` judges the WORKING TREE, uncommitted edits included, because its question is whether the
 * passes describe the tree in front of the session. `github enqueue` and `github merge --admin` judge the pull
 * request's head COMMIT (`./landingGateRun.ts`), because only the commit lands. Over a dirty tree the two
 * disagree, and `--check` used to answer the first question while canon sold it as a preview of the second.
 *
 * MEASURED on one pull request: the checkout held an uncommitted `yarn.lock` metadata flip
 * (331 bytes), and a Claude fallback review was taken over HEAD plus that hunk. `codex status`
 * printed it CURRENT CLEAN beside a STALE READY plan, and `github enqueue --pr <number> --dry-run` refused
 * `codex-loop-incomplete` — rightly, because the review read a tree that is not the commit being landed.
 * Repro: `git status --short` in that checkout, then both verbs.
 *
 * So `--check` is this one call: the branch's tip commit and the checkout's `origin`, handed to
 * `readLocalCodexLoop` and judged by `associateCodexLoop` and `codexLoopFinding` — the landing verbs' own
 * reader and judgement, never a copy of them. What it still cannot see is a remote head that differs from the
 * local tip (an unpushed commit, or a remote ahead); `associateCodexLoop` refuses that at the landing itself.
 */

import type { IngestError } from "#lib/ingestError.js";
import type { Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";
import { originRepositoryOf } from "../config.js";
import type { FallbackRegisterPort } from "./fallbackPort.js";
import { runGitChecked } from "./gitRun.js";
import { associateCodexLoop, codexLoopFinding, type PullRequestHead } from "./landingGate.js";
import { readLocalCodexLoop } from "./landingGateRun.js";
import type { ReviewLeftover } from "./reviewLeftovers.js";
import type { CodexSignInPort } from "./signInPort.js";
import type { SupersessionPort } from "./supersessionPort.js";

/** The landing floor's answer for one checkout's branch tip, and the commit it judged. */
export interface CheckoutLandingFloor {
  /** The tip commit judged, or `undefined` when none could be resolved — then `failures` says why. */
  readonly headSha: string | undefined;
  /** One line per obligation the landing verbs would refuse on. Empty means they would not. */
  readonly failures: readonly string[];
  /** Current `BROKEN` reviews past the second review pass: the landing verbs raise each as codex-loop-incomplete. */
  readonly leftovers: readonly ReviewLeftover[];
}

/**
 * The commit a local branch points at.
 *
 * `refs/heads/` and the `^{commit}` peel are both load-bearing: a bare name could resolve to a tag or a remote
 * ref of the same name, and `--verify` refuses an object git does not hold rather than echoing it back.
 *
 * @param cwd the checkout to read
 * @param branch the local branch whose tip is wanted
 * @returns the full commit name, or a typed io error when the branch does not exist here
 */
function branchTipCommit({ cwd, branch }: { cwd: string; branch: string }): Result<string, IngestError> {
  return safeFs({
    execute: () =>
      runGitChecked({
        args: ["rev-parse", "--verify", "--end-of-options", `refs/heads/${branch}^{commit}`],
        cwd,
        label: `git rev-parse refs/heads/${branch}`,
      }).trim(),
    operation: "codex.branchTipCommit",
  });
}

/**
 * The floor's answer when the loop could not be judged at all: one failure saying why, and no leftovers read.
 *
 * @param failure the line naming what could not be read
 * @param headSha the tip commit, when it was resolved before the read failed
 * @returns the floor's answer carrying that one failure
 */
function unjudged({ failure, headSha }: { failure: string; headSha: string | undefined }): CheckoutLandingFloor {
  return { failures: [failure], headSha, leftovers: [] };
}

/**
 * Ask the landing floor about a branch exactly as `github enqueue` would ask it about a pull request whose head
 * is this checkout's tip of that branch.
 *
 * @param cwd the checkout `codex status --check` is about
 * @param home the state home holding the pass records and receipts
 * @param branch the branch being reported on
 * @param fallbackPort where the Claude fallback receipts are read
 * @param signInPort where the fleet cap read files and reads the Codex sign-in observations
 * @param supersessions the register of retired passes, handed through to the landing reader
 * @returns the commit judged and the landing verbs' own failure lines for it
 */
export async function checkoutLandingFloor({
  cwd,
  fallbackPort,
  home,
  branch,
  supersessions,
  signInPort,
}: {
  cwd: string;
  fallbackPort: FallbackRegisterPort;
  home: string;
  branch: string;
  supersessions: SupersessionPort;
  signInPort: CodexSignInPort;
}): Promise<CheckoutLandingFloor> {
  const origin = originRepositoryOf({ cwd });
  if (origin.isErr()) {
    const failure = `cannot name the repository a landing would judge: ${origin.error.join("; ")}`;
    return unjudged({ failure, headSha: undefined });
  }
  const tip = branchTipCommit({ branch, cwd });
  if (tip.isErr()) {
    return unjudged({
      failure: `cannot resolve the tip of ${branch} in this checkout: ${tip.error.message}`,
      headSha: undefined,
    });
  }
  // No pull request, so no base commit: this floor never reads one, and a bump read is not asked here.
  const head: PullRequestHead = {
    baseSha: undefined,
    branch,
    headSha: tip.value,
    repository: `${origin.value.owner}/${origin.value.repo}`,
  };
  const inspection = associateCodexLoop({
    head,
    local: await readLocalCodexLoop({
      cwd,
      fallbackPort,
      head,
      home,
      signInPort,
      supersessions,
    }),
  });
  if (inspection.kind === "not-examined") {
    return unjudged({ failure: `the Codex loop could not be examined: ${inspection.reason}`, headSha: head.headSha });
  }
  // The leftovers are RETURNED for `--check` to print rather than failed here: the landing verbs are where they
  // raise `codex-loop-incomplete`, and where an acknowledgement with a reason lands them.
  const finding = codexLoopFinding({ inspection: { ...inspection, leftovers: [] } });
  return {
    failures: finding === undefined ? [] : finding.details,
    headSha: head.headSha,
    leftovers: inspection.leftovers,
  };
}
