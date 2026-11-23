/**
 * The Who reviews what table, DERIVED: a pull request's changed paths against its CODEOWNERS, plus the people
 * the thread names for a team, in, the rows a reviewer reads to know which files are theirs out.
 *
 * The case: a reviewer asked to review a hundred-file pull request from another team needs the one or two
 * files they are actually on the hook for. GitHub's CODEOWNERS says who must approve, never who looks at what, so this module
 * turns the one into the other:
 *
 * - **A file belongs to the owners of its LAST matching rule** (`../../review/codeowners.ts`), so a removal rule
 *   leaves it unowned exactly as GitHub does.
 * - **The author is never a reviewer.** Their own token is taken off every rule, because a row naming them is
 *   one they cannot clear.
 * - **The catch-all rule is "everything else", named once**, so the row stays true as later pushes add files.
 *   A changed file NOBODY owns (a removal rule, or only the author) is on no row, and while one exists the
 *   catch-all's row lists its files by name instead, because "everything else" would claim that file too.
 * - **An owner named by email is surfaced, never read as no owner.** GitHub resolves it to an account a row
 *   cannot tag, so the verb refuses the table and says which file.
 * - **A pick stands a person in for a token**, and rows whose final reviewers are the same merge.
 * - **Fewer than two rows is no table.** One owner covering everything is what GitHub already says.
 *
 * Pure. CODEOWNERS text, paths, the author and the picks are all handed in.
 */
import {
  type CodeownersRule,
  isSelfOwner,
  lastMatchingRule,
  parseCodeowners,
  parseCodeownersLines,
  patternMatches,
} from "../../review/codeowners.js";

/**
 * One row of the Who reviews what table: who is asked, and what they look at. The table no longer travels in a
 * pull-request description (C3 has no table); `github pr reviewers` derives and prints it, and GitHub's own review
 * requests carry the state.
 */
export interface ReviewerRow {
  /** The `@login` or `@org/team` tokens tagged; any ONE of them covers the row. */
  readonly who: readonly string[];
  /** The CODEOWNERS tokens a picked person stands in for, shown untagged. Empty when nobody was picked. */
  readonly standsInFor: readonly string[];
  /** The changed files this row looks at, or everything the other rows do not name. */
  readonly look: { readonly kind: "files"; readonly files: readonly string[] } | { readonly kind: "rest" };
}

/** The anchor of the table's heading, and the prefix of every row's own anchor. */
export const REVIEWERS_ANCHOR = "reviewers";

/** One person picked to stand in for a CODEOWNERS token, from the people the thread names. */
export interface ReviewerPick {
  /** The token CODEOWNERS spells, `@org/team` or `@login`. */
  readonly owner: string;
  /** The `@login` who looks at that token's files instead. */
  readonly person: string;
}

/** What every outcome carries beside its own facts. */
interface DerivedResidue {
  /** Changed files nobody but the author owns, so no row lists them. */
  readonly unowned: readonly string[];
  /** Picks whose token owns no changed file, or whose person is the author. */
  readonly unusedPicks: readonly ReviewerPick[];
  /** Changed files whose deciding rule names an owner by email, whom a row cannot tag, so no table is written. */
  readonly emailOwned: readonly string[];
  /** Changed files decided by a line GitHub reports as an error, so GitHub may not ask who it names. */
  readonly erroredRule: readonly { readonly path: string; readonly line: number }[];
}

/** Each outcome the derivation reaches, so a caller can say truthfully why there is no table. */
export type DerivedReviewerTable =
  | (DerivedResidue & { readonly kind: "table"; readonly rows: readonly ReviewerRow[] })
  /** Every owned file asks the same reviewers, which is what GitHub already says. */
  | (DerivedResidue & { readonly kind: "one-reviewer"; readonly who: readonly string[] })
  /** No changed file is owned by anybody but the author. */
  | (DerivedResidue & { readonly kind: "no-reviewer" });

/** Whether a pattern matches every path: GitHub's catch-all default. */
function isCatchAll({ pattern }: { pattern: string }): boolean {
  return pattern === "*" || pattern === "**" || pattern === "/**";
}

/** A token's case-folded form, so `@Quinn` and `@quinn` pick the same owner. */
function folded({ token }: { token: string }): string {
  return token.toLowerCase();
}

/** One group of reviewers before it becomes a row. */
interface Group {
  readonly who: readonly string[];
  readonly standsInFor: readonly string[];
}

/**
 * Owners with the author taken off and every pick applied, deduplicated case-insensitively (a login is one
 * account however it is spelled, and its first spelling is kept) and sorted.
 */
