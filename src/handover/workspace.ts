/**
 * `workspace:` — which of the two workspaces a board row's WORK belongs to, stated by whoever wrote the row.
 *
 * The two are ROLES, never names: `team` is the organisation's work, `self` is this installation's own engineering.
 * The split is the tool's own design, so it lives in code; whose organisation the team is lives in the home.
 *
 * Distinct from `repo:` on purpose, and the distinction is the fix this field exists for. `repo:` is the checkout
 * `cmux spawn` cuts a worktree from, which is where a session RUNS — and every fleet session runs in the
 * Slopweaver checkout, because that is where the verbs live. So a team ISO ask carried `repo: …/slopweaver`
 * and the console drew it on the Slopweaver page, where team work does not belong. `workspace:` says whose the work is; the console reads it beside the row's pull
 * requests and Slack destinations, and a row that states none and names none is a finding, never a default.
 *
 * Set on an existing row with `slopweaver handover set-workspace`, which writes the judgement beside its reason.
 *
 * Every reader that places by the organisation's own names takes the `Organisation` its caller read once from the
 * store (`../organisation/read.ts`); no organisation name is a constant here.
 */

import type { Organisation } from "../organisation/core.js";

/** The two workspaces, in the words a doc's front matter uses. */
export const WORKSPACES = ["team", "self"] as const;

/** One of {@link WORKSPACES}. */
export type Workspace = (typeof WORKSPACES)[number];

/**
 * Whether a string is one of {@link WORKSPACES}.
 *
 * @returns true for a real workspace
 */
export function isWorkspace(value: unknown): value is Workspace {
  return typeof value === "string" && (WORKSPACES as readonly string[]).includes(value);
}

/**
 * The spelling a doc written before the workspace became a role still carries, read as the workspace it now is. The
 * home is shared by every checkout and its docs outlive the rename, so a reader that refused the old word would make
 * an open row malformed — unstartable, and unrepairable by `handover set-workspace`, which refuses a doc with a
 * problem. Writers never emit it: `handover register` (and `talk relay`, through it) READS one as its role, because
 * a console built before the rename still sends the old word for the seconds its rebuilt replacement takes to serve,
 * and writes the role; `set-workspace` accepts only {@link WORKSPACES}; and `handover set-workspace --respell`
 * rewrites every row still carrying one.
 */
const WORKSPACE_ALIASES: ReadonlyMap<string, Workspace> = new Map([
  ["acme", "team"],
  ["slopweaver", "self"],
]);

/**
 * The workspace a `workspace:` line or a registration's `--workspace` names, an alias included.
 *
 * @param declared the value as written
 * @returns the workspace, or `undefined` for a value that names none
 */
export function declaredWorkspace({ declared }: { declared: string }): Workspace | undefined {
  if (isWorkspace(declared)) {
    return declared;
  }
  return WORKSPACE_ALIASES.get(declared);
}

/**
 * The front-matter problem a misspelt `workspace:` line raises, or none.
 *
 * A problem rather than an absence: `workspace: taem` read as "states nothing" would put the row back on
 * whatever its other fields say, which is the silent substitution this field exists to end.
 *
 * @param declared the `workspace:` line as written, when the doc has one
 * @returns the problem sentences, empty when the line is absent or names a real workspace
 */
export function workspaceProblems({ declared }: { declared: string | undefined }): readonly string[] {
  if (declared === undefined || declaredWorkspace({ declared }) !== undefined) {
    return [];
  }
  return [`workspace must be one of ${WORKSPACES.join("|")}, got ${JSON.stringify(declared)}`];
}

/**
 * The `workspace` field a parsed doc carries — present only when the line names a real workspace — and, for a
 * misspelt line, the words it holds. The board publishes a doc beside its problems, so without them a misspelt line
 * reads downstream as a row stating nothing, and its other evidence places it silently. A doc declaring
 * `workspace:` twice is unread the same way: the flat reader keeps only the first line, so publishing it would place
 * the row by whichever line came first. A line in an alias spelling also carries that spelling as
 * `workspaceAlias`, so `handover set-workspace` rewrites it rather than reading it as already stated.
 *
 * @param declared the `workspace:` line as written, when the doc has one — the first, when it has two
 * @param twice whether the doc declares `workspace:` more than once
 * @returns an object to spread into the doc: `workspace` for a real one, `workspaceUnread` for a misspelt or
 *   repeated one, `workspaceAlias` beside `workspace` for a line in an alias spelling
 */
export function workspaceField({ declared, twice }: { declared: string | undefined; twice: boolean }): {
  readonly workspace?: Workspace;
  readonly workspaceUnread?: string;
  readonly workspaceAlias?: string;
} {
  if (declared === undefined) {
    return {};
  }
  if (twice) {
    return { workspaceUnread: `${declared}, then another workspace: line` };
  }
  const workspace = declaredWorkspace({ declared });
  if (workspace === undefined) {
    return { workspaceUnread: declared };
  }
  if (!isWorkspace(declared)) {
    return { workspace, workspaceAlias: declared };
  }
  return { workspace };
}

/** A stated workspace and the one line saying why — the pair `handover set-workspace` and `handover register` write. */
export interface StatedWorkspace {
  readonly workspace: Workspace;
  readonly because: string;
}

/** An exact `owner/repo`, nothing before or after it. */
const SLUG = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;

