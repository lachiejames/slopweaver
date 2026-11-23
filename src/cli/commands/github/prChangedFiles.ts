/**
 * The pull request's changed files WITH their line counts, read off the two REST responses that carry them. The
 * code-owner slice is built over these, so a reader here refuses a whole page rather than drop one entry: a slice
 * over a list missing a file could hide the one file that is the owner's. The path-only readers stay in `./prReviewersCore.ts`.
 */
import { isRecord } from "#lib/parsers.js";
import type { CodeOwnerChangedFile } from "../../../review/codeOwnerSlice.js";

/**
 * Read one page of `GET /repos/{owner}/{repo}/pulls/{n}/files` into its files WITH their line counts.
 *
 * Stricter than `changedPathsOf`: an entry missing either count, or with an empty path, refuses the whole page, because a slice
 * built over a list it silently dropped an entry from could hide the one file that is the owner's.
 *
 * @param response the raw Octokit response
 * @returns the page's new-side paths, a rename's base-side path, and their additions and deletions, or undefined when
 *   any entry does not read
 */
export function changedFilesOf({ response }: { response: unknown }): readonly CodeOwnerChangedFile[] | undefined {
  const data = isRecord(response) ? response["data"] : undefined;
  if (!Array.isArray(data)) {
    return undefined;
  }
  const files: CodeOwnerChangedFile[] = [];
  for (const entry of data as readonly unknown[]) {
    const file = changedFileOf({ entry });
    if (file === undefined) {
      return undefined;
    }
    files.push(file);
  }
  return files;
}

/** One `pulls/{n}/files` entry as a changed file, or undefined when any field it needs does not read. */
function changedFileOf({ entry }: { entry: unknown }): CodeOwnerChangedFile | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  const path = entry["filename"];
  const additions = entry["additions"];
  const deletions = entry["deletions"];
  const countsRead = isLineCount(additions) && isLineCount(deletions);
  if (typeof path !== "string" || path === "" || !countsRead) {
    return undefined;
  }
  // A rename carries its base-side path, which a slice matches too; one present but unreadable refuses the page.
  const previousPath = entry["previous_filename"];
  if (previousPath === undefined) {
    return { additions, deletions, path };
  }
  return typeof previousPath === "string" && previousPath !== ""
    ? { additions, deletions, path, previousPath }
    : undefined;
}

/** Whether a value is a line count: a whole number from zero up. */
function isLineCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Read `GET /repos/{owner}/{repo}/compare/{basehead}` into its changed files with their line counts.
 *
 * @param response the raw Octokit response
 * @returns the new-side files, or undefined when the response carries no readable file list
 */
export function comparedFilesOf({ response }: { response: unknown }): readonly CodeOwnerChangedFile[] | undefined {
  const data = isRecord(response) ? response["data"] : undefined;
  return isRecord(data) ? changedFilesOf({ response: { data: data["files"] } }) : undefined;
}
