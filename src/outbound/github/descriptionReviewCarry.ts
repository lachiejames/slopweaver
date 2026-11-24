/**
 * The effectful half of carrying an earlier CLEAN description review over a change set that moved only
 * immaterially (`./descriptionReviewMateriality.ts` decides; this reads).
 *
 * A receipt stores only the change set's digest, so the tree delta it reviewed is recovered from the packet
 * repository its preparation committed: `change/delta.txt` read at the packet's BASE commit, never the working tree,
 * then re-hashed and required to equal the receipt's own `changeDigest`. A preparation that is gone, a packet that
 * does not read, a line that does not parse, or a digest that does not reproduce (a path carrying a newline is
 * one) all fail closed: the write asks for a fresh review and says which read failed.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { runGitChecked } from "../../codex/gitRun.js";
import { changeDigestOf, type TreeDeltaEntry } from "./descriptionChangeDigest.js";
import { type DescriptionReviewError, DescriptionReviewErrors } from "./descriptionReviewErrors.js";
import {
  carriedReviewNotice,
  type DescriptionClaimText,
  decideDescriptionMateriality,
  sameDescriptionInputs,
} from "./descriptionReviewMateriality.js";
import {
  PACKET_REPO_DIRNAME,
  preparationsDirectory,
  readPreparationAtRoot,
  readReceipt,
  receiptsDirectory,
} from "./descriptionReviewStore.js";
import type { DescriptionReviewManifest, DescriptionReviewReceipt } from "./descriptionReviewTypes.js";

/** Where the reviewed tree delta sits in a packet's base commit. */
const PACKET_DELTA_PATH = "change/delta.txt";

/** One delta line: status, both modes, both blobs, then the path, which may itself carry spaces. */
const DELTA_LINE = /^([ADMT]) (\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) (.+)$/;

/** The header line naming the digest the delta was written under. */
const DELTA_HEADER = /^changeDigest ([0-9a-f]{64})$/;

/**
 * Parse a packet's `change/delta.txt` back into the entries it lists, and require them to hash to the digest its
 * header names.
 *
 * @param text the file's exact contents
 * @returns the entries, or the first thing about the file that does not read
 */
export function parseStoredTreeDelta({
  text,
}: {
  text: string;
}): Result<readonly TreeDeltaEntry[], DescriptionReviewError> {
  const failed = ({ detail }: { detail: string }): Result<readonly TreeDeltaEntry[], DescriptionReviewError> =>
    err(DescriptionReviewErrors.preparationFailed({ detail: `${PACKET_DELTA_PATH} ${detail}` }));
  const lines = text.split("\n");
  const header = DELTA_HEADER.exec(lines[0]!);
  if (header === null || lines.at(-1) !== "") {
    return failed({ detail: "does not open on its digest line and end on a newline" });
  }
  const entries: TreeDeltaEntry[] = [];
  for (const line of lines.slice(1, -1)) {
    const match = DELTA_LINE.exec(line);
    if (match === null) {
      return failed({ detail: `carries a line it cannot read: ${JSON.stringify(line)}` });
    }
    entries.push({
      newBlob: match[5]!,
      newMode: match[3]!,
      oldBlob: match[4]!,
      oldMode: match[2]!,
      path: match[6]!,
      status: match[1]!,
    });
  }
  if (changeDigestOf({ entries }) !== header[1]) {
    return failed({ detail: "does not hash to the digest it names" });
  }
  return ok(entries);
}

/**
 * Recover the tree delta an earlier receipt's review read, from its packet's base commit.
 *
 * @param home the state home holding the preparations
 * @param receipt the earlier receipt
 * @returns the entries, re-hashed to the receipt's own change digest, or why they cannot be trusted
 */
export function readReviewedTreeDelta({
  home,
  receipt,
}: {
  home: string;
  receipt: DescriptionReviewReceipt;
}): Result<readonly TreeDeltaEntry[], DescriptionReviewError> {
  const repoRoot = join(preparationsDirectory({ home }), receipt.preparationId, PACKET_REPO_DIRNAME);
  const preparation = readPreparationAtRoot({ home, repoRoot });
  if (preparation.isErr()) {
    return err(preparation.error);
  }
  if (preparation.value === undefined || preparation.value.manifestSha256 !== receipt.manifestSha256) {
    return err(
      DescriptionReviewErrors.preparationFailed({
        detail: `preparation ${receipt.preparationId} is not the packet receipt ${receipt.receiptId} reviewed`,
      }),
    );
  }
  let text: string;
  try {
    text = runGitChecked({
      args: ["cat-file", "blob", `${preparation.value.baseSha}:${PACKET_DELTA_PATH}`],
      cwd: repoRoot,
      label: "git cat-file",
    });
  } catch (error: unknown) {
    return err(
      DescriptionReviewErrors.preparationFailed({ detail: `reading ${repoRoot}: ${errorMessage({ error })}` }),
    );
  }
  return parseStoredTreeDelta({ text }).andThen((entries) =>
    changeDigestOf({ entries }) === receipt.manifest.changeDigest
      ? ok(entries)
      : err(
          DescriptionReviewErrors.preparationFailed({
            detail: `${PACKET_DELTA_PATH} is not the change set receipt ${receipt.receiptId} bound`,
          }),
        ),
  );
}

