/**
 * `slopweaver private-terms review-prepare | review-record`: the REVIEW ON A MATCH, after a write has been held.
 *
 * A write that a private term with a meaning matched is HELD. It prints a hold id and nothing is sent
 * (`../../../outbound/privateTermReview/gate.ts`). Then:
 *
 * - `review-prepare --hold <id>` commits the hold into a packet repository: the terms' meanings and the
 *   destination at the base commit, the matched contexts and the write's text at the head. It then prints the
 *   one-property review a fresh reviewer runs over that diff.
 * - `review-record --review <id>` resolves the review that came back, a Codex pass, and proves it judged THIS
 *   packet before it stores one receipt. A Claude fallback receipt is refused by name: it records no session id,
 *   so nothing here could prove it was not written by the session that held or prepared the write.
 *
 * A CLEAN receipt releases exactly that write the next time it is run, once. A BROKEN one keeps it held.
 *
 * Neither verb prints a term, a pattern or a matched context: the packet lives under `$SLOPWEAVER_HOME` at 0700,
 * and what these lines name is ids and paths.
 */
import { randomUUID } from "node:crypto";

import { logger } from "#lib/logger.js";
import { err, type Result } from "#lib/result.js";
import { shellCommandLine } from "#lib/shellCommandLine.js";

import type { FallbackReceiptScan } from "../../../codex/fallbackDocuments.js";
import { fallbackRegisterPort } from "../../../codex/fallbackPort.js";
import type { FallbackStoreError } from "../../../codex/fallbackStoreErrors.js";
import type { CodexArtifactRecord } from "../../../codex/types.js";
import { type PrivateTermReviewError, PrivateTermReviewErrors } from "../../../outbound/privateTermReview/errors.js";
import { visibleSessionNow } from "../../../outbound/privateTermReview/gate.js";
import { preparePrivateTermPacket, privateTermPacketFacts } from "../../../outbound/privateTermReview/packet.js";
import {
  bindPrivateTermReview,
  decidePrivateTermReviewerFreshness,
  privateTermReceiptOf,
} from "../../../outbound/privateTermReview/record.js";
import { readHold, readPreparationAtRoot, writeReceipt } from "../../../outbound/privateTermReview/store.js";
import {
  PRIVATE_TERM_REVIEW_PROPERTY,
  PRIVATE_TERM_REVIEW_PROPERTY_ID,
  type PrivateTermReviewPreparation,
  type PrivateTermReviewReceipt,
} from "../../../outbound/privateTermReview/types.js";
import { candidateFromCodexRecord, type PageReviewCandidate } from "../../../pages/review.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { readCitedPass } from "../page/publishReview.js";
import { type PrivateTermsVerb, parsePrivateTermsReviewArgs, privateTermsUsage, VERB_ARG_OFFSET } from "./core.js";
import { printEdgesUnderArgvHomes } from "./printGuard.js";

/** How long the printed Codex review may run before it gives up. */
const REVIEW_BOUND_SECONDS = 600;

/** Room above the packet's own diff that the printed `--max-diff-bytes` leaves for the review's framing. */
const DIFF_HEADROOM_BYTES = 4096;

/** The edges both review verbs run over, injected so a test passes plain values and no mocks. */
export interface PrivateTermsReviewDeps {
  readonly out: (args: { line: string }) => void;
  readonly writeDiagnostic: (args: { line: string }) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nowIso: () => string;
  readonly newId: () => string;
  /** One Codex pass record by artifact id: undefined when the id names none, an error when it is unreadable. */
  readonly readPass: (args: {
    orchestrationRoot: string;
    artifactId: string;
  }) => Result<CodexArtifactRecord | undefined, { readonly message: string }>;
  /** Every bound Claude fallback receipt in the store. */
  readonly scanFallback: (args: { home: string }) => Promise<Result<FallbackReceiptScan, FallbackStoreError>>;
}

/**
 * Production edges: the real environment, clock, ids, the home's Codex pass records and the fallback store.
 *
 * @returns the deps
 */
export function productionPrivateTermsReviewDeps(): PrivateTermsReviewDeps {
  return {
    env: process.env,
    newId: () => randomUUID(),
    nowIso: () => new Date().toISOString(),
    out: logger.out,
    readPass: readCitedPass,
    scanFallback: (args) => fallbackRegisterPort().scan(args),
    writeDiagnostic: ({ line }) => {
      logger.error({ msg: line });
    },
  };
}

/** Print a domain failure and answer its exit code: usage problems with the usage line, the rest alone. */
function failReviewVerb({
  deps,
  error,
  verb,
}: {
  deps: PrivateTermsReviewDeps;
  error: PrivateTermReviewError;
  verb: PrivateTermsVerb;
}): number {
  if (error.code === "USAGE") {
    for (const problem of error.problems) {
      deps.writeDiagnostic({ line: problem });
    }
    deps.writeDiagnostic({ line: privateTermsUsage({ verb }) });
    return EXIT_USAGE;
  }
  deps.writeDiagnostic({ line: error.message });
  return EXIT_ERROR;
}

