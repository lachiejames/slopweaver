/**
 * Where the reviewed-residue list lives: `$home/fresh-cuts/reviewed-residue.jsonl`, owner-only, append-only, in the
 * state home and never in git. One line is one entry ({@link reviewedResidueEntrySchema}); nothing here rewrites or
 * removes a line, so a wrong acceptance is corrected by a reviewer by hand and stays visible in the file's history.
 *
 * The read is fail-closed: one malformed line, one entry of a class other than owner-address, or one duplicated entry
 * id refuses the WHOLE list, because a verify that silently skipped a bad line would subtract less than it says and a
 * verify that guessed would subtract more.
 */
import { createHash } from "node:crypto";
import { closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { readJsonlDescriptorLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { openFileNonBlocking } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { ensureDirectory } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import { type FreshCutError, FreshCutErrors } from "./errors.js";
import { type ReviewedResidueEntry, reviewedResidueEntrySchema } from "./reviewedResidue.js";

/** The list's directory mode: owner-only, since an entry names a file a private term sits in. */
const DIRECTORY_MODE = 0o700;

/** The list's file mode, for the same reason. */
const FILE_MODE = 0o600;

/**
 * The list's path.
 *
 * @param home the state home
 * @returns the absolute path of `reviewed-residue.jsonl`
 */
export function reviewedResiduePath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).freshCuts, "reviewed-residue.jsonl");
}

/**
 * Pure: what one list line is. A blank line is judged by the caller, which alone knows whether it was the final
 * one; anything not UTF-8, not JSON, not an owner-address entry, or repeating an entry id is a problem.
 *
 * @param line the line's decoded text, its newline excluded
 * @param lineNumber the 1-based line number a problem names
 * @param seen every entry id read on an earlier line
 * @param undecodable whether the line's bytes were not UTF-8
 * @returns the entry, the problem, or that the line was blank
 */
function judgeResidueLine({
  line,
  lineNumber,
  seen,
  undecodable,
}: {
  line: string;
  lineNumber: number;
  seen: ReadonlySet<string>;
  undecodable: boolean;
}):
  | { readonly kind: "blank" }
  | { readonly kind: "entry"; readonly entry: ReviewedResidueEntry }
  | { readonly kind: "problem"; readonly problem: string } {
  if (undecodable) {
    return { kind: "problem", problem: `line ${String(lineNumber)} is not UTF-8` };
  }
  if (line === "") {
    return { kind: "blank" };
  }
  let json: unknown;
  try {
    // One entry per line, bounded by the strict schema below.
    json = JSON.parse(line);
  } catch {
    return { kind: "problem", problem: `line ${String(lineNumber)} is not JSON` };
  }
  const parsed = reviewedResidueEntrySchema.safeParse(json);
  if (!parsed.success) {
    return { kind: "problem", problem: `line ${String(lineNumber)} is not an owner-address entry` };
  }
  if (seen.has(parsed.data.entryId)) {
    return { kind: "problem", problem: `line ${String(lineNumber)} repeats an entry id` };
  }
  return { entry: parsed.data, kind: "entry" };
}

/**
 * Open the list without following a symlink. An absent list is not an error: it is the empty list.
 *
 * @param path the list's path
 * @returns the open descriptor, null when no list exists, or why it could not be opened
 */
function openResidueList({ path }: { path: string }): Result<number | null, FreshCutError> {
  try {
    return ok(openFileNonBlocking({ noFollow: true, path }));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok(null);
    }
    return err(
      FreshCutErrors.reviewedResidueUnreadable({ path, why: error instanceof Error ? error.message : String(error) }),
    );
  }
}

/**
 * Read the whole list and the SHA-256 of the exact bytes it was read from. An absent list is an empty one, digest
 * of no bytes; anything else that cannot be read, or any line that is not a valid entry, refuses.
 *
 * @param home the state home
 * @returns every entry in file order and the bytes' digest, or why the list cannot be relied on
 */
export function readReviewedResidue({
  home,
}: {
  home: string;
}): Result<{ readonly entries: readonly ReviewedResidueEntry[]; readonly sha256: string }, FreshCutError> {
  const path = reviewedResiduePath({ home });
  const hash = createHash("sha256");
  const entries: ReviewedResidueEntry[] = [];
  const seen = new Set<string>();
  const problems: string[] = [];
  const blankLineIndexes: number[] = [];
  let lastIndex = -1;
  const opened = openResidueList({ path });
  if (opened.isErr()) {
    return err(opened.error);
  }
  if (opened.value === null) {
    return ok({ entries, sha256: hash.digest("hex") });
  }
  const fd = opened.value;
  try {
    readJsonlDescriptorLines({
      fd,
      onBytes: ({ bytes }) => {
        hash.update(bytes);
      },
      onLine: ({ line, index, undecodable }) => {
        lastIndex = index;
        const judged = judgeResidueLine({ line, lineNumber: index + 1, seen, undecodable });
        if (judged.kind === "blank") {
          blankLineIndexes.push(index);
        } else if (judged.kind === "problem") {
          problems.push(judged.problem);
        } else {
          seen.add(judged.entry.entryId);
          entries.push(judged.entry);
        }
      },
      strictUtf8: true,
    });
  } catch (error) {
    return err(
      FreshCutErrors.reviewedResidueUnreadable({ path, why: error instanceof Error ? error.message : String(error) }),
    );
  } finally {
    closeSync(fd);
  }
  // Only the empty remainder after the final newline is tolerated; every other blank line is a malformed list.
  for (const index of blankLineIndexes) {
    if (index !== lastIndex) {
      problems.push(`line ${String(index + 1)} is blank`);
    }
  }
  if (problems.length > 0) {
    return err(FreshCutErrors.reviewedResidueUnreadable({ path, why: problems.join("; ") }));
  }
  return ok({ entries, sha256: hash.digest("hex") });
}

/**
 * Append one entry, owner-only and durably. Never rewrites a line already there.
 *
 * @param home the state home
 * @param entry the accepted finding
 * @returns the list's path, or why the entry could not be written
 */
export function appendReviewedResidue({
  entry,
  home,
}: {
  entry: ReviewedResidueEntry;
  home: string;
}): Result<string, FreshCutError> {
  const path = reviewedResiduePath({ home });
  try {
    ensureDirectory({ directory: dirname(path), mode: DIRECTORY_MODE });
    appendLines({
      durable: true,
      mode: FILE_MODE,
      path,
      text: JSON.stringify(reviewedResidueEntrySchema.parse(entry)),
    });
    return ok(path);
  } catch (error) {
    return err(
      FreshCutErrors.reviewedResidueWriteFailed({
        cause: error instanceof Error ? error.message : String(error),
        path,
      }),
    );
  }
}