/** An earlier CLEAN review carried over this write, or the reasons none is. */
export type CarriedReview =
  | { readonly kind: "carried"; readonly receipt: DescriptionReviewReceipt; readonly notice: string }
  | { readonly kind: "none"; readonly reasons: readonly string[] };

/**
 * Find the earlier review of this same description and decide whether it still covers the change set this write
 * sends. Only the NEWEST receipt over the same inputs is a candidate: a BROKEN one there refuses rather than
 * reaching behind it for an older CLEAN, and any read that fails refuses too.
 *
 * @param home the state home holding the receipts' preparations
 * @param want the manifest the write would send, which no receipt covers exactly
 * @param currentEntries the tree delta the write would send
 * @param claims the description's authored text
 * @param receipts every readable receipt in the store
 * @returns the carried receipt with the line the write prints, or why the write needs a fresh review
 */
export function carriedCleanReview({
  home,
  want,
  currentEntries,
  claims,
  receipts,
}: {
  home: string;
  want: DescriptionReviewManifest;
  currentEntries: readonly TreeDeltaEntry[];
  claims: DescriptionClaimText;
  receipts: readonly DescriptionReviewReceipt[];
}): CarriedReview {
  const newest = receipts
    .filter((one) => sameDescriptionInputs({ reviewed: one.manifest, want }))
    .toSorted(
      (left, right) =>
        right.recordedAtIso.localeCompare(left.recordedAtIso) || right.receiptId.localeCompare(left.receiptId),
    )[0];
  if (newest === undefined) {
    return { kind: "none", reasons: [] };
  }
  if (newest.verdict !== "CLEAN") {
    return { kind: "none", reasons: [`the newest review of this same description, ${newest.receiptId}, is BROKEN`] };
  }
  const reviewedEntries = readReviewedTreeDelta({ home, receipt: newest });
  if (reviewedEntries.isErr()) {
    return {
      kind: "none",
      reasons: [`the change set ${newest.receiptId} reviewed cannot be read back (${reviewedEntries.error.message})`],
    };
  }
  const decision = decideDescriptionMateriality({ claims, currentEntries, reviewedEntries: reviewedEntries.value });
  if (decision.kind === "review") {
    return { kind: "none", reasons: decision.reasons };
  }
  return {
    kind: "carried",
    notice: carriedReviewNotice({ changedPaths: decision.changedPaths, receiptId: newest.receiptId }),
    receipt: newest,
  };
}

/**
 * Every receipt in the store, read strictly. Unlike the advisory listing a refusal explains itself with, one file
 * that does not read refuses the whole listing, so a corrupt newer review is never skipped in favour of an older
 * CLEAN one.
 *
 * @param home the state home holding the receipts
 * @returns every stored receipt, or the first file that does not read
 */
export function readEveryReceipt({
  home,
}: {
  home: string;
}): Result<readonly DescriptionReviewReceipt[], DescriptionReviewError> {
  const directory = receiptsDirectory({ home });
  if (!existsSync(directory)) {
    return ok([]);
  }
  const receipts: DescriptionReviewReceipt[] = [];
  for (const name of readdirSync(directory).filter((one) => one.endsWith(".json"))) {
    const read = readReceipt({ home, manifestSha256: name.slice(0, -".json".length) });
    if (read.isErr()) {
      return err(read.error);
    }
    if (read.value !== undefined) {
      receipts.push(read.value);
    }
  }
  return ok(receipts);
}

/**
 * {@link carriedCleanReview} over the whole store, read strictly: a store holding any receipt that does not read
 * carries nothing.
 *
 * @param home the state home holding the receipts and their preparations
 * @param want the manifest the write would send, which no receipt covers exactly
 * @param currentEntries the tree delta the write would send
 * @param claims the description's authored text
 * @returns the carried receipt with the line the write prints, or why the write needs a fresh review
 */
export function carriedFromStore({
  home,
  want,
  currentEntries,
  claims,
}: {
  home: string;
  want: DescriptionReviewManifest;
  currentEntries: readonly TreeDeltaEntry[];
  claims: DescriptionClaimText;
}): CarriedReview {
  const receipts = readEveryReceipt({ home });
  if (receipts.isErr()) {
    return {
      kind: "none",
      reasons: [`a stored description review does not read, so none is carried (${receipts.error.message})`],
    };
  }
  return carriedCleanReview({ claims, currentEntries, home, receipts: receipts.value, want });
}