function groupOf({
  owners,
  authorLogin,
  picks,
  used,
}: {
  owners: readonly string[];
  authorLogin: string;
  picks: readonly ReviewerPick[];
  used: Set<ReviewerPick>;
}): Group {
  const who = new Map<string, string>();
  const standsInFor = new Map<string, string>();
  const add = ({ into, token }: { into: Map<string, string>; token: string }): void => {
    if (!into.has(folded({ token }))) {
      into.set(folded({ token }), token);
    }
  };
  for (const token of owners.filter((owner) => !isSelfOwner({ authorLogin, token: owner }))) {
    const pick = picks.find((candidate) => folded({ token: candidate.owner }) === folded({ token }));
    if (pick === undefined) {
      add({ into: who, token });
      continue;
    }
    // A pick naming the author would hand them a row they cannot clear, so the token stays as CODEOWNERS says.
    if (isSelfOwner({ authorLogin, token: pick.person })) {
      add({ into: who, token });
      continue;
    }
    used.add(pick);
    add({ into: who, token: pick.person });
    add({ into: standsInFor, token });
  }
  return { standsInFor: [...standsInFor.values()].toSorted(), who: [...who.values()].toSorted() };
}

/** A group's identity: its reviewers, case-folded and then sorted, so `@Alice @bob` and `@alice @Bob` are one. */
function keyOf({ group }: { group: Group }): string {
  return group.who
    .map((token) => folded({ token }))
    .toSorted()
    .join(" ");
}

/**
 * The catch-all's row: Everything else while it owns every file no narrower row lists, else its files by name.
 *
 * A changed file nobody owns would otherwise read as the catch-all's, which is the one thing GitHub says it is not.
 */
function restRowOf({
  rest,
  restFiles,
  standsInFor,
  unowned,
}: {
  rest: Group | undefined;
  restFiles: readonly string[];
  standsInFor: readonly string[];
  unowned: readonly string[];
}): readonly ReviewerRow[] {
  if (rest === undefined || rest.who.length === 0 || restFiles.length === 0) {
    return [];
  }
  if (unowned.length === 0) {
    return [{ look: { kind: "rest" }, standsInFor, who: rest.who }];
  }
  return [{ look: { files: restFiles.toSorted(), kind: "files" }, standsInFor, who: rest.who }];
}

/**
 * The changed files whose deciding line names an owner by email, and those decided by a line GitHub reports.
 *
 * GitHub resolves an email owner to an account; the table can tag only `@` tokens, so such a file is surfaced. A
 * line GitHub reports as an error (an unknown owner, one without write access, a pattern it cannot read) is one it
 * partly or wholly ignores, so a file it decides is surfaced too, rather than guessed at.
 */
function lineResidueOf({
  codeowners,
  erroredLines,
  paths,
}: {
  codeowners: string;
  erroredLines: readonly number[];
  paths: readonly string[];
}): Pick<DerivedResidue, "emailOwned" | "erroredRule"> {
  const lines = parseCodeownersLines({ content: codeowners });
  const errored = new Set(erroredLines);
  const emailOwned: string[] = [];
  const erroredRule: { path: string; line: number }[] = [];
  for (const path of new Set(paths)) {
    const deciding = lines.findLast((entry) => patternMatches({ path, pattern: entry.rule.pattern }));
    if (deciding === undefined) {
      continue;
    }
    if (deciding.rule.owners.some((owner) => !owner.startsWith("@"))) {
      emailOwned.push(path);
    }
    if (errored.has(deciding.line)) {
      erroredRule.push({ line: deciding.line, path });
    }
  }
  return {
    emailOwned: emailOwned.toSorted(),
    erroredRule: erroredRule.toSorted((a, b) => a.path.localeCompare(b.path)),
  };
}

/** One files row while it is being built: its reviewers, the tokens it stands in for, and its files. */
interface FilesGroup {
  readonly who: readonly string[];
  readonly standsInFor: Set<string>;
  readonly files: string[];
}

/** Add every token to a set. */
function addAll({ into, tokens }: { into: Set<string>; tokens: readonly string[] }): void {
  for (const token of tokens) {
    into.add(token);
  }
}

/**
 * Whether a file's group joins the catch-all's row: it is the catch-all's own file, or a narrower rule asks the
 * catch-all's own reviewers, so that row stands in for its tokens too (`@seth for @org/default, @org/special`).
 */
function joinsRest({
  catchAll,
  group,
  rest,
  rule,
}: {
  catchAll: CodeownersRule | undefined;
  group: Group;
  rest: Group | undefined;
  rule: CodeownersRule;
}): boolean {
  if (rule === catchAll) {
    return true;
  }
  return rest !== undefined && keyOf({ group }) === keyOf({ group: rest });
}

