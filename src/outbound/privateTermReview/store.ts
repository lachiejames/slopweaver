/**
 * THE PRIVATE-WORDS REVIEW, its records on disk (`./types.ts`). One root, owner-only:
 *
 * ```text
 * $SLOPWEAVER_HOME/hygiene/private-term-reviews/   0700
 *   holds/<hold-id>.json                           a held write, its exact text included
 *   preparations/<preparation-id>/                 one packet: preparation.json and repo/
 *   receipts/<receipt-id>.json                     a verdict recorded against one hold
 *   spent/<receipt-id>                             a CLEAN receipt that released its write
 * ```
 *
 * ## Released once, by an exclusive create
 *
 * A retry of a held write looks for a CLEAN receipt naming its exact {@link PrivateTermHold.holdKey} and spends it by
 * creating `spent/<receipt-id>` with `O_EXCL`: two retries racing for one receipt cannot both win, and a spent receipt
 * never releases again. Any BROKEN receipt for the same value keeps the write held, whatever else was recorded. The
 * spend happens before the wire, so a send that then fails costs the receipt: a retry is held for a new review,
 * which is the fail-closed direction.
 *
 * A hold record is re-hashed when it is read, so one edited on disk is refused rather than reviewed.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { createFileExclusive, ensureDirectory } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../../stateHome.js";
import type { VisibleSupervisorSession } from "../../supervisor/session.js";
import { decodeHold, decodePreparation, decodeReceipt } from "./decode.js";
import { type PrivateTermReviewError, PrivateTermReviewErrors } from "./errors.js";
import { privateTermHoldKey } from "./hold.js";
import type {
  PrivateTermGateOutcome,
  PrivateTermHold,
  PrivateTermReviewPreparation,
  PrivateTermReviewReceipt,
  PrivateTermWriteDraft,
} from "./types.js";

/** The packet repository's directory name inside its preparation. */
export const PACKET_REPO_DIRNAME = "repo";

/** A hold id: `ph-` and twelve lowercase hex digits. */
const HOLD_ID = /^ph-[0-9a-f]{12}$/u;

/** The four record directories, under one home. */
function reviewPaths({ home }: { home: string }): {
  readonly root: string;
  readonly holds: string;
  readonly preparations: string;
  readonly receipts: string;
  readonly spent: string;
} {
  const root = stateHomePaths({ home }).privateTermReviews;
  return {
    holds: join(root, "holds"),
    preparations: join(root, "preparations"),
    receipts: join(root, "receipts"),
    root,
    spent: join(root, "spent"),
  };
}

/**
 * The directory every preparation of one home sits in.
 *
 * @param home the state home
 * @returns its path
 */
export function preparationsDirectory({ home }: { home: string }): string {
  return reviewPaths({ home }).preparations;
}

/**
 * Make one record directory, owner-only, with the root above it.
 *
 * @param directory the record directory under the review root
 */
export function ensureReviewDirectory({ directory }: { directory: string }): void {
  ensureDirectory({ directory: dirname(directory), mode: 0o700 });
  ensureDirectory({ directory, mode: 0o700 });
}

/** Create one owner-only JSON record exclusively. */
function createRecord({ path, label, value }: { path: string; label: string; value: unknown }): void {
  ensureReviewDirectory({ directory: dirname(path) });
  createFileExclusive({ contents: `${safeJsonStringify({ label, space: 2, value })}\n`, mode: 0o600, path });
}

/** Read one JSON record, or why it does not read. */
function readRecord({ path, label }: { path: string; label: string }): Result<unknown, PrivateTermReviewError> {
  try {
    return ok(safeJsonParse({ label, text: readFileSync(path, "utf8") }));
  } catch (error: unknown) {
    return err(PrivateTermReviewErrors.ioFailed({ cause: error, path, what: `reading the ${label}` }));
  }
}

/** Every `.json` record name in a directory; none when it does not exist yet. */
function recordNames({ directory }: { directory: string }): readonly string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .toSorted();
}

