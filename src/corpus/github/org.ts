/**
 * The GitHub ORG lane: enumerate the org itself (`orgs.get`), all its repos (`repos.listForOrg`, paged +
 * include/exclude/cap filtered), and its teams (`teams.list` → per-team members + repo permissions) into
 * durable {@link StructureBronzeRow}s. `read:org` gates teams/private repos, so a teams failure DEGRADES to a
 * warning (org + public repos still land) rather than crashing the refresh — data-first (D8), no invented
 * structure. The network is an injected {@link GithubOrgApi} seam (unit-tested with a fake); the live seam
 * routes every SDK call through a `safe*` wrapper and reuses octokit's own retry/throttle plugins.
 */
import type { Repository } from "../../config.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { optStr as ghStr } from "../slack/shape.js";
import type { StructureBronzeRow } from "../structures/types.js";
import { type GithubOrgError, GithubOrgErrors } from "./errors.js";
import { type GithubOrgApi, type PagedList, pageCeilingWarning, pageToCeiling } from "./orgApi.js";
import { projectOrgRow, projectRepoRow, projectTeamRow } from "./orgRows.js";

/**
 * Compile a repo glob (`app-*`, `*-archive`) into an anchored RegExp — `*` matches any run, `?` one char,
 * every other character is literal. Pure — the tiny glob surface repo-selection needs (no brace/range).
 *
 * @param glob the glob pattern
 * @returns an anchored RegExp matching the whole repo name
 */
export function globToRegExp({ glob }: { glob: string }): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

/** Whether a name matches any of the globs (empty list ⇒ false). Pure. */
function matchesAny({ name, globs }: { name: string; globs: readonly string[] }): boolean {
  return globs.some((glob) => globToRegExp({ glob }).test(name));
}

/** The outcome of applying include/exclude/cap to the enumerated repo names. */
export interface RepoSelection {
  readonly selected: readonly string[];
  readonly excluded: readonly string[];
  readonly cappedCount: number;
  readonly warnings: readonly string[];
}

/**
 * Select which repo names to ingest: keep those matching an `include` glob (empty include ⇒ all), drop any
 * matching an `exclude` glob, sort, then apply `cap`. Every drop/cap is reported — never silent. Pure.
 *
 * @param names the enumerated repo names
 * @param include include globs (empty ⇒ all repos)
 * @param exclude exclude globs
 * @param cap the max repos to keep (undefined ⇒ no cap)
 * @returns the selected names + what was excluded/capped + warnings
 */
export function selectRepoNames({
  names,
  include,
  exclude,
  cap,
}: {
  names: readonly string[];
  include: readonly string[];
  exclude: readonly string[];
  cap: number | undefined;
}): RepoSelection {
  const included = include.length > 0 ? names.filter((name) => matchesAny({ globs: include, name })) : [...names];
  const excluded = included.filter((name) => matchesAny({ globs: exclude, name })).toSorted();
  const kept = included.filter((name) => !matchesAny({ globs: exclude, name })).toSorted();
  const capped = cap !== undefined && kept.length > cap ? kept.length - cap : 0;
  const selected = capped > 0 && cap !== undefined ? kept.slice(0, cap) : kept;
  const filteredOut = include.length > 0 ? names.length - included.length : 0;
  // Every skip is surfaced (never silent): the include filter, the exclude globs, and the cap all log.
  const warnings = [
    ...(filteredOut > 0
      ? [`github: ${String(filteredOut)} repo(s) filtered out by --include-repo (${String(included.length)} matched)`]
      : []),
    ...(excluded.length > 0 ? [`github: ${String(excluded.length)} repo(s) skipped by --exclude-repo`] : []),
    ...(capped > 0
      ? [`github: repo cap ${String(cap)} applied — ${String(capped)} of ${String(kept.length)} repo(s) skipped`]
      : []),
  ];
  return { cappedCount: capped, excluded, selected, warnings };
}

/** Page an org's repos to exhaustion, or to the page ceiling — and say which. */
async function listAllRepos({
  api,
  org,
  pageCap,
}: {
  api: GithubOrgApi;
  org: string;
  pageCap: number;
}): Promise<PagedList> {
  return pageToCeiling({ fetch: (page) => api.listRepos({ org, page }), pageCap });
}