/** Every changed file put on its group's row, on the catch-all's, or on no row. */
function groupedFilesOf({
  authorLogin,
  catchAll,
  paths,
  picks,
  rest,
  rules,
  used,
}: {
  authorLogin: string;
  catchAll: CodeownersRule | undefined;
  paths: readonly string[];
  picks: readonly ReviewerPick[];
  rest: Group | undefined;
  rules: readonly CodeownersRule[];
  used: Set<ReviewerPick>;
}): { files: Map<string, FilesGroup>; unowned: string[]; restFiles: string[]; restStandsInFor: Set<string> } {
  const files = new Map<string, FilesGroup>();
  const unowned: string[] = [];
  const restFiles: string[] = [];
  const restStandsInFor = new Set<string>();
  for (const path of new Set(paths)) {
    const rule = lastMatchingRule({ path, rules });
    const group = rule === undefined ? undefined : groupOf({ authorLogin, owners: rule.owners, picks, used });
    // A file nobody but the author owns is on no row: GitHub asks nobody to review it, the catch-all included.
    if (rule === undefined || group === undefined || group.who.length === 0) {
      unowned.push(path);
      continue;
    }
    if (joinsRest({ catchAll, group, rest, rule })) {
      restFiles.push(path);
      addAll({ into: restStandsInFor, tokens: group.standsInFor });
      continue;
    }
    const key = keyOf({ group });
    const existing = files.get(key);
    if (existing === undefined) {
      files.set(key, { files: [path], standsInFor: new Set(group.standsInFor), who: group.who });
      continue;
    }
    existing.files.push(path);
    addAll({ into: existing.standsInFor, tokens: group.standsInFor });
  }
  return { files, restFiles, restStandsInFor, unowned };
}

/** The files rows, fewest files first and then by their reviewers' key. */
function fileRowsOf({ files }: { files: Map<string, FilesGroup> }): readonly ReviewerRow[] {
  return [...files.entries()]
    .toSorted(([keyA, a], [keyB, b]) => a.files.length - b.files.length || keyA.localeCompare(keyB))
    .map(([, group]) => ({
      look: { files: group.files.toSorted(), kind: "files" },
      standsInFor: [...group.standsInFor].toSorted(),
      who: group.who,
    }));
}

/**
 * Derive the Who reviews what rows for one pull request.
 *
 * @param codeowners the CODEOWNERS file's text at the pull request's base
 * @param paths every path the pull request changes
 * @param authorLogin the pull request author's login, never a reviewer
 * @param picks the people standing in for a token, from the thread
 * @param erroredLines the 1-based CODEOWNERS lines GitHub's errors endpoint reports at that base
 * @returns the rows, files rows fewest-files first and everything else last, or no rows under two
 */
export function deriveReviewerTable({
  codeowners,
  paths,
  authorLogin,
  picks,
  erroredLines,
}: {
  codeowners: string;
  paths: readonly string[];
  authorLogin: string;
  picks: readonly ReviewerPick[];
  erroredLines: readonly number[];
}): DerivedReviewerTable {
  const rules = parseCodeowners({ content: codeowners });
  const used = new Set<ReviewerPick>();
  const catchAll = rules.findLast((rule) => isCatchAll({ pattern: rule.pattern }));
  // A pick is used by the files that reach its token, never by the catch-all merely existing.
  const rest =
    catchAll === undefined
      ? undefined
      : groupOf({ authorLogin, owners: catchAll.owners, picks, used: new Set<ReviewerPick>() });
  const grouped = groupedFilesOf({ authorLogin, catchAll, paths, picks, rest, rules, used });
  const restRow = restRowOf({
    rest,
    restFiles: grouped.restFiles,
    standsInFor: [...grouped.restStandsInFor].toSorted(),
    unowned: grouped.unowned,
  });
  const rows = [...fileRowsOf({ files: grouped.files }), ...restRow];
  const residue = {
    ...lineResidueOf({ codeowners, erroredLines, paths }),
    unowned: grouped.unowned.toSorted(),
    unusedPicks: picks.filter((pick) => !used.has(pick)),
  };
  const [only] = rows;
  if (only === undefined) {
    return { ...residue, kind: "no-reviewer" };
  }
  if (rows.length === 1) {
    return { ...residue, kind: "one-reviewer", who: only.who };
  }
  return { ...residue, kind: "table", rows };
}

/** One row's anchor before collisions: `reviewers-` then each token lowercased, `@` dropped, `/ . _` as `-`. */
function anchorStem({ row }: { row: ReviewerRow }): string {
  const tokens = row.who.map((token) => token.replace(/^@/, "").replace(/[/._]/g, "-").toLowerCase());
  return `${REVIEWERS_ANCHOR}-${tokens.join("-")}`;
}

/**
 * The anchor each row renders at, so `…/pull/<n>#<anchor>` lands a reviewer on their own row.
 *
 * Built from every token the row tags, because one person can sit on two rows beside different co-owners. Two
 * different sets can still spell one stem (`@a-b` and `@a @b`), so a repeat takes `-2`, `-3`, … in row order.
 *
 * @param rows the table's rows, in render order
 * @returns one anchor name per row, all distinct
 */
export function reviewerRowAnchors({ rows }: { rows: readonly ReviewerRow[] }): readonly string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const stem = anchorStem({ row });
    const count = (seen.get(stem) === undefined ? 0 : seen.get(stem)!) + 1;
    seen.set(stem, count);
    return count === 1 ? stem : `${stem}-${String(count)}`;
  });
}
