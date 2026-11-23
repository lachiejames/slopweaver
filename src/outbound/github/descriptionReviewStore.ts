/**
 * Where description reviews live — the effectful edge of `./descriptionReview.ts`.
 *
 * Under `$SLOPWEAVER_HOME/pr-description-reviews/`:
 *
 * - `preparations/<id>/` — one immutable directory per `github pr review-prepare`: `preparation.json` and
 *   `repo/`, the packet repository a fresh reviewer is pointed at (`./descriptionReviewPacket.ts` builds it);
 * - `receipts/<manifest sha256>.json` — one receipt per distinct packet, created exclusively, so a second pass on
 *   unchanged bytes loses the create and is refused by name rather than overwriting the first verdict.
 *
 * Nothing here is committed to the pull request's branch: a receipt file on the branch would change the very
 * change set its digest binds. The check lives in the write verb, which reads this store.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { createFileExclusive, ensureDirectory } from "#lib/writeAtomic.js";

import { diffSha256, gitCommitDiffCommand } from "../../codex/diff.js";
import { runGitChecked } from "../../codex/gitRun.js";
import { stateHomePaths } from "../../stateHome.js";
import type { SupervisorSession } from "../../supervisor/session.js";
import { manifestSha256Of, type PacketCommitFacts, textSha256 } from "./descriptionReview.js";
import { type DescriptionReviewError, DescriptionReviewErrors } from "./descriptionReviewErrors.js";
import {
  DESCRIPTION_RULE_FILES,
  type DescriptionReviewManifest,
  type DescriptionReviewPreparation,
  type DescriptionReviewReceipt,
} from "./descriptionReviewTypes.js";

/** The file inside a preparation directory recording what was committed. */
const PREPARATION_FILENAME = "preparation.json";

/** The packet repository inside a preparation directory — the root a review's record names. */
export const PACKET_REPO_DIRNAME = "repo";

/** The title and body inside the packet repository, at its head commit. */
export const PACKET_TITLE_PATH = "description/title.txt";
export const PACKET_BODY_PATH = "description/body.md";

/** The comments the write posts, inside the packet repository at its head commit. */
export const PACKET_COMMENTS_PATH = "description/comments.json";

/** The comments already on the pull request, inside the packet repository at its base commit. */
export const PACKET_EXISTING_COMMENTS_PATH = "evidence/pull-request-comments.json";

/**
 * The directory every packet repository is prepared under.
 *
 * @returns `$home/pr-description-reviews/preparations`
 */
export function preparationsDirectory({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).prDescriptionReviews, "preparations");
}

/**
 * The directory receipts are stored in, one file per manifest digest.
 *
 * @returns `$home/pr-description-reviews/receipts`
 */
function receiptsDirectory({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).prDescriptionReviews, "receipts");
}

/**
 * The one file a packet's receipt is stored in.
 *
 * @returns `$home/pr-description-reviews/receipts/<manifestSha256>.json`
 */
function receiptPath({ home, manifestSha256 }: { home: string; manifestSha256: string }): string {
  return join(receiptsDirectory({ home }), `${manifestSha256}.json`);
}

/**
 * The tree the written rules are read from in production: this build's own, wherever it is installed.
 *
 * @returns the absolute root of the running build
 */
export function installedRulesRoot(): string {
  return installedTreeRoot({ importMetaUrl: import.meta.url });
}

/**
 * Read every written rule a description is judged against, by its path inside a tree.
 *
 * @param rulesRoot the tree to read them from — {@link installedRulesRoot} in production
 * @returns each rule's path and exact contents, in {@link DESCRIPTION_RULE_FILES} order, or the first unreadable one
 */
export function readDescriptionRules({
  rulesRoot,
}: {
  rulesRoot: string;
}): Result<readonly { readonly path: string; readonly contents: string }[], DescriptionReviewError> {
  const files: { path: string; contents: string }[] = [];
  for (const path of DESCRIPTION_RULE_FILES) {
    try {
      files.push({ contents: readFileSync(join(rulesRoot, path), "utf8"), path });
    } catch (error: unknown) {
      return err(DescriptionReviewErrors.rulesUnreadable({ detail: errorMessage({ error }), path }));
    }
  }
  return ok(files);
}

/** Whether a value is a recorded session or the explicit null this domain writes for none. */
function isSessionOrNull(value: unknown): value is SupervisorSession | null {
  if (value === null) {
    return true;
  }
  return (
    isRecord(value) &&
    (value["host"] === "claude-code" || value["host"] === "codex" || value["host"] === "explicit") &&
    typeof value["id"] === "string"
  );
}