/** The ceiling warning for one walked list, when the walk hit it (empty otherwise). Pure. */
function ceilingWarnings({ what, listed }: { what: string; listed: PagedList }): readonly string[] {
  return listed.truncated ? [pageCeilingWarning({ listed, what })] : [];
}

/** The short repo name off a raw repo object (`name`), else undefined. Pure. */
function repoShortName({ raw }: { raw: unknown }): string | undefined {
  return isRecord(raw) ? ghStr({ value: raw["name"] }) : undefined;
}

/**
 * Enumerate + select the org's repo COORDINATES for the activity fan-out (the lean path — no org/teams
 * structural fetch). A `listRepos` failure is fatal (`err`); include/exclude/cap warnings flow through.
 *
 * @param api the injected org seam
 * @param org the org login
 * @param include include globs (empty ⇒ all repos)
 * @param exclude exclude globs
 * @param cap the max repos to ingest (undefined ⇒ no cap)
 * @param pageCap the page ceiling on the repo walk (`--github-page-cap`; a hit is warned, never silent)
 * @returns the selected `{owner, repo}` coordinates + warnings, or `err` on a fatal repo failure
 */
export async function enumerateOrgRepos({
  api,
  org,
  include,
  exclude,
  cap,
  pageCap,
}: {
  api: GithubOrgApi;
  org: string;
  include: readonly string[];
  exclude: readonly string[];
  cap: number | undefined;
  pageCap: number;
}): Promise<Result<{ repos: readonly Repository[]; warnings: readonly string[] }, GithubOrgError>> {
  let listed: PagedList;
  try {
    listed = await listAllRepos({ api, org, pageCap });
  } catch (error: unknown) {
    return err(GithubOrgErrors.repoEnumerationFailed({ cause: error }));
  }
  const names = listed.items.map((raw) => repoShortName({ raw })).filter((n): n is string => n !== undefined);
  const selection = selectRepoNames({ cap, exclude, include, names });
  const wanted = new Set(selection.selected);
  const repos = [...wanted].toSorted().map((repo) => ({ owner: org, repo }));
  return ok({ repos, warnings: [...ceilingWarnings({ listed, what: "org repo" }), ...selection.warnings] });
}

/**
 * The selected repos' rows + their `{owner, repo}` coordinates (for the activity fan-out). Pure.
 *
 * @param repos every raw repo the org listed
 * @param selection which of them were selected, plus the warnings that selection raised
 * @param org the owner login, used to qualify each coordinate
 * @param fetchedAtIso when the fetch happened
 * @returns the rows for the SELECTED repos only, and their coordinates for the per-repo activity fan-out
 */
function buildRepoRows({
  repos,
  selection,
  org,
  fetchedAtIso,
}: {
  repos: readonly unknown[];
  selection: RepoSelection;
  org: string;
  fetchedAtIso: string;
}): { rows: readonly StructureBronzeRow[]; coords: readonly Repository[] } {
  const wanted = new Set(selection.selected);
  const rows: StructureBronzeRow[] = [];
  const coords: Repository[] = [];
  for (const raw of repos) {
    const name = repoShortName({ raw });
    if (name === undefined || !wanted.has(name)) {
      continue;
    }
    const row = projectRepoRow({ fetchedAtIso, raw });
    if (row !== undefined) {
      rows.push(row);
      coords.push({ owner: org, repo: name });
    }
  }
  return { coords, rows };
}

/** Fetch + project the org's teams (members + repo permissions). A scope gap ⇒ warning, empty rows. */
async function buildTeamRows({
  api,
  org,
  fetchedAtIso,
}: {
  api: GithubOrgApi;
  org: string;
  fetchedAtIso: string;
}): Promise<{ rows: readonly StructureBronzeRow[]; warnings: readonly string[] }> {
  const teams = await api.listTeams({ org });
  if (teams.isErr()) {
    return { rows: [], warnings: [teams.error.message] };
  }
  const rows: StructureBronzeRow[] = [];
  const warnings: string[] = [...ceilingWarnings({ listed: teams.value, what: "org team" })];
  for (const raw of teams.value.items) {
    const slug = isRecord(raw) ? ghStr({ value: raw["slug"] }) : undefined;
    if (slug === undefined) {
      continue;
    }
    const built = await buildOneTeamRow({ api, fetchedAtIso, org, raw, slug });
    warnings.push(...built.warnings);
    if (built.row !== undefined) {
      rows.push(built.row);
    }
  }
  return { rows, warnings };
}

