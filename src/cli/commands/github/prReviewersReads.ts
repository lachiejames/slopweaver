/**
 * The GitHub reads `slopweaver github pr reviewers` derives its table from: the pull request's facts, every
 * changed path and the CODEOWNERS on its base branch. Each answers its value or the reason it could not, and
 * prints nothing; `./prReviewersRun.ts` decides what a refusal costs. `session-start`'s code-owner slice
 * (`../sessionStart/codeOwnerSliceRead.ts`) reads through the same functions, so the two never disagree on a file list.
 *
 * Split from that shell along the read seam, so the shell stays the order of the steps and this the REST shapes.
 */
import type { GithubReadRest } from "../../../live/github/read.js";
import { isNotFound } from "../../../live/github/reviewRules.js";
import type { CodeOwnerChangedFile } from "../../../review/codeOwnerSlice.js";
import { changedFilesOf, comparedFilesOf } from "./prChangedFiles.js";
import {
  changedPathsOf,
  codeownersErrorLinesOf,
  comparedPathsOf,
  contentPathOf,
  contentTextOf,
  type PrReviewersFacts,
  prReviewersFactsOf,
} from "./prReviewersCore.js";

/** Where GitHub looks for CODEOWNERS, in the order it looks. */
const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"] as const;

/** One page of the file list; GitHub's own maximum. */
const FILES_PAGE = 100;

/** GitHub lists at most 3000 files of a pull request, so this many pages is every file it will ever list. */
const FILES_PAGES_MAX = 30;

/** GitHub's compare lists at most this many files, all on its first page. */
export const COMPARE_FILES_MAX = 300;

