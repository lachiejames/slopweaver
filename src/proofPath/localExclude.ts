/**
 * Our own hygiene half of "proof output never reaches a pull request": the {@link PROOF_GITIGNORE_LINES} block
 * written into a checkout's `info/exclude`, so a capture a session leaves in ANY repository we spawn into is
 * ignored before it can be staged — without a line of that repository's own `.gitignore` changing.
 *
 * The rule adjusts our own setup, never a team-facing one. `info/exclude` is exactly that surface: it lives in the COMMON git directory, is never committed, and every
 * worktree of the repository reads it, harness-created ones included. Our setup already keeps local-only
 * lines there (acme-admin's `.wc-inuse`), and other writers may add theirs at any moment — so the first write is
 * an APPEND, which cannot lose a line another writer adds meanwhile. Only refreshing a stale block rewrites the
 * file — once per change to the criterion — and it renames only over the exact text it read
 * ({@link replaceIfUnchanged}), retrying when another writer got there first.
 *
 * Git ranks a `.gitignore` above `info/exclude`, so the block's `!**\/src/**\/proof/**` re-inclusions can only
 * undo what the block itself ignored; a path the repository's own `.gitignore` decides is decided there.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { createFileExclusive, ensureDirectory, renameStagedFile } from "#lib/writeAtomic.js";
import { err, ok, type Result } from "../lib/result.js";
import { PROOF_GITIGNORE_LINES } from "./criterion.js";

/** The line that opens the block, so a later run finds and refreshes its own lines and nobody else's. */
export const PROOF_EXCLUDE_BEGIN = "# >>> slopweaver: proof output never reaches a commit (src/proofPath/criterion.ts)";

/** The line that closes the block. */
export const PROOF_EXCLUDE_END = "# <<< slopweaver: proof output";

/** What `info/exclude` needs: text appended after everything there, or the whole file replaced. */
export type ProofExcludeEdit =
  { readonly kind: "append"; readonly text: string } | { readonly kind: "replace"; readonly content: string };

/**
 * Pure: the edit that leaves `info/exclude` carrying exactly one current proof block — an append when there is
 * none, an in-place replacement when it is stale. Every line outside the block is kept as it was.
 *
 * @param content the file's current text, `""` when it does not exist
 * @returns the edit, `undefined` when the block is already current, or the refusal for a block whose closing
 *   line is missing (rewriting from an unterminated opener could delete another writer's lines)
 */
export function proofExcludeEdit({ content }: { content: string }): Result<ProofExcludeEdit | undefined> {
  const lines = content.split("\n");
  const begin = lines.indexOf(PROOF_EXCLUDE_BEGIN);
  const block = [PROOF_EXCLUDE_BEGIN, ...PROOF_GITIGNORE_LINES, PROOF_EXCLUDE_END];
  if (begin === -1) {
    // An unterminated last line is the append's to terminate (`appendLines`); this adds only the blank line.
    const gap = content.trim().length === 0 ? "" : "\n";
    return ok({ kind: "append", text: `${gap}${block.join("\n")}\n` });
  }
  const end = lines.indexOf(PROOF_EXCLUDE_END, begin + 1);
  if (end === -1) {
    return err([`info/exclude opens the slopweaver proof block with no "${PROOF_EXCLUDE_END}" line — fix it by hand`]);
  }
  const current = lines.slice(begin, end + 1);
  if (current.length === block.length && current.every((line, index) => line === block[index])) {
    return ok(undefined);
  }
  return ok({ content: [...lines.slice(0, begin), ...block, ...lines.slice(end + 1)].join("\n"), kind: "replace" });
}

/** How many times a refresh re-reads a file another writer keeps changing before it gives up and says so. */
const REFRESH_ATTEMPTS = 3;

/** The file's text, or `""` when it does not exist yet — absence is the ordinary first-spawn state. */
function readExclude({ path }: { path: string }): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * Replace a file with `next` only if it still reads `expected`: stage the new text beside it, re-read the
 * original, and rename only when nobody changed it meanwhile. The window left is the one between that re-read
 * and the rename, not the whole read-compute-write.
 *
 * @param path the file to replace
 * @param expected the text `next` was computed from
 * @param next the replacement text
 * @returns true when the file was replaced, false when another writer had changed it (nothing written)
 */
export function replaceIfUnchanged({
  path,
  expected,
  next,
}: {
  path: string;
  expected: string;
  next: string;
}): boolean {
  const staged = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  createFileExclusive({ contents: next, path: staged });
  let renamed = false;
  try {
    if (readExclude({ path }) === expected) {
      renameStagedFile({ flushDirectory: true, from: staged, to: path });
      renamed = true;
    }
  } finally {
    if (!renamed) {
      rmSync(staged, { force: true });
    }
  }
  return renamed;
}

/**
 * Make a repository's `info/exclude` carry the current proof block, writing only when it changes.
 *
 * @param commonGitDir the repository's absolute COMMON git directory — shared by every worktree
 * @returns what was done — `"appended"`, `"refreshed"` or `"current"` — or the refusal for a malformed block,
 *   or for a file another writer changed under every refresh attempt
 */
export function ensureProofExclude({
  commonGitDir,
}: {
  commonGitDir: string;
}): Result<"appended" | "refreshed" | "current"> {
  const path = join(commonGitDir, "info", "exclude");
  for (let attempt = 0; attempt < REFRESH_ATTEMPTS; attempt++) {
    const content = readExclude({ path });
    const edit = proofExcludeEdit({ content });
    if (edit.isErr()) {
      return err(edit.error.map((line) => `${path}: ${line}`));
    }
    if (edit.value === undefined) {
      return ok("current");
    }
    if (edit.value.kind === "append") {
      ensureDirectory({ directory: dirname(path) });
      appendLines({ durable: true, mode: 0o644, path, text: edit.value.text });
      return ok("appended");
    }
    if (replaceIfUnchanged({ expected: content, next: edit.value.content, path })) {
      return ok("refreshed");
    }
  }
  return err([`${path}: another writer changed it under ${String(REFRESH_ATTEMPTS)} refresh attempts — rerun`]);
}
