/**
 * THE PRIVATE-WORDS REVIEW, the packet a fresh reviewer reads (`./types.ts`). Its BASE commit holds what the write
 * is judged against: a README, each matched term's class, meaning and allowed places (`terms/<term-id>.md`, never
 * its pattern) and where the write goes (`write/destination.txt`). Its HEAD commit adds the write itself: every
 * match numbered in its context (`write/contexts.md`) and every string it sends, whole (`write/contents/NN.txt`).
 * So `codex review --repo <packet> --base <base>` judges exactly the write, as a text diff against its meanings.
 *
 * ## Why the meanings stay at the BASE, outside the diff a reviewer reads
 *
 * A review's packet is the base..head diff and nothing else: Codex's `review-packet.md` in pass scratch
 * (`../../codex/artifactStore.ts`) and the visible-Claude fallback's temp packet (`../../codex/fallbackPacket.ts`)
 * both carry exactly that text. The page review moved its inputs into the head for that reason
 * (`../../pages/reviewRepo.ts`). Here the same move would copy each term's meaning and the destination into both of
 * those files, where neither goes today. So they stay at the base, which the reviewer still reads from the frozen
 * repository the prompt names, and the property opens by requiring that read (`./types.ts`).
 *
 * Each packet is its own directory under `preparations/`, owner-only, refused when its fresh id is already there,
 * every file in it created exclusively, and removed whole on any failure, so a half-built one never sits where `review-record` could resolve it. Every git call goes through
 * `../../codex/gitRun.ts`, the runner whose configuration the review's own diff digest was taken under.
 */
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { createFileExclusive, ensureDirectory, removeEntry } from "#lib/writeAtomic.js";

import { diffSha256, gitCommitDiffCommand } from "../../codex/diff.js";
import { runGitChecked } from "../../codex/gitRun.js";
import type { VisibleSupervisorSession } from "../../supervisor/session.js";
import { type PrivateTermReviewError, PrivateTermReviewErrors } from "./errors.js";
import { contextsMarkdown, destinationText, termMarkdown } from "./hold.js";
import { ensureReviewDirectory, PACKET_REPO_DIRNAME, preparationsDirectory, writePreparation } from "./store.js";
import { PRIVATE_TERM_REVIEW_PACKET_README, type PrivateTermHold, type PrivateTermReviewPreparation } from "./types.js";