/**
 * Fetch ONE team's members + repo permissions and project its row. A members/repos failure DEGRADES to a
 * warning + the missing side left empty (the team row still lands) — so one team's scope gap never crashes
 * the whole structural pass. Mirrors the `read:org` degrade policy at the per-team granularity.
 */
async function buildOneTeamRow({
  api,
  org,
  slug,
  raw,
  fetchedAtIso,
}: {
  api: GithubOrgApi;
  org: string;
  slug: string;
  raw: unknown;
  fetchedAtIso: string;
}): Promise<{ row?: StructureBronzeRow; warnings: readonly string[] }> {
  const warnings: string[] = [];
  let members: readonly unknown[] = [];
  let repos: readonly unknown[] = [];
  try {
    const listed = await api.listTeamMembers({ org, teamSlug: slug });
    members = listed.items;
    warnings.push(...ceilingWarnings({ listed, what: `team ${slug} members` }));
  } catch (error: unknown) {
    warnings.push(`github team ${slug} members unavailable: ${error instanceof Error ? error.message : "unknown"}`);
  }
  try {
    const listed = await api.listTeamRepos({ org, teamSlug: slug });
    repos = listed.items;
    warnings.push(...ceilingWarnings({ listed, what: `team ${slug} repos` }));
  } catch (error: unknown) {
    warnings.push(`github team ${slug} repos unavailable: ${error instanceof Error ? error.message : "unknown"}`);
  }
  const row = projectTeamRow({ fetchedAtIso, members, raw, repos });
  return { warnings, ...(row !== undefined ? { row } : {}) };
}

/** The result of a GitHub structural hydration: the rows, warnings, and the repos to fan activity over. */
export interface GithubStructures {
  readonly rows: readonly StructureBronzeRow[];
  readonly warnings: readonly string[];
  readonly repos: readonly Repository[];
}

/**
 * Hydrate an org's structure: the org row, its selected repos, and its teams (+ members + repo permissions).
 * A missing org / teams scope DEGRADES to a warning (partial structure), never a crash. A `listRepos` failure
 * is fatal (`err`) — with no repo set there's nothing to ingest.
 *
 * @param api the injected org seam
 * @param org the org login
 * @param include include globs (empty ⇒ all repos)
 * @param exclude exclude globs
 * @param cap the max repos to ingest (undefined ⇒ no cap)
 * @param pageCap the page ceiling on the repo walk (`--github-page-cap`; a hit is warned, never silent) — the
 *   seam's own lists (teams, members) walk under the ceiling `makeGithubOrgApi` was built with
 * @param fetchedAtIso the hydration timestamp
 * @returns the structure rows + warnings + the selected repo coordinates, or `err` on a fatal repo failure
 */
export async function fetchGithubStructures({
  api,
  org,
  include,
  exclude,
  cap,
  pageCap,
  fetchedAtIso,
}: {
  api: GithubOrgApi;
  org: string;
  include: readonly string[];
  exclude: readonly string[];
  cap: number | undefined;
  pageCap: number;
  fetchedAtIso: string;
}): Promise<Result<GithubStructures, GithubOrgError>> {
  let listed: PagedList;
  try {
    listed = await listAllRepos({ api, org, pageCap });
  } catch (error: unknown) {
    return err(GithubOrgErrors.repoEnumerationFailed({ cause: error }));
  }
  const orgRaw = await api.getOrg({ org });
  const orgRow = projectOrgRow({ fetchedAtIso, raw: orgRaw });
  const names = listed.items.map((raw) => repoShortName({ raw })).filter((n): n is string => n !== undefined);
  const selection = selectRepoNames({ cap, exclude, include, names });
  const { rows: repoRows, coords } = buildRepoRows({ fetchedAtIso, org, repos: listed.items, selection });
  const teams = await buildTeamRows({ api, fetchedAtIso, org });
  const warnings = [
    ...(orgRow === undefined ? ["github: org info unavailable (orgs.get) — org row skipped"] : []),
    ...ceilingWarnings({ listed, what: "org repo" }),
    ...selection.warnings,
    ...teams.warnings,
  ];
  return ok({
    repos: coords,
    rows: [...(orgRow !== undefined ? [orgRow] : []), ...repoRows, ...teams.rows],
    warnings,
  });
}