/** Whether a decoded value is a hold this module wrote, its key re-hashed from its own fields. */
function asHold({ value }: { value: unknown }): PrivateTermHold | undefined {
  const hold = decodeHold({ value });
  if (hold === undefined) {
    return undefined;
  }
  const { contents, command, destination, family, matches, requestSha256, terms } = hold;
  if (privateTermHoldKey({ command, contents, destination, family, matches, requestSha256, terms }) !== hold.holdKey) {
    return undefined;
  }
  return hold;
}

/**
 * Read one hold by id.
 *
 * @param home the state home
 * @param holdId the id a held write printed
 * @returns the hold, or why it cannot be used
 */
export function readHold({
  home,
  holdId,
}: {
  home: string;
  holdId: string;
}): Result<PrivateTermHold, PrivateTermReviewError> {
  if (!HOLD_ID.test(holdId)) {
    return err(
      PrivateTermReviewErrors.holdUnusable({
        holdId: "<not a hold id>",
        why: "a hold id is ph- and twelve hex digits",
      }),
    );
  }
  const path = join(reviewPaths({ home }).holds, `${holdId}.json`);
  if (!existsSync(path)) {
    return err(
      PrivateTermReviewErrors.holdUnusable({ holdId, why: "no write under this home was held under that id" }),
    );
  }
  return readRecord({ label: "private-term hold", path }).andThen((value) => {
    const hold = asHold({ value });
    if (hold === undefined || hold.holdId !== holdId) {
      return err(
        PrivateTermReviewErrors.holdUnusable({ holdId, why: `${path} is not a hold this domain wrote, or was edited` }),
      );
    }
    return ok(hold);
  });
}

/** The hold already recorded for one value, if any. */
function holdFor({ home, holdKey }: { home: string; holdKey: string }): PrivateTermHold | undefined {
  for (const name of recordNames({ directory: reviewPaths({ home }).holds })) {
    const read = readHold({ holdId: name.slice(0, -".json".length), home });
    if (read.isOk() && read.value.holdKey === holdKey) {
      return read.value;
    }
  }
  return undefined;
}

/**
 * Every receipt that reads. A file that does not read releases nothing, so skipping it can only keep a write held.
 *
 * @internal
 * @param home the state home
 * @returns the readable receipts, by file name
 */
export function readableReceipts({ home }: { home: string }): readonly PrivateTermReviewReceipt[] {
  const { receipts } = reviewPaths({ home });
  return recordNames({ directory: receipts }).flatMap((name) => {
    const read = readRecord({ label: "private-term review receipt", path: join(receipts, name) });
    const receipt = read.isOk() ? decodeReceipt({ value: read.value }) : undefined;
    return receipt === undefined || `${receipt.receiptId}.json` !== name ? [] : [receipt];
  });
}

/**
 * Store one receipt, refusing a second receipt of the same review.
 *
 * @param home the state home
 * @returns the path written, or why not
 */
export function writeReceipt({
  home,
  receipt,
}: {
  home: string;
  receipt: PrivateTermReviewReceipt;
}): Result<string, PrivateTermReviewError> {
  const earlier = readableReceipts({ home }).find((one) => one.reviewId === receipt.reviewId);
  if (earlier !== undefined) {
    return err(PrivateTermReviewErrors.alreadyRecorded({ receiptId: earlier.receiptId, reviewId: receipt.reviewId }));
  }
  const path = join(reviewPaths({ home }).receipts, `${receipt.receiptId}.json`);
  try {
    createRecord({ label: "private-term review receipt", path, value: receipt });
    return ok(path);
  } catch (error: unknown) {
    return err(PrivateTermReviewErrors.ioFailed({ cause: error, path, what: "writing the receipt" }));
  }
}

/**
 * Record a preparation inside its own directory.
 *
 * @param directory the preparation's directory
 * @param preparation the record
 */
export function writePreparation({
  directory,
  preparation,
}: {
  directory: string;
  preparation: PrivateTermReviewPreparation;
}): void {
  createFileExclusive({
    contents: `${safeJsonStringify({ label: "private-term review preparation", space: 2, value: preparation })}\n`,
    mode: 0o600,
    path: join(directory, "preparation.json"),
  });
}

