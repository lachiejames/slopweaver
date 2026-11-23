/**
 * `slopweaver github landing` — the pure argument handling and the defaults a supervisor tick runs on.
 *
 * The effectful read lives in `./landingRun.ts`. This module only decides what was TYPED, plus the defaults
 * that make the tick invocation short enough to actually be run: the repositories, the opt-out label and the
 * read cadence. All are overridable, and all are stated here rather than buried in the shell so a reader can
 * see what the bare verb will do before running it.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { CHECK_PAGE } from "../../../live/github/reviewState.js";
import { isRepositorySlug, type Organisation } from "../../../organisation/core.js";
import type { OrganisationError } from "../../../organisation/errors.js";
import { DEFAULT_CADENCE_MINUTES, MAX_CADENCE_MINUTES } from "../../../review/readCadence.js";
import { commaListFlag, parsePositiveInteger, positiveIntFlag } from "../../optionParsers.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import type { GithubLandingDeps } from "./landingDepsContract.js";
import { draftsOnlyProblems } from "./landingDraftsOnly.js";
import { DEFAULT_LIMIT, DEFAULT_OPT_OUT_LABEL } from "./landingUsage.js";
import type { collectReviewStates } from "./reviewStateRun.js";

// The run modules read their usage line through this module, which they import anyway; the manifest reads the
// leaf itself, so the command module never sits on the barrel's load path.
export { githubLandingUsage } from "./landingUsage.js";

/**
 * The flags this verb accepts, exported for the repo-wide help-truth ratchet.
 *
 * @internal
 */
export const GITHUB_LANDING_FLAGS: FlagSpec = {
  boolean: ["json", "press", "dry-run", "include-drafts", "drafts-only", "slack-live", "if-due", "register", "full"],
  string: ["repo", "author", "limit", "opt-out-label", "home", "cadence-minutes", "record-reading", "pr"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const GITHUB_LANDING_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_LANDING_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_LANDING_FLAGS }),
].map((name) => `--${name}`);

/** A parsed, side-effect-free landing invocation. */
export interface GithubLandingArgs {
  /** The repositories to read. Empty when none was typed, which the shell resolves to its own default. */
  readonly repos: readonly string[];
  readonly author: string | undefined;
  /**
   * Whether this read is scoped to the owner's own pull requests. Only `@me` proves it: GitHub resolves it to the
   * token's own login, while a typed login or no `--author` at all may reach a teammate's work.
   */
  readonly authoredByOwner: boolean;
  readonly includeDrafts: boolean;
  /** Read ONLY drafts, by a server-side `draft:true` query — the tick's second reading (`./landingDraftsOnly.ts`). */
  readonly draftsOnly: boolean;
  readonly limit: number;
  readonly json: boolean;
  /**
   * Whether to press 'Merge when ready' on every row the read calls `press` — every one of the owner's and every bump,
   * and up to `./landingUsage.ts`'s `NON_OWNER_PRESS_CAP_PER_REPO` of anybody else's per repository — and, on the
   * owner's own pull requests, first re-request every `stuck` CodeRabbit review (`./landingCodeRabbitNudge.ts`).
   */
  readonly press: boolean;
  /** With `--press`, report exactly what would be pressed and write nothing. */
  readonly dryRun: boolean;
  /**
   * Whether to run the LIVE Slack search as well as the corpus scan, which always runs.
   *
   * Off by default and opt-in per invocation: it costs one Slack search per pull request at a boot the
   * owner's rate-limit ruling exists to keep cheap. What it buys is measured rather than asserted —
   * see {@link githubLandingUsage}.
   */
  readonly slackLive: boolean;
  /** Labels that opt a pull request out of any press, lower-cased. */
  readonly optOutLabels: readonly string[];
  readonly home: string | undefined;
  /**
   * Whether to read only when the cadence says this selection is due, and otherwise touch nothing.
   *
   * What lets the sweep run this verb on EVERY tick. The owner's rate-limit ruling makes the read
   * a boot step; a sentence in three skill files rations nothing, it only stops the read. `../../../review/readJournal.ts` carries the ration itself.
   */
  readonly ifDue: boolean;
  /** How long one selection's read holds, in minutes. Only consulted with {@link GithubLandingArgs.ifDue}. */
  readonly cadenceMinutes: number;
  /**
   * Whether to write one handover board row per dispatchable row.
   *
   * There is deliberately no flag that SPAWNS. A landing row needing a session is an ordinary ready row, and
   * putting it on the one board hands it to the sweep's own fill step — which has already taken the capacity
   * reading and can already be held by `machine capacity`'s `hold`. See {@link githubLandingUsage}.
   */
  readonly register: boolean;
  /**
   * Who to record this read's document under in the readings ledger, or absent to record nothing.
   *
   * The document the run reports — the same one `--json` prints — is appended as the bytes it would print,
   * so a console page reading `reading last --producer "github landing"` shows exactly what this tick saw
   * (`../../../readings/store.ts`). A skipped tick records nothing: there is no document.
   */
  readonly recordReadingBy: string | undefined;
  /**
   * Print today's two-line-per-row table and every residue line, instead of the one fact line per pull
   * request the verb prints by default (`./landingCompactReport.ts`).
   */
  readonly full: boolean;
  /**
   * Read ONE pull request, in one `--repo`, and print it whole: every test with its why, the dispatch reason,
   * the failing checks with the test files their job logs name, and whether this pull request added each one.
   * Read-only by construction — it refuses every write flag.
   */
  readonly pr: number | undefined;
}