/** Whether a parsed value is the manifest shape this domain writes. */
function isManifest(value: unknown): value is DescriptionReviewManifest {
  return (
    isRecord(value) &&
    value["schemaVersion"] === 2 &&
    [
      "repository",
      "baseBranch",
      "titleSha256",
      "bodySha256",
      "commentsSha256",
      "existingCommentsSha256",
      "changeDigest",
      "rulesSha256",
    ].every((key) => typeof value[key] === "string") &&
    Array.isArray(value["images"]) &&
    value["images"].every(
      (image: unknown) =>
        isRecord(image) && ["url", "sha256", "proves", "receiptId"].every((key) => typeof image[key] === "string"),
    )
  );
}

/** Whether a parsed value is the preparation shape this domain writes. */
function isPreparation(value: unknown): value is DescriptionReviewPreparation {
  return (
    isRecord(value) &&
    value["schemaVersion"] === 2 &&
    ["preparationId", "createdAtIso", "manifestSha256", "baseSha", "headSha"].every(
      (key) => typeof value[key] === "string",
    ) &&
    isManifest(value["manifest"]) &&
    isSessionOrNull(value["preparedBy"])
  );
}

/**
 * Whether a parsed value is the receipt shape this domain writes now. A receipt from before comments were bound
 * (schema 1) is not: it never certified the comments, so it is skipped when listed and refused when read.
 *
 * @returns true only for a schema-2 receipt
 */
export function isDescriptionReviewReceipt(value: unknown): value is DescriptionReviewReceipt {
  return (
    isRecord(value) &&
    value["schemaVersion"] === 2 &&
    ["receiptId", "preparationId", "manifestSha256", "reviewId", "summary", "recordedAtIso"].every(
      (key) => typeof value[key] === "string",
    ) &&
    (value["reviewer"] === "codex" || value["reviewer"] === "claude-fallback") &&
    (value["verdict"] === "CLEAN" || value["verdict"] === "BROKEN") &&
    isManifest(value["manifest"]) &&
    isSessionOrNull(value["preparedBy"]) &&
    isSessionOrNull(value["recordedBy"])
  );
}

/**
 * Write a preparation record into its directory.
 *
 * @param directory the preparation's own directory
 * @param preparation the record
 */
export function writePreparationRecord({
  directory,
  preparation,
}: {
  directory: string;
  preparation: DescriptionReviewPreparation;
}): void {
  createFileExclusive({
    contents: `${safeJsonStringify({ label: "description review preparation", space: 2, value: preparation })}\n`,
    path: join(directory, PREPARATION_FILENAME),
  });
}

/**
 * Resolve the preparation a review's recorded repository root names, when it is a description-review packet.
 *
 * @param home the state home
 * @param repoRoot the repository root the review's record names
 * @returns the preparation; `undefined` when the root is not a packet repository under this home; an error when it
 *   is one whose record cannot be read, is not the shape this domain wrote, or whose manifest digest does not match
 */
export function readPreparationAtRoot({
  home,
  repoRoot,
}: {
  home: string;
  repoRoot: string;
}): Result<DescriptionReviewPreparation | undefined, DescriptionReviewError> {
  const preparations = preparationsDirectory({ home });
  if (!existsSync(preparations) || !existsSync(repoRoot) || basename(repoRoot) !== PACKET_REPO_DIRNAME) {
    return ok(undefined);
  }
  const directory = dirname(realpathSync(repoRoot));
  if (dirname(directory) !== realpathSync(preparations)) {
    return ok(undefined);
  }
  const path = join(directory, PREPARATION_FILENAME);
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "description review preparation", text: readFileSync(path, "utf8") });
  } catch (error: unknown) {
    return err(
      DescriptionReviewErrors.preparationFailed({ detail: `${path} cannot be read: ${errorMessage({ error })}` }),
    );
  }
  if (
    !isPreparation(parsed) ||
    parsed.preparationId !== basename(directory) ||
    parsed.manifestSha256 !== manifestSha256Of({ manifest: parsed.manifest })
  ) {
    return err(DescriptionReviewErrors.preparationFailed({ detail: `${path} is not the record this verb writes` }));
  }
  return ok(parsed);
}

/**
 * Read back, from a packet repository, the facts a cited review's commits must reproduce.
 *
 * @param repoRoot the packet repository
 * @param baseSha the review's recorded base commit
 * @param headSha the review's recorded head commit
 * @returns the diff digest and the title, body and comment digests at the head, or why they could not be read
 */
