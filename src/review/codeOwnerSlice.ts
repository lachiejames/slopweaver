/**
 * How much of a pull request is the OWNER's as a code owner — the files whose deciding CODEOWNERS line names the
 * owner's own login, and the lines they change — so a review ask on a thirty-file pull request reads as the one
 * file it is for the owner. A reader tagged on a large pull request needs to know up front that only one file, one
 * line in it, is theirs to review.
 *
 * ## The criterion, and the one thing it deliberately does not count
 *
 * A changed file is the owner's when the LAST CODEOWNERS line matching it (the one GitHub applies) names
 * `@<owner login>`, compared case-insensitively. A line naming that login beside another person counts, because
 * either owner satisfies that line. A TEAM token never counts: the owner's team memberships are never read here
 * (`./codeownerRules.ts` holds the same line), so a file owned by `@org/everyone` is not claimed as theirs on a
 * guess. The rendered line says `by login` so a reader knows which.
 *
 * A file decided by a line GitHub reports as an error is UNKNOWABLE, not unowned — GitHub partly or wholly ignores
 * such a line (`../outbound/github/reviewerTable.ts` refuses the same files) — so the slice refuses rather than
 * counting it either way. So is a file whose deciding line names an EMAIL owner and not the owner's login: GitHub
 * routes an email to the account that verified it, which is never read here, so that address may be the owner's. So
 * is a RENAMED file whose old path is the owner's and new path is not, or the reverse: which path GitHub routes a review by is undocumented.
 *
 * A CODEOWNERS file with a backslash in any pattern refuses outright. How GitHub reads a `\` escape is not settled by
 * its docs (they name `\#` as one it does not take, and say nothing of `\ ` or `\*`), so which files such a line
 * decides — and so which line is LAST for any file — cannot be known from what was read.
 *
 * Pure. Every input is a value the caller already read.
 */
import { err, ok, type Result } from "#lib/result.js";

import { parseCodeownersLines, patternMatches } from "./codeowners.js";
import { type CodeOwnerSliceReason, type ReviewError, ReviewErrors } from "./errors.js";

/** One changed file of a pull request, with the line counts GitHub reports for it. */
export interface CodeOwnerChangedFile {
  /** The new-side path GitHub lists, which is what CODEOWNERS is matched against. */
  readonly path: string;
  /** The path a renamed file had on the base side, matched as well, since which one GitHub routes by is undocumented. */
  readonly previousPath?: string;
  readonly additions: number;
  readonly deletions: number;
}

/** The owner's share of one pull request, counted over EVERY changed file, with at most a few of their paths named. */
export interface CodeOwnerSlice {
  /** Every file the pull request changes. */
  readonly totalFiles: number;
  /** The files whose deciding CODEOWNERS line names the owner's login. */
  readonly ownedFiles: number;
  /** Lines added across the owner's files. */
  readonly additions: number;
  /** Lines removed across the owner's files. */
  readonly deletions: number;
  /** The owner's files, sorted, at most {@link CODE_OWNER_SLICE_PATHS_MAX}. */
  readonly shownPaths: readonly string[];
  /** The owner's files the line does not name, so `shownPaths.length + omittedPaths === ownedFiles`. */
  readonly omittedPaths: number;
}

/** How many of the owner's paths the line names before it says `and N more`. Three keeps the row one line on a terminal. */
export const CODE_OWNER_SLICE_PATHS_MAX = 3;

/**
 * Count the owner's share of a pull request's changed files.
 *
 * @param codeowners the base branch's CODEOWNERS text, empty when the repository has none
 * @param erroredLines the 1-based CODEOWNERS lines GitHub reports an error on
 * @param files every changed file, complete — a partial list would hide the one file that is the owner's
 * @param viewerLogin the owner's GitHub login, without the `@`
 * @returns the slice, or the files a reported-error or email-owned line decides, which make it unknowable
 */
export function codeOwnerSlice({
  codeowners,
  erroredLines,
  files,
  viewerLogin,
}: {
  codeowners: string;
  erroredLines: readonly number[];
  files: readonly CodeOwnerChangedFile[];
  viewerLogin: string;
}): Result<CodeOwnerSlice, ReviewError> {
  // Read off the RAW text, every line before its `#` comment, because the parser drops a line it cannot read (a
  // `[ ]` range, a `!` negation) and a dropped line's escape would otherwise go unseen.
  const escaping = codeowners
    .split("\n")
    .flatMap((raw, index) => (raw.split("#", 1)[0]!.includes("\\") ? [index + 1] : []));
  if (escaping.length > 0) {
    return err(
      ReviewErrors.codeOwnerSliceUnknowable({ reasons: [ReviewErrors.escapeUndocumented({ lines: escaping })] }),
    );
  }
  const { emailed, owned, renamed, unknowable } = classifyFiles({ codeowners, erroredLines, files, viewerLogin });
  const refusals: CodeOwnerSliceReason[] = [];
  if (unknowable.length > 0) {
    refusals.push(ReviewErrors.lineError({ paths: unknowable }));
  }
  if (emailed.length > 0) {
    refusals.push(ReviewErrors.emailOwner({ paths: emailed }));
  }
  if (renamed.length > 0) {
    refusals.push(ReviewErrors.renameAmbiguous({ paths: renamed }));
  }
  if (refusals.length > 0) {
    return err(ReviewErrors.codeOwnerSliceUnknowable({ reasons: refusals }));
  }
  const additions = owned.reduce((sum, file) => sum + file.additions, 0);
  const deletions = owned.reduce((sum, file) => sum + file.deletions, 0);
  // A total past exact integers would print a rounded count as though it were exact.
  if (!Number.isSafeInteger(additions) || !Number.isSafeInteger(deletions)) {
    return err(ReviewErrors.codeOwnerCountsUnsafe());
  }
  const paths = owned.map((file) => file.path).toSorted();
  const shownPaths = paths.slice(0, CODE_OWNER_SLICE_PATHS_MAX);
  return ok({
    additions,
    deletions,
    omittedPaths: paths.length - shownPaths.length,
    ownedFiles: owned.length,
    shownPaths,
    totalFiles: files.length,
  });
}