/**
 * Pure: the commands a prepared packet's reviewer runs, in order: the Codex review, then the record step.
 *
 * @param preparation the packet's record
 * @param repoRoot the packet repository the reviewer is pointed at
 * @param home the state home every step names
 * @param maxDiffBytes the diff bound the review is given
 * @returns each command as one shell line
 */
export function privateTermReviewCommands({
  preparation,
  repoRoot,
  home,
  maxDiffBytes,
}: {
  preparation: PrivateTermReviewPreparation;
  repoRoot: string;
  home: string;
  maxDiffBytes: number;
}): {
  readonly review: string;
  readonly record: string;
} {
  const property = ["--property-id", PRIVATE_TERM_REVIEW_PROPERTY_ID, "--property", PRIVATE_TERM_REVIEW_PROPERTY];
  const bound = ["--base", preparation.baseSha, "--max-diff-bytes", String(maxDiffBytes)];
  const where = ["--repo", repoRoot, "--home", home];
  // Each fixed head is literal words with no space inside one, so splitting it is exact.
  const words = ({ text }: { text: string }): string[] => text.split(" ");
  return {
    record: shellCommandLine({
      command: [...words({ text: "slopweaver private-terms review-record --review <artifact-id> --home" }), home],
    }),
    review: shellCommandLine({
      command: [
        ...words({ text: "slopweaver codex review --pass r1" }),
        ...property,
        ...bound,
        "--bound-seconds",
        String(REVIEW_BOUND_SECONDS),
        ...where,
      ],
    }),
  };
}

/**
 * Run `private-terms review-prepare --hold <id>`.
 *
 * @param argv the full process argv
 * @param deps the injected edges
 * @returns the exit code
 */
export function runPrivateTermsReviewPrepare({
  argv,
  deps: given,
}: {
  argv: readonly string[];
  deps: PrivateTermsReviewDeps;
}): number {
  const verb = "review-prepare";
  const deps = printEdgesUnderArgvHomes({ argv, deps: given });
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out({ line: privateTermsUsage({ verb }) });
    return EXIT_OK;
  }
  const parsed = parsePrivateTermsReviewArgs({ rest, verb });
  if (parsed.isErr()) {
    return failReviewVerb({ deps, error: PrivateTermReviewErrors.usage({ problems: parsed.error }), verb });
  }
  const home = resolveHome({ named: parsed.value.home });
  const prepared = readHold({ holdId: parsed.value.id, home }).andThen((hold) =>
    preparePrivateTermPacket({
      createdAtIso: deps.nowIso(),
      hold,
      home,
      preparationId: deps.newId(),
      preparedBy: visibleSessionNow({ env: deps.env }),
    }),
  );
  if (prepared.isErr()) {
    return failReviewVerb({ deps, error: prepared.error, verb });
  }
  const { diffBytes, preparation, repoRoot } = prepared.value;
  const commands = privateTermReviewCommands({
    home,
    maxDiffBytes: diffBytes + DIFF_HEADROOM_BYTES,
    preparation,
    repoRoot,
  });
  if (parsed.value.json) {
    deps.out({ line: JSON.stringify({ commands, preparation, repoRoot }) });
    return EXIT_OK;
  }
  for (const line of [
    `packet ${preparation.preparationId} for hold ${preparation.holdId}: ${repoRoot}`,
    "  a fresh reviewer, never the session that attempted the write, judges each match against its term's meaning:",
    `  review:          ${commands.review}`,
    `  then record it:  ${commands.record}`,
    "  a Claude fallback receipt cannot release it: it records no session id, so Codex capped leaves it held",
    "  then run the held write again, unchanged: a CLEAN receipt releases it once, a BROKEN one keeps it held",
  ]) {
    deps.out({ line });
  }
  return EXIT_OK;
}

/** Find the review an id names: a Codex pass first, then a Claude fallback receipt by receipt or request id. */
async function candidateFor({
  deps,
  home,
  reviewId,
}: {
  deps: PrivateTermsReviewDeps;
  home: string;
  reviewId: string;
}): Promise<Result<PageReviewCandidate, PrivateTermReviewError>> {
  const pass = deps.readPass({ artifactId: reviewId, orchestrationRoot: stateHomePaths({ home }).orchestration });
  if (pass.isErr()) {
    return err(PrivateTermReviewErrors.reviewUnusable({ reviewId, why: pass.error.message }));
  }
  if (pass.value !== undefined) {
    return candidateFromCodexRecord({ id: reviewId, record: pass.value }).mapErr((error) =>
      PrivateTermReviewErrors.reviewUnusable({ reviewId, why: error.message }),
    );
  }
  const scan = await deps.scanFallback({ home });
  if (scan.isErr()) {
    return err(PrivateTermReviewErrors.reviewUnusable({ reviewId, why: `the fallback store: ${scan.error.message}` }));
  }
  // Checked BEFORE a match: an unreadable receipt may be a later one for this same request.
  if (scan.value.unreadable > 0) {
    const why = `${String(scan.value.unreadable)} stored fallback receipt(s) cannot be read, and one may be this review`;
    return err(PrivateTermReviewErrors.reviewUnusable({ reviewId, why }));
  }
  const receipt = scan.value.receipts.find((one) => one.receiptId === reviewId || one.requestId === reviewId);
  if (receipt === undefined) {
    const why = "it names no Codex pass and no Claude fallback receipt";
    return err(PrivateTermReviewErrors.reviewUnusable({ reviewId, why }));
  }
  // A fallback receipt names its reviewer's workspace and model but no session id, so the session running this
  // verb is not the one that wrote it, and nothing here can prove the holder or preparer did not: refuse it.
  return err(PrivateTermReviewErrors.reviewUnusable({ reviewId, why: FALLBACK_UNPROVABLE }));
}