export function packetCommitFacts({
  repoRoot,
  baseSha,
  headSha,
}: {
  repoRoot: string;
  baseSha: string;
  headSha: string;
}): Result<PacketCommitFacts, DescriptionReviewError> {
  const git = ({ args }: { args: readonly string[] }): string =>
    runGitChecked({ args, cwd: repoRoot, label: `git ${args[0]!}` });
  try {
    const diff = git({ args: gitCommitDiffCommand({ commit: headSha, mergeBase: baseSha }).args });
    const title = git({ args: ["cat-file", "blob", `${headSha}:${PACKET_TITLE_PATH}`] });
    const body = git({ args: ["cat-file", "blob", `${headSha}:${PACKET_BODY_PATH}`] });
    const comments = git({ args: ["cat-file", "blob", `${headSha}:${PACKET_COMMENTS_PATH}`] });
    return ok({
      bodySha256: textSha256({ text: body }),
      commentsSha256: textSha256({ text: comments }),
      diffSha256: diffSha256({ diff }),
      titleSha256: textSha256({ text: title }),
    });
  } catch (error: unknown) {
    return err(
      DescriptionReviewErrors.preparationFailed({ detail: `reading ${repoRoot}: ${errorMessage({ error })}` }),
    );
  }
}

/**
 * Read the receipt stored under one manifest digest.
 *
 * @param home the state home
 * @param manifestSha256 the digest of the manifest a write would send
 * @returns the receipt; `undefined` when none is stored; an error when the file is there but is not a receipt
 *   for that digest, so a corrupt receipt is never mistaken for an absent one
 */
export function readReceipt({
  home,
  manifestSha256,
}: {
  home: string;
  manifestSha256: string;
}): Result<DescriptionReviewReceipt | undefined, DescriptionReviewError> {
  const path = receiptPath({ home, manifestSha256 });
  if (!existsSync(path)) {
    return ok(undefined);
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "description review receipt", text: readFileSync(path, "utf8") });
  } catch (error: unknown) {
    return err(DescriptionReviewErrors.receiptUnreadable({ detail: errorMessage({ error }), path }));
  }
  if (!isDescriptionReviewReceipt(parsed)) {
    return err(DescriptionReviewErrors.receiptUnreadable({ detail: "not the receipt shape this verb writes", path }));
  }
  if (parsed.manifestSha256 !== manifestSha256 || manifestSha256Of({ manifest: parsed.manifest }) !== manifestSha256) {
    return err(
      DescriptionReviewErrors.receiptUnreadable({ detail: "its manifest does not hash to its file name", path }),
    );
  }
  return ok(parsed);
}

/**
 * Every receipt that reads, for explaining a refusal. Advisory by design: a file that does not read is skipped
 * here, because the receipt a write actually depends on is read strictly by {@link readReceipt}.
 *
 * @returns the readable receipts, in no particular order
 */
export function listReadableReceipts({ home }: { home: string }): readonly DescriptionReviewReceipt[] {
  const directory = receiptsDirectory({ home });
  if (!existsSync(directory)) {
    return [];
  }
  const receipts: DescriptionReviewReceipt[] = [];
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const read = readReceipt({ home, manifestSha256: name.slice(0, -".json".length) });
    if (read.isOk() && read.value !== undefined) {
      receipts.push(read.value);
    }
  }
  return receipts;
}

/**
 * Store a receipt under its manifest digest, exactly once.
 *
 * @param home the state home
 * @param receipt the receipt to store
 * @returns the path written; ALREADY_REVIEWED naming the stored receipt when this packet already has one
 */
export function writeReceiptOnce({
  home,
  receipt,
}: {
  home: string;
  receipt: DescriptionReviewReceipt;
}): Result<string, DescriptionReviewError> {
  const path = receiptPath({ home, manifestSha256: receipt.manifestSha256 });
  try {
    ensureDirectory({ directory: receiptsDirectory({ home }) });
    createFileExclusive({
      contents: `${safeJsonStringify({ label: "description review receipt", space: 2, value: receipt })}\n`,
      path,
    });
    return ok(path);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "EEXIST") {
      return readReceipt({ home, manifestSha256: receipt.manifestSha256 }).andThen((stored) =>
        err(
          stored === undefined
            ? DescriptionReviewErrors.receiptWriteFailed({ detail: "it appeared and vanished during the write", path })
            : DescriptionReviewErrors.alreadyReviewed({
                manifestSha256: receipt.manifestSha256,
                receiptId: stored.receiptId,
                verdict: stored.verdict,
              }),
        ),
      );
    }
    return err(DescriptionReviewErrors.receiptWriteFailed({ detail: errorMessage({ error }), path }));
  }
}