/**
 * Resolve the preparation a review's recorded repository root names, when it is one of this home's packets.
 *
 * @param home the state home
 * @param repoRoot the repository root the review's record names
 * @returns the preparation, undefined when the root is no packet of this home, or why its record does not read
 */
export function readPreparationAtRoot({
  home,
  repoRoot,
}: {
  home: string;
  repoRoot: string;
}): Result<PrivateTermReviewPreparation | undefined, PrivateTermReviewError> {
  const preparations = preparationsDirectory({ home });
  if (!existsSync(preparations) || !existsSync(repoRoot) || basename(repoRoot) !== PACKET_REPO_DIRNAME) {
    return ok(undefined);
  }
  const directory = dirname(realpathSync(repoRoot));
  if (dirname(directory) !== realpathSync(preparations)) {
    return ok(undefined);
  }
  return readRecord({ label: "private-term review preparation", path: join(directory, "preparation.json") }).andThen(
    (value) => {
      const preparation = decodePreparation({ value });
      if (preparation === undefined || preparation.preparationId !== basename(directory)) {
        const why = `${directory} holds no preparation this domain wrote`;
        return err(PrivateTermReviewErrors.holdUnusable({ holdId: "<unknown>", why }));
      }
      return ok(preparation);
    },
  );
}

/**
 * A fresh random hold id.
 *
 * @returns `ph-` and twelve hex digits
 */
export function mintHoldId(): string {
  return `ph-${randomBytes(6).toString("hex")}`;
}

/**
 * The retry of a held write: spend one CLEAN receipt for its exact value, or record (or find) its hold.
 *
 * @param home the state home
 * @param draft the write as the gate judged it
 * @param heldBy the visible session attempting it, or null
 * @param nowIso the instant a new hold is stamped with
 * @param newHoldId a fresh hold id
 * @returns released by one receipt, or held under an id with any BROKEN receipts for this value
 */
export function releaseOrHold({
  home,
  draft,
  heldBy,
  nowIso,
  newHoldId,
}: {
  home: string;
  draft: PrivateTermWriteDraft;
  heldBy: VisibleSupervisorSession | null;
  nowIso: string;
  newHoldId: () => string;
}): Result<PrivateTermGateOutcome, PrivateTermReviewError> {
  const mine = readableReceipts({ home }).filter((receipt) => receipt.holdKey === draft.holdKey);
  const broken = mine.filter((receipt) => receipt.verdict === "BROKEN");
  const { spent } = reviewPaths({ home });
  // Only a Codex pass's CLEAN releases: a Claude fallback receipt records no session id, so nothing proves it was
  // written by a session other than the one holding the write. One still counts when it says BROKEN.
  const releasing = mine.filter((receipt) => receipt.reviewer === "codex" && receipt.verdict === "CLEAN");
  if (broken.length === 0) {
    for (const receipt of releasing) {
      const path = join(spent, receipt.receiptId);
      try {
        ensureReviewDirectory({ directory: spent });
        createFileExclusive({ contents: `${nowIso}\n`, mode: 0o600, path });
        return ok({ kind: "released", receiptId: receipt.receiptId });
      } catch (error: unknown) {
        if (!isRecord(error) || error["code"] !== "EEXIST") {
          return err(PrivateTermReviewErrors.ioFailed({ cause: error, path, what: "spending the receipt at" }));
        }
      }
    }
  }
  const existing = holdFor({ holdKey: draft.holdKey, home });
  if (existing !== undefined) {
    return ok({ broken, holdId: existing.holdId, kind: "held" });
  }
  const hold: PrivateTermHold = { ...draft, createdAtIso: nowIso, heldBy, holdId: newHoldId(), schemaVersion: 1 };
  const path = join(reviewPaths({ home }).holds, `${hold.holdId}.json`);
  try {
    createRecord({ label: "private-term hold", path, value: hold });
  } catch (error: unknown) {
    return err(PrivateTermReviewErrors.ioFailed({ cause: error, path, what: "recording the hold at" }));
  }
  return ok({ broken, holdId: hold.holdId, kind: "held" });
}