/**
 * Whose work something in a repository is, by the rule the console places a pull request by
 * (`site/lib/workspacePlacement.ts` § `repositoryEvidence`, which `src/` cannot import): this build's own repository
 * (`organisation.selfRepository`, read off its origin) is `self`, every repository under the organisation's GitHub
 * owner is `team`. A value that is not an exact `owner/repo`, or a repository outside the organisation, names
 * neither — a caller holding one says so and states nothing, rather than reading "not Slopweaver" as the team's.
 *
 * @param organisation the organisation, read once by the caller's edge (`../organisation/read.ts`)
 * @param repository the `owner/repo` the work is in
 * @returns the workspace, or `undefined` when the value names no organisation repository
 */
export function workspaceOfRepository({
  organisation,
  repository,
}: {
  organisation: Organisation;
  repository: string;
}): Workspace | undefined {
  const slug = SLUG.exec(repository);
  if (slug === null) {
    return undefined;
  }
  // A clone address's `.git` is dropped, as the console drops it: GitHub gives no repository a name ending `.git`
  // `.` and `..` match the name class and are no repository's name.
  const owner = slug[1]!.toLowerCase();
  const name = slug[2]!.toLowerCase().replace(/\.git$/, "");
  if (/^\.*$/.test(name)) {
    return undefined;
  }
  if (`${owner}/${name}` === organisation.selfRepository) {
    return "self";
  }
  return owner === organisation.githubOwner ? "team" : undefined;
}

/**
 * The statement a row about one repository's pull request makes — the workspace {@link workspaceOfRepository} reads,
 * and a reason naming the repository so the row says what placed it.
 *
 * @param organisation the organisation, read once by the caller's edge
 * @param repository the `owner/repo` the row's pull request is in
 * @param what the noun the reason opens on — "the landing dispatch's pull request", say
 * @returns the statement, or `undefined` when the repository names no organisation repository
 */
export function repositoryWorkspace({
  organisation,
  repository,
  what,
}: {
  organisation: Organisation;
  repository: string;
  what: string;
}): StatedWorkspace | undefined {
  const workspace = workspaceOfRepository({ organisation, repository });
  if (workspace === undefined) {
    return undefined;
  }
  return { because: `${what} is in ${repository.toLowerCase()}`, workspace };
}

/**
 * The statement a row about something read from one connected Google account makes — a mailbox, a calendar. An
 * account on the organisation's Google domain is the team's; any other address — a personal account connected
 * instead — names neither, so the caller states nothing. An organisation written with no Google domain
 * (`org set --without-google`) places no account at all.
 *
 * @param organisation the organisation, read once by the caller's edge
 * @param account the address the grant is bound to
 * @param what the noun the reason opens on — "the Gemini notes mail of a meeting", say
 * @returns the statement, or `undefined` when the account is not on the organisation's domain
 */
export function accountWorkspace({
  organisation,
  account,
  what,
}: {
  organisation: Organisation;
  account: string;
  what: string;
}): StatedWorkspace | undefined {
  const domain = organisation.googleDomain;
  // Exactly one address: one `@`, a non-empty local part, and the organisation's domain after it.
  const address = /^[^@\s]+@([^@\s]+)$/.exec(account);
  if (domain === null || address === null || address[1]!.toLowerCase() !== domain) {
    return undefined;
  }
  return {
    because: `${what} is in ${account.toLowerCase()}, an account on ${domain}`,
    workspace: "team",
  };
}

/**
 * The statement a row about one Slack conversation makes, read off its permalink's host: a conversation in the
 * organisation's Slack (`organisation.slackHosts`, the hosts `site/lib/workspacePlacement.ts` places a permalink by)
 * is the team's, and one in any other workspace — or a value that is no URL — names neither.
 *
 * @param organisation the organisation, read once by the caller's edge
 * @param permalink the conversation's own link
 * @param what the noun the reason opens on — "a live incident", say
 * @returns the statement, or `undefined` when the permalink is not on the organisation's Slack
 */
export function slackWorkspace({
  organisation,
  permalink,
  what,
}: {
  organisation: Organisation;
  permalink: string;
  what: string;
}): StatedWorkspace | undefined {
  if (!URL.canParse(permalink)) {
    return undefined;
  }
  const url = new URL(permalink);
  if (url.protocol !== "https:" || !organisation.slackHosts.includes(url.hostname)) {
    return undefined;
  }
  return { because: `${what} is in ${url.hostname}, the organisation's Slack`, workspace: "team" };
}

/**
 * The `handover register` flags a row about one repository's pull request passes — none for a repository outside the
 * organisation, which leaves the row placed by its own fields or shown as a finding, never guessed.
 *
 * @param organisation the organisation, read once by the caller's edge
 * @param repository the `owner/repo` the row's pull request is in
 * @param what the noun the reason opens on
 * @returns the flags, or none
 */
export function repositoryWorkspaceArgv({
  organisation,
  repository,
  what,
}: {
  organisation: Organisation;
  repository: string;
  what: string;
}): readonly string[] {
  return workspaceRegisterArgv({ stated: repositoryWorkspace({ organisation, repository, what }) });
}

/**
 * The `handover register` flags stating a workspace — the one spelling every verb that registers rows passes.
 *
 * @param stated the statement, or `undefined` when the caller cannot know whose work the row is
 * @returns `--workspace <w> --workspace-because <why>`, or no flags at all for no statement
 */
export function workspaceRegisterArgv({ stated }: { stated: StatedWorkspace | undefined }): readonly string[] {
  if (stated === undefined) {
    return [];
  }
  return ["--workspace", stated.workspace, "--workspace-because", stated.because];
}