/** The pull request every read addresses, and the read seam they go through. */
export interface PrAt {
  readonly rest: GithubReadRest;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * One read of the pull request's facts.
 *
 * @param url the pull request's address, named when the response is not a pull request
 * @returns the facts, or the reason the read did not give them
 */
export async function factsAt({ at, url }: { at: PrAt; url: string }): Promise<PrReviewersFacts | string> {
  const { number, owner, repo, rest } = at;
  const read = await rest({
    params: { owner, pull_number: number, repo },
    route: "GET /repos/{owner}/{repo}/pulls/{pull_number}",
  });
  if (read.isErr()) {
    return read.error.message;
  }
  const facts = prReviewersFactsOf({ response: read.value });
  if (facts === undefined) {
    return `${url} did not read as a pull request`;
  }
  return facts;
}

/**
 * Whether a re-read pull request is not the one the table was derived from: its head, base branch or base commit
 * moved, its changed-file count moved, it opened or closed, or it did not read at all.
 *
 * @param first the facts the table was derived from
 * @param now the re-read, or the reason it failed
 * @returns true when nothing derived from `first` may be printed
 */
export function movedSince({ first, now }: { first: PrReviewersFacts; now: PrReviewersFacts | string }): boolean {
  if (typeof now === "string") {
    return true;
  }
  const commits = now.headSha !== first.headSha || now.base !== first.base || now.baseSha !== first.baseSha;
  return commits || now.changedFiles !== first.changedFiles || now.open !== first.open;
}

/** Reads one response into the list it carries, or undefined when it carries none — paths alone, or files with counts. */
type ListOf<T> = (args: { response: unknown }) => readonly T[] | undefined;

/** The compare of the two commits the pull request reported, so the list is PINNED to them. */
async function comparedList<T>({
  at,
  facts,
  parse,
}: {
  at: PrAt;
  facts: PrReviewersFacts;
  parse: ListOf<T>;
}): Promise<readonly T[] | string> {
  const { owner, repo, rest } = at;
  const read = await rest({
    params: { basehead: `${facts.baseSha}...${facts.headSha}`, owner, page: 1, per_page: 1, repo },
    route: "GET /repos/{owner}/{repo}/compare/{basehead}",
  });
  if (read.isErr()) {
    return read.error.message;
  }
  const listed = parse({ response: read.value });
  if (listed === undefined) {
    return `the compare of ${facts.headSha.slice(0, 9)} is not a file list`;
  }
  return listed;
}

/** Every page of the pull request's own file list, which runs to 3000 files and is not pinned to a commit. */
async function listedList<T>({ at, parse }: { at: PrAt; parse: ListOf<T> }): Promise<readonly T[] | string> {
  const { number, owner, repo, rest } = at;
  const entries: T[] = [];
  for (let page = 1; page <= FILES_PAGES_MAX; page += 1) {
    const read = await rest({
      params: { owner, page, per_page: FILES_PAGE, pull_number: number, repo },
      route: "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
    });
    if (read.isErr()) {
      return read.error.message;
    }
    const listed = parse({ response: read.value });
    if (listed === undefined) {
      return `page ${String(page)} of the file list is not a file list`;
    }
    entries.push(...listed);
    if (listed.length < FILES_PAGE) {
      break;
    }
  }
  return entries;
}

/**
 * Every changed entry, or the reason the list is not whole — the one place the compare-or-page choice is made.
 *
 * Up to 300 files it is read from the compare of the two commits the pull request reported, so the list is
 * PINNED to them and a push between reads cannot swap in another head's files. Past that, compare stops and the
 * pull request's own list (3000 files, not pinned) is read, re-checked by the head re-read after it.
 */
async function changedList<T>({
  at,
  facts,
  compared,
  listed,
  pathOf,
}: {
  at: PrAt;
  facts: PrReviewersFacts;
  compared: ListOf<T>;
  listed: ListOf<T>;
  pathOf: (entry: T) => string;
}): Promise<readonly T[] | string> {
  const entries =
    facts.changedFiles <= COMPARE_FILES_MAX
      ? await comparedList({ at, facts, parse: compared })
      : await listedList({ at, parse: listed });
  if (typeof entries === "string") {
    return entries;
  }
  // A partial list would put a narrow owner's files under everything else, so it is refused, never derived.
  if (entries.length !== facts.changedFiles) {
    return `GitHub listed ${String(entries.length)} of the ${String(facts.changedFiles)} changed files, and a table over part of a diff misleads every row`;
  }
  // A repeated path padding the list to the right count still leaves a file out, so the paths must be distinct too.
  const distinct = new Set(entries.map(pathOf)).size;
  if (distinct !== entries.length) {
    return `GitHub listed ${String(distinct)} distinct paths in ${String(entries.length)} entries for ${String(facts.changedFiles)} changed files, so one file is repeated and another is missing`;
  }
  return entries;
}

/**
 * Every changed path, or the reason the list is not whole.
 *
 * @param facts the pull request's first read, whose commits and file count the list is held to
 * @returns every changed path, or why the list is not whole
 */
export async function changedPaths({
  at,
  facts,
}: {
  at: PrAt;
  facts: PrReviewersFacts;
}): Promise<readonly string[] | string> {
  return changedList({ at, compared: comparedPathsOf, facts, listed: changedPathsOf, pathOf: (path) => path });
}

/**
 * Every changed file with its line counts, or the reason the list is not whole — the same compare-or-page read
 * and the same whole-list refusal as {@link changedPaths}.
 *
 * @param facts the pull request's first read, whose commits and file count the list is held to
 * @returns every changed file, or why the list is not whole
 */
export async function changedFiles({
  at,
  facts,
}: {
  at: PrAt;
  facts: PrReviewersFacts;
}): Promise<readonly CodeOwnerChangedFile[] | string> {
  return changedList({ at, compared: comparedFilesOf, facts, listed: changedFilesOf, pathOf: (file) => file.path });
}

/**
 * The CODEOWNERS file GitHub applies on the base branch.
 *
 * @param ref the base branch it is read at
 * @returns its path and text, undefined when there is none, or the reason it could not be read
 */
export async function codeownersAt({
  at,
  ref,
}: {
  at: PrAt;
  ref: string;
}): Promise<{ path: string; text: string } | undefined | string> {
  for (const path of CODEOWNERS_PATHS) {
    const candidate = await codeownersCandidateAt({ at, path, ref });
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * One CODEOWNERS location on the base branch.
 *
 * @param path the location GitHub would look at
 * @param ref the base branch it is read at
 * @returns its path and text, undefined when nothing is there, or the reason it could not be read
 */
async function codeownersCandidateAt({
  at,
  path,
  ref,
}: {
  at: PrAt;
  path: string;
  ref: string;
}): Promise<{ path: string; text: string } | undefined | string> {
  const { owner, repo, rest } = at;
  const read = await rest({ params: { owner, path, ref, repo }, route: "GET /repos/{owner}/{repo}/contents/{path}" });
  if (read.isErr()) {
    return isNotFound({ error: read.error }) ? undefined : read.error.message;
  }
  const text = contentTextOf({ response: read.value });
  if (text === undefined) {
    return `${path} on ${ref} is not a file`;
  }
  // A symlink reads as its target's text, and whether GitHub applies a linked CODEOWNERS is not documented, so a
  // file answered from another path is refused rather than derived from.
  const answered = contentPathOf({ response: read.value });
  if (answered !== undefined && answered !== path) {
    return `${path} on ${ref} is a link to ${answered}, and whether GitHub applies a linked CODEOWNERS is unknown`;
  }
  return { path, text };
}

/**
 * The CODEOWNERS lines GitHub reports an error on — an owner it cannot resolve or who lacks write access, a line it
 * cannot read — which it partly or wholly ignores, so a file such a line decides is never derived from it.
 *
 * @param ref the base branch the file was read at
 * @param path the CODEOWNERS file in use, since GitHub reports on the one it applies
 * @returns the 1-based errored lines, or the reason they could not be read
 */
export async function codeownersErrorLines({
  at,
  ref,
  path,
}: {
  at: PrAt;
  ref: string;
  path: string;
}): Promise<readonly number[] | string> {
  const read = await at.rest({
    params: { owner: at.owner, ref, repo: at.repo },
    route: "GET /repos/{owner}/{repo}/codeowners/errors",
  });
  if (read.isErr()) {
    return read.error.message;
  }
  const lines = codeownersErrorLinesOf({ path, response: read.value });
  if (lines === undefined) {
    return "GitHub's CODEOWNERS errors did not read as a list";
  }
  return lines;
}
