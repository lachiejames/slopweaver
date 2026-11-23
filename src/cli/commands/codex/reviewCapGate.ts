/**
 * The third-review-pass refusal — the CLI shell's half of the two-pass cap, whose pure decision is
 * `../../../codex/reviewPassCap.ts`.
 *
 * Asked by BOTH ways a review can be taken, before anything is spent: `codex review` before its fan-out reads a
 * fleet, and `codex review-fallback prepare` before it writes a request that would send a visible Claude
 * session to review the diff. The cap is on review, never on a provider, so the two read one fold — Codex rows
 * and Claude fallback receipts together, through `./branchLedgerRead.ts`, the fold `codex status` and the
 * landing floor read.
 *
 * ## A fold it cannot read refuses, as the landing floor does
 *
 * Unlike the duplicate gate (`../../../codex/passAdmission.ts`), which lets a pass run on an unreadable record,
 * this one fails closed. The ruling is "no third pass anywhere", and an unreadable fold cannot say this is not
 * one. Refusing costs nothing a fail-open would have bought: `../../../codex/landingGateRun.ts` reads the same
 * three sources and refuses to land on any one it cannot read, so a review run then could not land the change
 * either. The hatch runs it anyway, and says so.
 *
 * ## What it does not close
 *
 * The check is a read before the spend with no lock, so two sessions starting reviews of two DIFFERENT new
 * diffs on one branch at the same instant can both see one pass and both run. A branch is one seat's, so that
 * is two seats on one branch, which the board already refuses; the residue is stated, not closed.
 */

import type { FallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { REVIEW_PASS_CAP, reviewCapDecision } from "../../../codex/reviewPassCap.js";
import type { SupersessionPort } from "../../../codex/supersessionPort.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import { readBranchLedger } from "./branchLedgerRead.js";

/** The variable that lets a third review pass run anyway — named in the refusal, and asserted by its test. */
export const ALLOW_CODEX_REVIEW_PASS_CAP_ENV = "SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP";

/** What the cap says about one review about to run: whether it is refused, and the lines to print on stderr. */
export interface ReviewCapVerdict {
  readonly refused: boolean;
  readonly lines: readonly string[];
}

/** The leading digits of a sha256, enough for a reader to tell two diffs apart. */
const SHORT = 12;

/**
 * Whether a review of this diff would be a third pass on its branch.
 *
 * @param branch the branch the diff's tree was captured on — `null` on a detached HEAD and `undefined` when the
 *   checkout moved mid-capture; either way the review lands on no branch's count, so nothing is refused
 * @param diff the frozen diff about to be reviewed, and the checkout it came from
 * @param env the environment {@link ALLOW_CODEX_REVIEW_PASS_CAP_ENV} is read from — `process.env` in the verbs
 * @param fallbackPort where the Claude fallback receipts are read — they spend the same two passes
 * @param home the state home holding the pass records
 * @param supersessions the register of retired passes, read with the fold (a retirement spends no pass back)
 * @param verb the verb asking, so every line it prints names it
 * @returns refused with the four-line refusal, or allowed with the line saying which pass this is
 */
export async function reviewCapVerdict({
  branch,
  diff,
  env,
  fallbackPort,
  home,
  supersessions,
  verb,
}: {
  branch: string | null | undefined;
  diff: { readonly repoRoot: string; readonly sha256: string };
  env: Readonly<Record<string, string | undefined>>;
  fallbackPort: FallbackRegisterPort;
  home: string;
  supersessions: SupersessionPort;
  verb: string;
}): Promise<ReviewCapVerdict> {
  if (branch == null) {
    return { lines: [], refused: false };
  }
  const ledger = await readBranchLedger({ branch, fallbackPort, home, repoRoot: diff.repoRoot, supersessions });
  const hatchOpen = env[ALLOW_CODEX_REVIEW_PASS_CAP_ENV] === "1";
  if (ledger.isErr()) {
    return unreadableFoldVerdict({ branch, hatchOpen, reason: ledger.error.message, verb });
  }
  const decision = reviewCapDecision({ candidateDiffSha256: diff.sha256, entries: ledger.value });
  if (decision.kind === "allowed") {
    return {
      lines: [`${verb}: review pass ${String(decision.pass)} of ${String(REVIEW_PASS_CAP)} on ${branch}`],
      refused: false,
    };
  }
  return thirdPassVerdict({ branch, diffSha256: diff.sha256, hatchOpen, reviewed: decision.reviewed, verb });
}

/**
 * The verdict when the branch's fold could not be read: refused, since an unreadable fold cannot say this is not
 * a third pass, unless the hatch runs it anyway.
 *
 * @param reason why the fold could not be read
 * @returns the verdict and its lines
 */
function unreadableFoldVerdict({
  branch,
  hatchOpen,
  reason,
  verb,
}: {
  branch: string;
  hatchOpen: boolean;
  reason: string;
  verb: string;
}): ReviewCapVerdict {
  if (hatchOpen) {
    return {
      lines: [
        `${verb}: the two-pass review cap could not be checked (${reason}), and ${ALLOW_CODEX_REVIEW_PASS_CAP_ENV}=1 runs this review anyway — say why in the pull request`,
      ],
      refused: false,
    };
  }
  return {
    lines: hatchRefusalLines({
      detail:
        `which review pass this diff would be on ${branch} cannot be told, so it might be a third: ` +
        `${reason} — the landing floor refuses on the same read, so repair it first`,
      hatch: hatchFor({ id: "codex-review-pass-cap" }),
    }),
    refused: true,
  };
}

/**
 * The verdict on a review that would be a third pass: refused, unless the hatch runs it anyway.
 *
 * @param reviewed the two diffs the branch's passes already reviewed, oldest first
 * @returns the verdict and its lines
 */
function thirdPassVerdict({
  branch,
  diffSha256,
  hatchOpen,
  reviewed,
  verb,
}: {
  branch: string;
  diffSha256: string;
  hatchOpen: boolean;
  reviewed: readonly string[];
  verb: string;
}): ReviewCapVerdict {
  if (hatchOpen) {
    return {
      lines: [
        `${verb}: a THIRD review pass on ${branch}, run by ${ALLOW_CODEX_REVIEW_PASS_CAP_ENV}=1 — say why in the pull request`,
      ],
      refused: false,
    };
  }
  const diffs = reviewed.map((digest) => `${digest.slice(0, SHORT)}…`).join(" and ");
  return {
    lines: hatchRefusalLines({
      detail:
        `${branch} has had its two review passes (diffs ${diffs}) and this diff (${diffSha256.slice(0, SHORT)}…) ` +
        "would be a third — land it with every finding still standing acknowledged as codex-loop-incomplete " +
        "with a --reason (`codex status --check` prints each one)",
      hatch: hatchFor({ id: "codex-review-pass-cap" }),
    }),
    refused: true,
  };
}

/**
 * {@link reviewCapVerdict}, printed — the one call each review verb makes before it spends.
 *
 * @returns true when the review is refused and must not run
 */
export async function refusedByReviewCap(args: Parameters<typeof reviewCapVerdict>[0]): Promise<boolean> {
  const verdict = await reviewCapVerdict(args);
  for (const line of verdict.lines) {
    if (verdict.refused) {
      logger.error({ msg: line });
    } else {
      logger.info({ msg: line });
    }
  }
  return verdict.refused;
}