/**
 * Sort each changed file by its deciding CODEOWNERS line: the owner's, decided by a reported-error line, decided by an
 * email owner, renamed between a path that is the owner's and one that is not, or someone else's (dropped).
 *
 * @param codeowners the base branch's CODEOWNERS text
 * @param erroredLines the 1-based lines GitHub reports an error on
 * @param viewerLogin the owner's GitHub login, without the `@`
 * @returns the owner's files, and the described files whose ownership is unknowable for each reason
 */
function classifyFiles({
  codeowners,
  erroredLines,
  files,
  viewerLogin,
}: {
  codeowners: string;
  erroredLines: readonly number[];
  files: readonly CodeOwnerChangedFile[];
  viewerLogin: string;
}): {
  readonly owned: readonly CodeOwnerChangedFile[];
  readonly unknowable: readonly string[];
  readonly emailed: readonly string[];
  readonly renamed: readonly string[];
} {
  const lines = parseCodeownersLines({ content: codeowners });
  const errored = new Set(erroredLines);
  const mine = `@${viewerLogin}`.toLowerCase();
  const verdictOf = ({ path }: { path: string }): { kind: PathVerdict; described: string } => {
    const deciding = lines.findLast((entry) => patternMatches({ path, pattern: entry.rule.pattern }));
    if (deciding === undefined) {
      return { described: path, kind: "other" };
    }
    const described = `${path} (CODEOWNERS line ${String(deciding.line)})`;
    if (errored.has(deciding.line)) {
      return { described, kind: "errored" };
    }
    if (deciding.rule.owners.some((owner) => owner.toLowerCase() === mine)) {
      return { described, kind: "mine" };
    }
    const emailOwned = deciding.rule.owners.some((owner) => !owner.startsWith("@") && owner.includes("@"));
    return { described, kind: emailOwned ? "emailed" : "other" };
  };
  const owned: CodeOwnerChangedFile[] = [];
  const unknowable: string[] = [];
  const emailed: string[] = [];
  const renamed: string[] = [];
  for (const file of files) {
    // A renamed file is read at both its paths: which one GitHub routes a review by is not documented.
    const verdicts = [file.path, ...(file.previousPath === undefined ? [] : [file.previousPath])].map((path) =>
      verdictOf({ path }),
    );
    unknowable.push(...verdicts.filter((one) => one.kind === "errored").map((one) => one.described));
    emailed.push(...verdicts.filter((one) => one.kind === "emailed").map((one) => one.described));
    const settled = verdicts.every((one) => one.kind === "mine" || one.kind === "other");
    const mineCount = verdicts.filter((one) => one.kind === "mine").length;
    if (!settled || mineCount === 0) {
      continue;
    }
    if (mineCount === verdicts.length) {
      owned.push(file);
    } else {
      renamed.push(`${file.previousPath!} to ${file.path}`);
    }
  }
  return { emailed, owned, renamed, unknowable };
}

/** What one path's deciding CODEOWNERS line makes it: the owner's, unknowable for one of two reasons, or someone else's. */
type PathVerdict = "mine" | "errored" | "emailed" | "other";

/** One run of the slice's sentence: prose, or a path a renderer shows as code. */
export interface CodeOwnerSliceRun {
  readonly text: string;
  readonly code: boolean;
}

/**
 * The slice as a sentence, in runs, so a page can render each path as code while a terminal joins them.
 *
 * A path is never prose: a filename such as `docs/#N.md`, with a number for `N`, would otherwise read to the briefing's bare-reference
 * gate as a pull-request number.
 *
 * @param slice the owner's share of the pull request
 * @returns the sentence's runs, in order
 */
export function codeOwnerSliceRuns({ slice }: { slice: CodeOwnerSlice }): readonly CodeOwnerSliceRun[] {
  const lead = "Yours as code owner, by login:";
  if (slice.ownedFiles === 0) {
    return [{ code: false, text: `${lead} none of the ${String(slice.totalFiles)} files` }];
  }
  const runs: CodeOwnerSliceRun[] = [
    {
      code: false,
      text: `${lead} ${String(slice.ownedFiles)} of ${String(slice.totalFiles)} files, +${String(slice.additions)} -${String(slice.deletions)} lines, in `,
    },
  ];
  for (const [index, path] of slice.shownPaths.entries()) {
    if (index > 0) {
      const last = index === slice.shownPaths.length - 1 && slice.omittedPaths === 0;
      runs.push({ code: false, text: last ? " and " : ", " });
    }
    runs.push({ code: true, text: path });
  }
  if (slice.omittedPaths > 0) {
    runs.push({ code: false, text: ` and ${String(slice.omittedPaths)} more` });
  }
  return runs;
}

/**
 * The slice as one plain line, for a terminal.
 *
 * @param slice the owner's share of the pull request
 * @returns the sentence, every run joined
 */
export function codeOwnerSliceLine({ slice }: { slice: CodeOwnerSlice }): string {
  return codeOwnerSliceRuns({ slice })
    .map((run) => run.text)
    .join("");
}
