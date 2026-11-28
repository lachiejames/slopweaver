/**
 * Effectful shell for `slopweaver github pr review-record`, and the edges both halves of the required review of a
 * pull-request description share. `review-prepare`, the other half, is `./prDescriptionReviewPrepareRun.ts`.
 *
 * `review-record` resolves the review the reviewer produced (a Codex pass, else a Claude fallback receipt — the
 * same order `page publish --review` reads them in), proves it judged this packet, refuses a fallback review
 * recorded by the session that prepared the packet, and stores ONE receipt per packet. The write verbs then find
 * that receipt by the digest of what they send (`../../../outbound/github/descriptionReviewGate.ts`).
 *
 * Dispatched by `./run.ts` before `parseGithubPrArgs`, beside `summary` and `standing`: neither subverb writes a
 * description, so none of the description-write machinery applies.
 */
import { randomUUID } from "node:crypto";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import type { FallbackReceiptScan } from "../../../codex/fallbackDocuments.js";
import { fallbackRegisterPort } from "../../../codex/fallbackPort.js";
import type { FallbackStoreError } from "../../../codex/fallbackStoreErrors.js";
import type { CodexArtifactRecord } from "../../../codex/types.js";
import type { AttachUploadStanding } from "../../../handover/attachUploadRuling.js";
import { readAttachUploadStanding } from "../../../handover/attachUploadRulingStore.js";
import {
  bindDescriptionReview,
  decideReviewerFreshness,
  descriptionReceiptOf,
} from "../../../outbound/github/descriptionReview.js";
import {
  type DescriptionReviewCommentsReader,
  readDescriptionComments,
} from "../../../outbound/github/descriptionReviewComments.js";
import {
  type DescriptionReviewError,
  DescriptionReviewErrors,
} from "../../../outbound/github/descriptionReviewErrors.js";
import { installedRulesRoot } from "../../../outbound/github/descriptionReviewRules.js";
import {
  packetCommitFacts,
  readPreparationAtRoot,
  writeReceiptOnce,
} from "../../../outbound/github/descriptionReviewStore.js";
import type { DescriptionReviewReceipt } from "../../../outbound/github/descriptionReviewTypes.js";
import {
  candidateFromCodexRecord,
  candidateFromFallbackReceipt,
  type PageReviewCandidate,
} from "../../../pages/review.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { readCitedPass } from "../page/publishReview.js";
import { parseGithubPrReviewRecordArgs, visibleSessionOf } from "./prDescriptionReviewCore.js";
import { GITHUB_PR_REVIEW_RECORD_USAGE } from "./prDescriptionReviewUsage.js";

/** The edges both subverbs run over, injected so a test passes plain values and no mocks. */
export interface GithubPrDescriptionReviewDeps {
  readonly out: (args: { line: string }) => void;
  readonly writeDiagnostic: (args: { line: string }) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nowIso: () => string;
  readonly newId: () => string;
  /** The working directory a `--cwd`-less prepare reads the change set from. */
  readonly cwd: string;
  /** The running CLI's tree, the written rules' source for any repository but this source repository. */
  readonly installedRulesRoot: string;
  /** One Codex pass record by artifact id: undefined when the id names none, an error when it is unreadable. */
  readonly readPass: (args: {
    orchestrationRoot: string;
    artifactId: string;
  }) => Result<CodexArtifactRecord | undefined, { readonly message: string }>;
  /** Every bound Claude fallback receipt in the store. */
  readonly scanFallback: (args: { home: string }) => Promise<Result<FallbackReceiptScan, FallbackStoreError>>;
  /** The comments already on an open pull request, read whole; a prepare for `--new` never calls it. */
  readonly readComments: DescriptionReviewCommentsReader;
  /**
   * The attach-upload standing on this home, so a prepare tells the reviewer when no picture can be supplied. The
   * production default reads the owner's recorded word (`readAttachUploadStanding`).
   */
  readonly attachUploadStanding: (args: { home: string }) => AttachUploadStanding;
}

/**
 * Print a domain failure and answer its exit code: usage problems with the usage line, the rest alone.
 *
 * @param usage the usage text of the subverb that failed
 * @returns the usage exit code for a usage problem, the error exit code otherwise
 */
export function failDescriptionReviewVerb({
  deps,
  error,
  usage,
}: {
  deps: GithubPrDescriptionReviewDeps;
  error: DescriptionReviewError;
  usage: string;
}): number {
  if (error.code === "USAGE") {
    for (const problem of error.problems) {
      deps.writeDiagnostic({ line: problem });
    }
    deps.writeDiagnostic({ line: usage });
    return EXIT_USAGE;
  }
  deps.writeDiagnostic({ line: error.message });
  return EXIT_ERROR;
}