/** The flags `--pr` refuses: every write route, and every other way of choosing what to print. */
const PR_REFUSES: readonly string[] = [
  "press",
  "register",
  "if-due",
  "record-reading",
  "include-drafts",
  "drafts-only",
  "full",
  "json",
];

/**
 * The usage problems `--pr` adds: it reads one row in one repository, and it is never a write route.
 *
 * @returns every problem, in {@link PR_REFUSES}'s order
 */
function prProblems({
  values,
  repos,
}: {
  values: Readonly<Record<string, unknown>>;
  repos: readonly string[];
}): readonly string[] {
  if (values["pr"] === undefined) {
    return [];
  }
  const problems: string[] = [];
  if (repos.length !== 1) {
    problems.push("--pr reads one pull request, so it needs exactly one --repo owner/name");
  }
  for (const flag of PR_REFUSES) {
    if (values[flag] !== undefined && values[flag] !== false) {
      problems.push(`--pr cannot be combined with --${flag}: --pr is a read-only drill-down into one row`);
    }
  }
  return problems;
}

/**
 * The usage problems that come from flags COMBINED, after each one has parsed on its own.
 *
 * @returns every combination problem, in the order the usage text names the flags
 */
function combinationProblems({
  cadenceMinutes,
  dryRun,
  ifDue,
  press,
  register,
  values,
}: {
  cadenceMinutes: number;
  dryRun: boolean;
  ifDue: boolean;
  press: boolean;
  register: boolean;
  values: Readonly<Record<string, unknown>>;
}): readonly string[] {
  const problems: string[] = [];
  if (dryRun && !press && !register) {
    problems.push("--dry-run describes what --press or --register would do, so it needs one of them");
  }
  if (values["cadence-minutes"] !== undefined && !ifDue) {
    problems.push("--cadence-minutes sets how long a --if-due read holds, so it needs --if-due");
  }
  if (cadenceMinutes > MAX_CADENCE_MINUTES) {
    problems.push(
      `--cadence-minutes ${String(cadenceMinutes)} is longer than the ${String(MAX_CADENCE_MINUTES)}-minute ` +
        "maximum (seven days) — past that the cadence stops rationing the read and starts suppressing it",
    );
  }
  if (press && values["include-drafts"] === true) {
    problems.push("--include-drafts cannot be combined with --press: a draft has no button to press");
  }
  problems.push(...draftsOnlyProblems({ values }));
  // The ledger is the console's reading of the owner's pull requests: the Queue draws a name-the-reviewer card off
  // any row in the newest one. An every-author read recorded there would ask the owner to name a reviewer for a
  // colleague's pull request, so a recorded read is `@me` or refused.
  const author = values["author"];
  if (values["record-reading"] !== undefined && (typeof author !== "string" || author.toLowerCase() !== "@me")) {
    problems.push(
      "--record-reading needs --author @me: the readings ledger is the console's and the Queue's reading of the owner's " +
        "pull requests, so a read of anybody else's prints with --json and is never recorded",
    );
  }
  return problems;
}

