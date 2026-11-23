/**
 * Pure half of `slopweaver github pr reviewers`: the argv, the three REST responses read into facts, and the
 * lines it prints. The effectful shell is `./prReviewersRun.ts`.
 *
 * The verb DERIVES the Who reviews what table (`../../../outbound/github/reviewerTable.ts`) from the pull
 * request's whole file list and the CODEOWNERS on its base branch, and prints it. A C3 description publishes no
 * reviewer table, so the verb writes nothing: the rows are what a review ask (`github pr request-review`) names.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import type { DerivedReviewerTable, ReviewerPick, ReviewerRow } from "../../../outbound/github/reviewerTable.js";
import { type FlagSpec, parseFlags, repeatedFlagValues } from "../../parseFlags.js";

/** Every value flag this verb takes. */
const VALUE_FLAGS = ["home", "pick"] as const;

const PR_REVIEWERS_FLAGS: FlagSpec = { boolean: ["json", "apply"], repeatable: ["pick"], string: VALUE_FLAGS };

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_PR_REVIEWERS_FLAG_NAMES: readonly string[] = [...VALUE_FLAGS, "json", "apply"].map(
  (name) => `--${name}`,
);

/** The resolved request. */
export interface GithubPrReviewersArgs {
  readonly url: string;
  readonly picks: readonly ReviewerPick[];
  readonly json: boolean;
  readonly apply: boolean;
  readonly home: string | undefined;
}

/** One `--pick @owner=@person`, or the reason it is not one. */
function pickOf({ value }: { value: string }): ReviewerPick | string {
  const [owner = "", person = "", ...extra] = value.split("=");
  if (!owner.startsWith("@") || !person.startsWith("@") || extra.length > 0 || person.includes("/")) {
    return `--pick takes @owner=@person, a CODEOWNERS token and the one login standing in for it; got ${JSON.stringify(value)}`;
  }
  return { owner, person };
}

/**
 * Parse the verb's argv.
 *
 * @param rest argv after `github pr reviewers`
 * @returns the request, or every problem with it
 */