/** Find the review an id names: a Codex pass first, then a Claude fallback receipt by receipt or request id. */
async function candidateFor({
  deps,
  home,
  reviewId,
}: {
  deps: GithubPrDescriptionReviewDeps;
  home: string;
  reviewId: string;
}): Promise<Result<PageReviewCandidate, DescriptionReviewError>> {
  const pass = deps.readPass({ artifactId: reviewId, orchestrationRoot: stateHomePaths({ home }).orchestration });
  if (pass.isErr()) {
    return err(DescriptionReviewErrors.unusable({ reviewId, why: pass.error.message }));
  }
  if (pass.value !== undefined) {
    return candidateFromCodexRecord({ id: reviewId, record: pass.value }).mapErr((error) =>
      DescriptionReviewErrors.unusable({ reviewId, why: error.message }),
    );
  }
  const scan = await deps.scanFallback({ home });
  if (scan.isErr()) {
    return err(DescriptionReviewErrors.unusable({ reviewId, why: `the fallback store: ${scan.error.message}` }));
  }
  // Checked BEFORE a match: an unreadable receipt may be a later one for this same request.
  if (scan.value.unreadable > 0) {
    const why = `${String(scan.value.unreadable)} stored fallback receipt(s) cannot be read, and one may be this review`;
    return err(DescriptionReviewErrors.unusable({ reviewId, why }));
  }
  const receipt = scan.value.receipts.find((one) => one.receiptId === reviewId || one.requestId === reviewId);
  if (receipt === undefined) {
    const why = "it names no Codex pass and no Claude fallback receipt";
    return err(DescriptionReviewErrors.unusable({ reviewId, why }));
  }
  return ok(candidateFromFallbackReceipt({ id: reviewId, receipt }));
}

/** Resolve, bind, judge freshness and store one review as its packet's receipt. */
async function recordReview({
  deps,
  home,
  reviewId,
}: {
  deps: GithubPrDescriptionReviewDeps;
  home: string;
  reviewId: string;
}): Promise<Result<DescriptionReviewReceipt, DescriptionReviewError>> {
  const candidate = await candidateFor({ deps, home, reviewId });
  if (candidate.isErr()) {
    return err(candidate.error);
  }
  const { baseSha, headSha, repoRoot } = candidate.value;
  const preparation = readPreparationAtRoot({ home, repoRoot });
  if (preparation.isErr()) {
    return err(preparation.error);
  }
  if (preparation.value === undefined) {
    const why = `it read ${repoRoot}, which is not a \`github pr review-prepare\` packet under this home`;
    return err(DescriptionReviewErrors.wrongPacket({ reviewId, why }));
  }
  const packet = preparation.value;
  const recordedBy = visibleSessionOf({ env: deps.env });
  const receipt = packetCommitFacts({ baseSha, headSha, repoRoot })
    .andThen((facts) => bindDescriptionReview({ candidate: candidate.value, facts, preparation: packet }))
    .andThen((bound) =>
      decideReviewerFreshness({ preparedBy: packet.preparedBy, recordedBy, reviewer: bound.candidate.reviewer }).map(
        () =>
          descriptionReceiptOf({
            candidate: bound.candidate,
            preparation: bound.preparation,
            receiptId: deps.newId(),
            recordedAtIso: deps.nowIso(),
            recordedBy,
          }),
      ),
    );
  if (receipt.isErr()) {
    return err(receipt.error);
  }
  return writeReceiptOnce({ home, receipt: receipt.value }).map(() => receipt.value);
}

/**
 * Run `github pr review-record`.
 *
 * @param deps the injected edges
 * @param rest argv after `github pr review-record`
 * @returns the process exit code: 0 for a CLEAN receipt, 1 for a BROKEN one or any refusal
 */
export async function runGithubPrReviewRecord({
  deps,
  rest,
}: {
  deps: GithubPrDescriptionReviewDeps;
  rest: readonly string[];
}): Promise<number> {
  const usage = GITHUB_PR_REVIEW_RECORD_USAGE;
  const parsed = parseGithubPrReviewRecordArgs({ rest });
  if (parsed.isErr()) {
    return failDescriptionReviewVerb({ deps, error: parsed.error, usage });
  }
  const { home: named, json, reviewId } = parsed.value;
  const recorded = await recordReview({ deps, home: resolveHome({ named }), reviewId });
  if (recorded.isErr()) {
    return failDescriptionReviewVerb({ deps, error: recorded.error, usage });
  }
  const receipt = recorded.value;
  const clean = receipt.verdict === "CLEAN";
  if (json) {
    deps.out({ line: JSON.stringify(receipt) });
    return clean ? EXIT_OK : EXIT_ERROR;
  }
  deps.out({
    line: `receipt ${receipt.receiptId}: ${receipt.verdict} from ${receipt.reviewer} (review ${receipt.reviewId}) over packet ${receipt.manifestSha256}`,
  });
  if (clean) {
    deps.out({
      line: "  the write verb now sends exactly these bytes; an edit to the title, body, comments, images, rules or change set, or a comment arriving on the pull request, needs a new review",
    });
    return EXIT_OK;
  }
  deps.out({ line: `  BROKEN: ${receipt.summary} Edit the description, then prepare and review it again.` });
  return EXIT_ERROR;
}

/**
 * Production edges: the real environment, clock, ids, working directory, this build's tree for another repository's
 * rules, the home's Codex pass records, the fallback store and the pull request's comments on GitHub.
 *
 * @returns the deps
 */
export function productionGithubPrDescriptionReviewDeps(): GithubPrDescriptionReviewDeps {
  return {
    attachUploadStanding: ({ home }) => readAttachUploadStanding({ runsDir: stateHomePaths({ home }).runs }),
    cwd: process.cwd(),
    env: process.env,
    installedRulesRoot: installedRulesRoot(),
    newId: () => randomUUID(),
    nowIso: () => new Date().toISOString(),
    out: logger.out,
    readComments: readDescriptionComments,
    readPass: readCitedPass,
    scanFallback: (args) => fallbackRegisterPort().scan(args),
    writeDiagnostic: ({ line }) => {
      logger.error({ msg: line });
    },
  };
}