/** Why a Claude fallback receipt cannot release a held write. */
const FALLBACK_UNPROVABLE =
  "it is a Claude fallback receipt, which records no session id, so this verb cannot prove it was written by a " +
  "session other than the one that held or prepared the write; a Codex pass over the packet is the review here";

/** Resolve, bind, judge freshness and store one review as its hold's receipt. */
async function recordReview({
  deps,
  home,
  reviewId,
}: {
  deps: PrivateTermsReviewDeps;
  home: string;
  reviewId: string;
}): Promise<Result<PrivateTermReviewReceipt, PrivateTermReviewError>> {
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
    const why = `it read ${repoRoot}, which is not a \`private-terms review-prepare\` packet under this home`;
    return err(PrivateTermReviewErrors.wrongPacket({ reviewId, why }));
  }
  const packet = preparation.value;
  const recordedBy = visibleSessionNow({ env: deps.env });
  const receipt = readHold({ holdId: packet.holdId, home }).andThen((hold) =>
    privateTermPacketFacts({ baseSha, headSha, repoRoot })
      .andThen((facts) => bindPrivateTermReview({ candidate: candidate.value, facts, hold, preparation: packet }))
      .andThen((bound) =>
        decidePrivateTermReviewerFreshness({
          heldBy: hold.heldBy,
          preparedBy: packet.preparedBy,
          recordedBy,
          reviewer: bound.reviewer,
        }).map(() =>
          privateTermReceiptOf({
            candidate: bound,
            preparation: packet,
            receiptId: deps.newId(),
            recordedAtIso: deps.nowIso(),
            recordedBy,
          }),
        ),
      ),
  );
  if (receipt.isErr()) {
    return err(receipt.error);
  }
  return writeReceipt({ home, receipt: receipt.value }).map(() => receipt.value);
}

/**
 * Run `private-terms review-record --review <id>`.
 *
 * @param argv the full process argv
 * @param deps the injected edges
 * @returns 0 for a CLEAN receipt, 1 for a BROKEN one or any refusal, 2 for a usage problem
 */
export async function runPrivateTermsReviewRecord({
  argv,
  deps: given,
}: {
  argv: readonly string[];
  deps: PrivateTermsReviewDeps;
}): Promise<number> {
  const verb = "review-record";
  const deps = printEdgesUnderArgvHomes({ argv, deps: given });
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out({ line: privateTermsUsage({ verb }) });
    return EXIT_OK;
  }
  const parsed = parsePrivateTermsReviewArgs({ rest, verb });
  if (parsed.isErr()) {
    return failReviewVerb({ deps, error: PrivateTermReviewErrors.usage({ problems: parsed.error }), verb });
  }
  const home = resolveHome({ named: parsed.value.home });
  const recorded = await recordReview({ deps, home, reviewId: parsed.value.id });
  if (recorded.isErr()) {
    return failReviewVerb({ deps, error: recorded.error, verb });
  }
  const receipt = recorded.value;
  const clean = receipt.verdict === "CLEAN";
  if (parsed.value.json) {
    // The summary is the reviewer's own words about each match, so it may quote a term: it stays in the receipt.
    const printable = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "summary"));
    deps.out({ line: JSON.stringify(printable) });
    return clean ? EXIT_OK : EXIT_ERROR;
  }
  deps.out({
    line: `receipt ${receipt.receiptId}: ${receipt.verdict} from ${receipt.reviewer} (review ${receipt.reviewId}) for hold ${receipt.holdId}`,
  });
  if (clean) {
    deps.out({ line: "  run the held write again, unchanged: this receipt releases exactly that write, once" });
    return EXIT_OK;
  }
  deps.out({
    line: "  BROKEN: the write stays held. Reword it, or ask the owner whether the term's meaning or its allowed place should change",
  });
  return EXIT_ERROR;
}

export const privateTermsReviewPrepareCommand = defineCommand({
  run: (argv) => runPrivateTermsReviewPrepare({ argv, deps: productionPrivateTermsReviewDeps() }),
});
export const privateTermsReviewRecordCommand = defineCommand({
  run: (argv) => runPrivateTermsReviewRecord({ argv, deps: productionPrivateTermsReviewDeps() }),
});