export function parseGithubPrReviewersArgs({ rest }: { rest: readonly string[] }): Result<GithubPrReviewersArgs> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: PR_REVIEWERS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  const read = repeatedFlagValues({ name: "pick", rest }).map((value) => pickOf({ value }));
  const problems = read.filter((pick): pick is string => typeof pick === "string");
  const picks = read.filter((pick): pick is ReviewerPick => typeof pick !== "string");
  const owners = picks.map((pick) => pick.owner.toLowerCase());
  const twice = owners.filter((owner, index) => owners.indexOf(owner) !== index);
  if (twice.length > 0) {
    problems.push(`--pick names ${[...new Set(twice)].join(", ")} twice; one person stands in for a token`);
  }
  if (positionals.length !== 1) {
    problems.push(`exactly one pull-request address is required; got ${String(positionals.length)}`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  const home = values["home"];
  return ok({
    apply: values["apply"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    picks,
    url: positionals[0]!,
  });
}

/** What the pull request itself says: who wrote it, where it lands, what it changes, and its body. */
export interface PrReviewersFacts {
  readonly authorLogin: string;
  readonly base: string;
  readonly changedFiles: number;
  readonly body: string;
  /** The head commit the file list was read at, re-checked before `--apply` writes. */
  readonly headSha: string;
  /** The base commit GitHub reports beside it, re-checked the same way. */
  readonly baseSha: string;
  /** Whether GitHub reports it `open`, re-checked the same way, so a close between the reads is caught. */
  readonly open: boolean;
}

/**
 * Read `GET /repos/{owner}/{repo}/pulls/{n}` into the facts the derivation needs.
 *
 * @param response the raw Octokit response
 * @returns the facts, or undefined when the response is not a pull request
 */
export function prReviewersFactsOf({ response }: { response: unknown }): PrReviewersFacts | undefined {
  const data = isRecord(response) ? response["data"] : undefined;
  if (!isRecord(data)) {
    return undefined;
  }
  const { user, base, head, changed_files: changed, body, state } = data;
  const login = isRecord(user) ? user["login"] : undefined;
  const ref = isRecord(base) ? base["ref"] : undefined;
  const sha = isRecord(head) ? head["sha"] : undefined;
  const baseSha = isRecord(base) ? base["sha"] : undefined;
  const shas = typeof sha === "string" && typeof baseSha === "string";
  // A count of files is a whole number from zero up; anything else is not a pull request this verb can list.
  const count = typeof changed === "number" && Number.isSafeInteger(changed) && changed >= 0;
  if (typeof login !== "string" || typeof ref !== "string" || !shas || !count || typeof state !== "string") {
    return undefined;
  }
  // GitHub answers `null` for a pull request opened with no description, which is an empty one.
  const text = typeof body === "string" ? body : "";
  return {
    authorLogin: login,
    base: ref,
    baseSha,
    body: text,
    changedFiles: changed,
    headSha: sha,
    open: state === "open",
  };
}

/**
 * Read one page of `GET /repos/{owner}/{repo}/pulls/{n}/files` into its paths.
 *
 * @param response the raw Octokit response
 * @returns the page's new-side paths, or undefined when the response is not a file list
 */
export function changedPathsOf({ response }: { response: unknown }): readonly string[] | undefined {
  const data = isRecord(response) ? response["data"] : undefined;
  if (!Array.isArray(data)) {
    return undefined;
  }
  const paths = data.map((file: unknown) => (isRecord(file) ? file["filename"] : undefined));
  return paths.every((path) => typeof path === "string") ? paths : undefined;
}

/**
 * Read `GET /repos/{owner}/{repo}/compare/{basehead}` into its changed paths.
 *
 * @param response the raw Octokit response
 * @returns the new-side paths, or undefined when the response carries no file list
 */
export function comparedPathsOf({ response }: { response: unknown }): readonly string[] | undefined {
  const data = isRecord(response) ? response["data"] : undefined;
  return isRecord(data) ? changedPathsOf({ response: { data: data["files"] } }) : undefined;
}

/**
 * Read `GET /repos/{owner}/{repo}/contents/{path}` into the file's text.
 *
 * @param response the raw Octokit response
 * @returns the decoded text, or undefined when the response carries no base64 file
 */
export function contentTextOf({ response }: { response: unknown }): string | undefined {
  const data = isRecord(response) ? response["data"] : undefined;
  const content = isRecord(data) ? data["content"] : undefined;
  const encoding = isRecord(data) ? data["encoding"] : undefined;
  if (typeof content !== "string" || encoding !== "base64") {
    return undefined;
  }
  return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
}

/**
 * The path a contents read actually answered with. GitHub answers a path that is a symlink with its TARGET file, so
 * a path differing from the one asked for is how a linked file shows itself.
 *
 * @param response the raw Octokit response
 * @returns the answered path, or undefined when the response names none
 */
export function contentPathOf({ response }: { response: unknown }): string | undefined {
  const data = isRecord(response) ? response["data"] : undefined;
  const path = isRecord(data) ? data["path"] : undefined;
  return typeof path === "string" ? path : undefined;
}

/**
 * Read `GET /repos/{owner}/{repo}/codeowners/errors` into the lines of one CODEOWNERS file GitHub reports.
 *
 * @param response the raw Octokit response
 * @param path the CODEOWNERS file the table was derived from, since GitHub reports on the one it uses
 * @returns the 1-based lines with an error, or undefined when the response is not an error list
 */
export function codeownersErrorLinesOf({
  response,
  path,
}: {
  response: unknown;
  path: string;
}): readonly number[] | undefined {
  const data = isRecord(response) ? response["data"] : undefined;
  const errors = isRecord(data) ? data["errors"] : undefined;
  if (!Array.isArray(errors)) {
    return undefined;
  }
  const lines: number[] = [];
  for (const entry of errors as readonly unknown[]) {
    if (!isRecord(entry) || typeof entry["path"] !== "string") {
      return undefined;
    }
    // A line is a whole number from one up; anything else is a malformed list, never an error on no line.
    const line = entry["line"];
    if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
      return undefined;
    }
    if (entry["path"] === path) {
      lines.push(line);
    }
  }
  return lines;
}

/** What the verb found, as `--json` prints it. */
export interface GithubPrReviewersReport {
  readonly url: string;
  readonly codeownersPath: string;
  readonly changedFiles: number;
  readonly derived: DerivedReviewerTable;
  /** Why the derived table cannot be trusted as it stands, when it cannot. */
  readonly refusal: string | undefined;
}

/** Why a derived table cannot be written as it stands, or undefined when it can. */
function refusalOf({ derived }: { derived: DerivedReviewerTable }): string | undefined {
  if (derived.erroredRule.length > 0) {
    const where = derived.erroredRule.map((entry) => `${entry.path} (line ${String(entry.line)})`).join(", ");
    return `GitHub reports an error on the CODEOWNERS line deciding ${where}, so it may not ask who that line names; fix the line and re-run`;
  }
  if (derived.emailOwned.length > 0) {
    return `CODEOWNERS names the owner of ${derived.emailOwned.join(", ")} by email, which a row cannot tag; name them by @login there`;
  }
  const [pick] = derived.unusedPicks;
  if (pick !== undefined) {
    return `--pick ${pick.owner}=${pick.person} stands in for nothing: that token owns no changed file, or the person is the author`;
  }
  return undefined;
}

/**
 * The report for one derivation.
 *
 * @param url the pull request's address
 * @param codeownersPath which CODEOWNERS file was read
 * @param changedFiles how many files the pull request changes
 * @param derived what the derivation reached
 * @returns the report
 */
export function githubPrReviewersReportOf({
  url,
  codeownersPath,
  changedFiles,
  derived,
}: {
  url: string;
  codeownersPath: string;
  changedFiles: number;
  derived: DerivedReviewerTable;
}): GithubPrReviewersReport {
  return { changedFiles, codeownersPath, derived, refusal: refusalOf({ derived }), url };
}

/** Why `--apply` writes nothing: the line printed when it is given. */
export const REVIEWERS_APPLY_RETIRED =
  "--apply wrote the table into the description, and a C3 description publishes no reviewer table. Ask the " +
  "reviewers instead: `slopweaver github pr request-review`";

/** One row as a reader of the terminal reads it. */
function rowLine({ row }: { row: ReviewerRow }): string {
  const standsIn = row.standsInFor.length === 0 ? "" : ` (for ${row.standsInFor.join(", ")})`;
  const look = row.look.kind === "rest" ? "everything else" : row.look.files.join(", ");
  return `  ${row.who.join(" or ")}${standsIn}: ${look}`;
}

/** The one line saying what the derivation reached when it is not a table. */
function outcomeLine({ derived }: { derived: DerivedReviewerTable }): string | undefined {
  if (derived.kind === "one-reviewer") {
    return `one reviewer covers every owned file (${derived.who.join(" or ")}), which GitHub already says, so there is no table`;
  }
  if (derived.kind === "no-reviewer") {
    return "nobody but the author owns a changed file, so there is no table";
  }
  return undefined;
}

/**
 * The report as a reader reads it: the table and what it leaves out.
 *
 * @param report the derivation's report
 * @returns the lines to print
 */
export function renderGithubPrReviewersText({ report }: { report: GithubPrReviewersReport }): readonly string[] {
  const { derived } = report;
  const lines = [`${report.url}: ${String(report.changedFiles)} changed files against ${report.codeownersPath}`];
  const outcome = outcomeLine({ derived });
  if (outcome !== undefined) {
    lines.push(outcome);
  }
  if (derived.kind === "table") {
    lines.push(...derived.rows.map((row) => rowLine({ row })));
  }
  if (derived.unowned.length > 0) {
    lines.push(`  no reviewer owns these, so they are on no row: ${derived.unowned.join(", ")}`);
  }
  if (report.refusal !== undefined) {
    lines.push(`refused: ${report.refusal}`);
  }
  return lines;
}