/** A fixed identity, no signing and no hooks, so a user's git setup can neither block a commit nor run code. */
const COMMIT_CONFIG: readonly string[] = [
  "-c",
  "user.name=slopweaver private-words review",
  "-c",
  "user.email=private-words-review@slopweaver.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

/**
 * Committed first, so `git add` neither converts line endings nor runs a clean filter on any packet byte. `diff` is
 * SET so the head's files diff as text: a user's global attributes file marking `*.md -diff` would otherwise turn
 * the contexts into `Binary files … differ`, and a repository's own `.gitattributes` outranks that file.
 */
const GITATTRIBUTES = "* -text -filter diff\n";

/**
 * The contexts file, at the head commit: the one file the binding re-reads.
 *
 * @internal
 */
export const PACKET_CONTEXTS_PATH = "write/contexts.md";

/** What the shell read back from a packet repository at a review's commits. */
export interface PrivateTermPacketFacts {
  /** The digest of the commit-to-commit diff, in the review's own form. */
  readonly diffSha256: string;
  /** sha256 of `write/contexts.md` at the head commit. */
  readonly contextsSha256: string;
}

/**
 * sha256 of a string's UTF-8 bytes, lowercase hex.
 *
 * @returns the digest
 */
export function packetTextSha256({ text }: { text: string }): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The packet file one content is committed under, numbered from one. */
function contentFile({ index }: { index: number }): string {
  return `write/contents/${String(index + 1).padStart(2, "0")}.txt`;
}

/** Write the base tree: orientation, the matched terms' meanings and the destination. */
function writeBase({ repo, hold }: { repo: string; hold: PrivateTermHold }): void {
  ensureDirectory({ directory: join(repo, "terms"), mode: 0o700 });
  ensureDirectory({ directory: join(repo, "write"), mode: 0o700 });
  packetFile({ contents: GITATTRIBUTES, path: join(repo, ".gitattributes") });
  packetFile({ contents: PRIVATE_TERM_REVIEW_PACKET_README, path: join(repo, "README.md") });
  for (const term of hold.terms) {
    packetFile({ contents: termMarkdown({ term }), path: join(repo, "terms", `${term.termId}.md`) });
  }
  packetFile({ contents: destinationText({ draft: hold }), path: join(repo, "write", "destination.txt") });
}

/**
 * The first packet file, base or head, that is not text, by its packet path, or `undefined` when none. A head file's
 * NUL would reach the diff raw under `GITATTRIBUTES`, and a base file is one the reviewer is told to open as text, so
 * any NUL is refused, wherever it sits. Names a path only, never the text.
 */
function firstNonTextPath({ hold }: { hold: PrivateTermHold }): string | undefined {
  const term = hold.terms.find((one) => termMarkdown({ term: one }).includes("\0"));
  if (term !== undefined) {
    return `terms/${term.termId}.md`;
  }
  if (destinationText({ draft: hold }).includes("\0")) {
    return "write/destination.txt";
  }
  if (contextsMarkdown({ draft: hold }).includes("\0")) {
    return PACKET_CONTEXTS_PATH;
  }
  const index = hold.contents.findIndex((content) => `${content.locus}\n\n${content.text}`.includes("\0"));
  return index === -1 ? undefined : contentFile({ index });
}

/** Write the head tree: the write under review. */
function writeHead({ repo, hold }: { repo: string; hold: PrivateTermHold }): void {
  ensureDirectory({ directory: join(repo, "write", "contents"), mode: 0o700 });
  packetFile({ contents: contextsMarkdown({ draft: hold }), path: join(repo, PACKET_CONTEXTS_PATH) });
  hold.contents.forEach((content, index) => {
    packetFile({ contents: `${content.locus}\n\n${content.text}`, path: join(repo, contentFile({ index })) });
  });
}

/** Create one packet file, owner-only; a packet is built fresh, so a file already there is a failure. */
function packetFile({ contents, path }: { contents: string; path: string }): void {
  createFileExclusive({ contents, mode: 0o600, path });
}

/** Commit the base, then the head, and answer both commits and the review diff's size. */
function commitPacket({ repo, hold }: { repo: string; hold: PrivateTermHold }): {
  readonly baseSha: string;
  readonly headSha: string;
  readonly diffBytes: number;
} {
  const git = ({ args }: { args: readonly string[] }): string =>
    runGitChecked({ args, cwd: repo, label: `git ${args.find((arg) => !arg.startsWith("-"))!}` });
  writeBase({ hold, repo });
  // `--template=`: a user's init template could install `.git/info/attributes`, which outranks `GITATTRIBUTES`.
  git({ args: ["init", "--quiet", "--template=", "--initial-branch=main"] });
  // `--force`: a user's global excludes file must never drop a packet file from the commit a review is bound to.
  git({ args: ["add", "--force", "--all"] });
  git({ args: [...COMMIT_CONFIG, "commit", "--quiet", "--no-verify", "-m", "what the write is judged against"] });
  const baseSha = git({ args: ["rev-parse", "HEAD"] }).trim();
  writeHead({ hold, repo });
  git({ args: ["add", "--force", "--", "write"] });
  git({ args: [...COMMIT_CONFIG, "commit", "--quiet", "--no-verify", "-m", "the held write"] });
  const headSha = git({ args: ["rev-parse", "HEAD"] }).trim();
  const diff = git({ args: gitCommitDiffCommand({ commit: headSha, mergeBase: baseSha }).args });
  return { baseSha, diffBytes: Buffer.byteLength(diff, "utf8"), headSha };
}

/**
 * Build one packet for a hold: the repository, its two commits, and the record of what was committed.
 *
 * @param home the state home
 * @param hold the held write, read back and re-hashed
 * @param preparationId a fresh id naming this packet's directory
 * @param createdAtIso when it was prepared
 * @param preparedBy the visible session preparing it, or null when none can be named
 * @returns the preparation, the repository root a reviewer is pointed at, and the size of the diff it will read
 */
export function preparePrivateTermPacket({
  home,
  hold,
  preparationId,
  createdAtIso,
  preparedBy,
}: {
  home: string;
  hold: PrivateTermHold;
  preparationId: string;
  createdAtIso: string;
  preparedBy: VisibleSupervisorSession | null;
}): Result<
  { readonly preparation: PrivateTermReviewPreparation; readonly repoRoot: string; readonly diffBytes: number },
  PrivateTermReviewError
> {
  const binary = firstNonTextPath({ hold });
  if (binary !== undefined) {
    return err(PrivateTermReviewErrors.fileNotText({ path: binary }));
  }
  const preparations = preparationsDirectory({ home });
  const directory = join(preparations, preparationId);
  if (existsSync(directory)) {
    return err(PrivateTermReviewErrors.ioFailed({ cause: "it already exists", path: directory, what: "preparing" }));
  }
  const repo = join(directory, PACKET_REPO_DIRNAME);
  try {
    ensureReviewDirectory({ directory: preparations });
    ensureDirectory({ directory: repo, mode: 0o700 });
    const { baseSha, diffBytes, headSha } = commitPacket({ hold, repo });
    const preparation: PrivateTermReviewPreparation = {
      baseSha,
      createdAtIso,
      headSha,
      holdId: hold.holdId,
      holdKey: hold.holdKey,
      preparationId,
      preparedBy,
      schemaVersion: 1,
    };
    writePreparation({ directory, preparation });
    return ok({ diffBytes, preparation, repoRoot: realpathSync(repo) });
  } catch (error: unknown) {
    removeEntry({ path: directory });
    return err(
      PrivateTermReviewErrors.ioFailed({ cause: errorMessage({ error }), path: directory, what: "preparing" }),
    );
  }
}

/**
 * Read back, from a packet repository, what a review's binding compares.
 *
 * @param repoRoot the packet repository
 * @param baseSha the review's base commit
 * @param headSha the review's head commit
 * @returns the diff digest and the contexts digest, or why they could not be read
 */
export function privateTermPacketFacts({
  repoRoot,
  baseSha,
  headSha,
}: {
  repoRoot: string;
  baseSha: string;
  headSha: string;
}): Result<PrivateTermPacketFacts, PrivateTermReviewError> {
  const git = ({ args }: { args: readonly string[] }): string =>
    runGitChecked({ args, cwd: repoRoot, label: `git ${args[0]!}` });
  try {
    const diff = git({ args: gitCommitDiffCommand({ commit: headSha, mergeBase: baseSha }).args });
    const contexts = git({ args: ["cat-file", "blob", `${headSha}:${PACKET_CONTEXTS_PATH}`] });
    return ok({ contextsSha256: packetTextSha256({ text: contexts }), diffSha256: diffSha256({ diff }) });
  } catch (error: unknown) {
    return err(PrivateTermReviewErrors.ioFailed({ cause: errorMessage({ error }), path: repoRoot, what: "reading" }));
  }
}