/**
 * Parse one `github landing` invocation before any credential, git remote or network is touched.
 *
 * @param rest the argv tail after `github landing`
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubLandingArgs({ rest }: { rest: readonly string[] }): Result<GithubLandingArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_LANDING_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const limit = positiveIntFlag({ fallback: DEFAULT_LIMIT, name: "limit", problems, values });
  const repos = commaListFlag({ fallback: [], name: "repo", values });
  // A typed `--repo` naming no slug (`--repo ",,"`) is still a typed list: read as absent, it would fall through to
  // the organisation's repositories, which the flag exists to bypass.
  const repoTypedButEmpty = values["repo"] !== undefined && repos.length === 0;
  if (repoTypedButEmpty || repos.some((slug) => !isRepositorySlug({ slug }))) {
    problems.push("--repo takes one or more comma-separated owner/name slugs");
  }
  const press = values["press"] === true;
  const register = values["register"] === true;
  const ifDue = values["if-due"] === true;
  const cadenceMinutes = positiveIntFlag({
    fallback: DEFAULT_CADENCE_MINUTES,
    name: "cadence-minutes",
    problems,
    values,
  });
  const dryRun = values["dry-run"] === true;
  problems.push(...combinationProblems({ cadenceMinutes, dryRun, ifDue, press, register, values }));
  problems.push(...prProblems({ repos, values }));
  const prValue = values["pr"];
  const pr =
    typeof prValue === "string" ? parsePositiveInteger({ errors: problems, label: "--pr", value: prValue }) : undefined;
  if (problems.length > 0) {
    return err(problems);
  }
  const author = values["author"];
  const home = values["home"];
  const recordReadingBy = values["record-reading"];
  const draftsOnly = values["drafts-only"] === true;
  return ok({
    author: typeof author === "string" ? author : undefined,
    authoredByOwner: typeof author === "string" && author.toLowerCase() === "@me",
    cadenceMinutes,
    draftsOnly,
    dryRun,
    full: values["full"] === true,
    home: typeof home === "string" ? home : undefined,
    ifDue,
    includeDrafts: draftsOnly || values["include-drafts"] === true,
    json: values["json"] === true,
    limit,
    optOutLabels: commaListFlag({ fallback: [DEFAULT_OPT_OUT_LABEL], name: "opt-out-label", values }).map((label) =>
      label.toLowerCase(),
    ),
    pr,
    press,
    recordReadingBy: typeof recordReadingBy === "string" ? recordReadingBy : undefined,
    register,
    repos,
    slackLive: values["slack-live"] === true,
  });
}

/**
 * The fleet read's own arguments, which this verb pins rather than exposes.
 *
 * @param args the parsed invocation
 * @param repos the resolved repository slugs
 * @returns what `collectReviewStates` is asked for
 */
export function fleetReadArgs({
  args,
  repos,
}: {
  args: GithubLandingArgs;
  repos: readonly string[];
}): Parameters<typeof collectReviewStates>[0]["args"] {
  return {
    author: args.author,
    checkLimit: CHECK_PAGE,
    detail: true,
    draftsOnly: args.draftsOnly,
    fileLimit: 100,
    home: args.home,
    includeDrafts: args.includeDrafts,
    json: true,
    limit: args.limit,
    number: args.pr,
    pageSize: 20,
    readBaseDistance: true,
    repos,
    slackLive: args.slackLive,
  };
}

/**
 * The repositories a bare invocation reads: the organisation's own, in the order it stored them, then this
 * build's own repository unless the organisation already lists it. Pure.
 *
 * The list is the organisation's, never this file's, so a fresh install names nobody's repositories and an
 * install reads its own through the store (`../../../organisation/read.ts`).
 *
 * @param organisation the stored repositories and the derived self repository
 * @returns the slugs, lowercased, each once
 */
export function landingRepositories({
  organisation,
}: {
  organisation: Pick<Organisation, "repositories" | "selfRepository">;
}): readonly string[] {
  const slugs = [...organisation.repositories, organisation.selfRepository].map((slug) => slug.toLowerCase());
  return [...new Set(slugs)];
}

/**
 * Every repository slug this invocation reads: the typed `--repo` list, else the organisation's repositories
 * and this build's own.
 *
 * @param args the parsed invocation
 * @param deps the organisation read, made only when no `--repo` was typed
 * @returns the slugs, or the organisation's own typed refusal
 */
export async function resolveRepos({
  args,
  deps,
}: {
  args: Pick<GithubLandingArgs, "home" | "repos">;
  deps: Pick<GithubLandingDeps, "readOrganisation">;
}): Promise<Result<readonly string[], OrganisationError>> {
  if (args.repos.length > 0) {
    return ok(args.repos);
  }
  const organisation = await deps.readOrganisation({ home: args.home });
  if (organisation.isErr()) {
    return err(organisation.error);
  }
  return ok(landingRepositories({ organisation: organisation.value }));
}

/**
 * The one line a bare invocation prints when the organisation would not read: its code, its message, and the
 * flag that reads named repositories instead.
 *
 * @param error the organisation read's refusal
 * @returns the diagnostic line
 */
export function organisationRefusalLine({ error }: { error: OrganisationError }): string {
  return `${error.code}: ${error.message} — or pass --repo <owner/name,...>`;
}
