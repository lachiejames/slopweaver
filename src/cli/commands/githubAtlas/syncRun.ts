/**
 * `slopweaver atlas github sync [--orgs <login,...>] [--repos <owner/repo,...>]` — read GitHub's
 * configuration through the closed inventory and publish one generation.
 *
 * The sync, the projections and the merge are the domain's (`atlas/github/`) and every one of them is
 * written against the client SEAM, so all of them are settled by unit tests over a fake. What is here is
 * the effects: resolving the token, compiling the offline API surface, and enumerating the scopes.
 *
 * ## The scopes are enumerated HERE and stated, never capped silently
 *
 * With no `--orgs`, the organisations are every one the token can see. With no `--repos`, the repositories
 * are every one of those organisations' — enumerated to the end of paging, and a listing that could not be
 * finished FAILS the sync rather than covering a subset. That is the opposite of
 * `src/corpus/github/orgApi.ts`, which stops after twenty pages and returns no truncation flag at all, so a
 * caller cannot tell a complete enumeration from a clipped one. An atlas that inherited that would publish
 * a generation claiming to cover an organisation it had only partly walked.
 */
import { type GithubAtlasApi, makeGithubAtlasApi } from "../../../atlas/github/client.js";
import { githubCallById } from "../../../atlas/github/inventory.js";
import { type GithubCall, githubCallRoute } from "../../../atlas/github/inventoryShape.js";
import type { GithubEntity } from "../../../atlas/github/kindFiles.js";
import { declaredSdkMethod, projectGithubRestOperation } from "../../../atlas/github/projection.js";
import { githubAtlasPaths } from "../../../atlas/github/store.js";
import { syncGithubAtlas } from "../../../atlas/github/sync.js";
import { githubToken } from "../../../config.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import {
  exitCodeForGithubSync,
  GITHUB_SYNC_USAGE,
  type GithubSyncOptions,
  parseGithubSyncOptions,
  renderGithubSync,
} from "../atlas/githubCore.js";
import { type GithubAtlasVerbError, GithubAtlasVerbErrors, githubAtlasVerbErrorLines } from "./errors.js";
import { type CompiledRestSurface, compileGithubRestSurface } from "./restSurfaceRun.js";

/** Where the verb sits: past the runtime, the script, the `atlas` noun, the `github` platform and `sync`. */
const VERB_DEPTH = 5;

/** What an enumeration answers: the logins or coordinates it found, or why it could not be finished. */
type Listing = Result<readonly string[], GithubAtlasVerbError>;

/**
 * Enumerate the organisations and repositories this run covers.
 *
 * @param api the bound seam
 * @param organisations the `--orgs` entries, empty to enumerate every organisation the token can see
 * @param repositories the `--repos` entries, empty to enumerate every repository of those organisations
 * @returns the scopes, or why enumeration could not be completed
 */
async function resolveScopes({
  api,
  organisations,
  repositories,
}: {
  api: GithubAtlasApi;
  organisations: readonly string[];
  repositories: readonly string[];
}): Promise<Result<{ organisations: readonly string[]; repositories: readonly string[] }, GithubAtlasVerbError>> {
  const orgs = organisations.length > 0 ? ok(organisations) : await enumerateOrganisations({ api });
  if (orgs.isErr()) {
    return err(orgs.error);
  }
  if (repositories.length > 0) {
    return ok({ organisations: orgs.value, repositories });
  }
  const repos = await enumerateRepositories({ api, organisations: orgs.value });
  return repos.isErr() ? err(repos.error) : ok({ organisations: orgs.value, repositories: repos.value });
}

/**
 * Project the compiled OpenAPI routes into stored operations.
 *
 * @param compiled what the offline compile produced
 * @param at this run's ISO timestamp
 * @returns one entity per declared route
 *
 * @internal
 */
export function projectCompiledGithubOperations({
  compiled,
  at,
}: {
  compiled: CompiledRestSurface;
  at: string;
}): readonly GithubEntity[] {
  const context = {
    at,
    source: { endpoint: "@octokit/openapi-types", observedAt: at, surface: "rest-openapi" as const },
  };
  return compiled.routes.map((route) =>
    projectGithubRestOperation({
      context,
      route,
      sdkMethod: declaredSdkMethod({ route: route.route, sdkMethods: compiled.sdkMethodByRoute }),
    }),
  );
}

/**
 * Write every line of a refusal to the diagnostic channel, so `--json` stdout stays pristine.
 *
 * @param problems the refusal's own words
 * @returns the process exit code, so a caller can `return reportProblems(...)`
 */
function reportProblems({ problems }: { problems: readonly string[] }): number {
  for (const line of problems) {
    process.stderr.write(`${line}\n`);
  }
  return EXIT_ERROR;
}

/**
 * Compile, enumerate, read and publish — the sync's whole body, past the argument parse.
 *
 * @param options the parsed invocation
 * @returns the process exit code
 */
async function runSync({ options }: { options: GithubSyncOptions }): Promise<number> {
  const { home, json } = options;
  const compiled = compileGithubRestSurface();
  if (compiled.isErr()) {
    return reportProblems({ problems: githubAtlasVerbErrorLines({ error: compiled.error }) });
  }
  const at = new Date().toISOString();
  const api = makeGithubAtlasApi({ token: githubToken({ home }) });
  const scopes = await resolveScopes({ api, ...options });
  if (scopes.isErr()) {
    return reportProblems({ problems: githubAtlasVerbErrorLines({ error: scopes.error }) });
  }
  const synced = await syncGithubAtlas({
    api,
    at,
    paths: githubAtlasPaths({ home }),
    restOperations: projectCompiledGithubOperations({ at, compiled: compiled.value }),
    scopes: scopes.value,
    ...(json
      ? {}
      : {
          progress: ({ line }: { line: string }): void => {
            process.stderr.write(`${line}\n`);
          },
        }),
  });
  if (synced.isErr()) {
    return reportProblems({ problems: synced.error });
  }
  for (const line of json
    ? [JSON.stringify({ ...synced.value, descriptionVersion: compiled.value.descriptionVersion })]
    : renderGithubSync({ summary: synced.value })) {
    logger.out({ line });
  }
  return exitCodeForGithubSync({ summary: synced.value });
}

/**
 * Every organisation this token can see.
 *
 * @param api the bound seam
 * @returns the logins, or why the enumeration could not be completed
 */
async function enumerateOrganisations({ api }: { api: GithubAtlasApi }): Promise<Listing> {
  const call = githubCallById({ id: "account-organisations" });
  const read = await api.read({
    paged: call.paging === "page",
    route: githubCallRoute({ call, scopeRef: "" }) ?? call.path,
  });
  if (read.isErr()) {
    return err(GithubAtlasVerbErrors.organisationsUnenumerated({ cause: read.error }));
  }
  return ok(
    read.value.records.flatMap((record: unknown): readonly string[] => {
      const login = isRecord(record) ? record["login"] : undefined;
      return typeof login === "string" && login.length > 0 ? [login] : [];
    }),
  );
}

/**
 * Every repository of ONE organisation, enumerated to the end of paging.
 *
 * @param api the bound seam
 * @param call the admitted listing call
 * @param org the organisation login
 * @returns its `owner/repo` coordinates, or why the enumeration could not be completed
 */
async function listOneOrganisation({
  api,
  call,
  org,
}: {
  api: GithubAtlasApi;
  call: GithubCall;
  org: string;
}): Promise<Listing> {
  const route = githubCallRoute({ call, scopeRef: org });
  if (route === null) {
    return err(GithubAtlasVerbErrors.listingRouteUnbuildable({ org }));
  }
  const read = await api.read({ paged: call.paging === "page", route });
  if (read.isErr()) {
    return err(GithubAtlasVerbErrors.repositoriesUnenumerated({ cause: read.error, org }));
  }
  return ok(
    read.value.records.flatMap((record: unknown): readonly string[] => {
      const name = isRecord(record) ? record["full_name"] : undefined;
      return typeof name === "string" && name.includes("/") ? [name] : [];
    }),
  );
}

/**
 * Every repository of the given organisations, enumerated to the end of paging.
 *
 * A listing that could not be finished FAILS rather than covering a subset. That is the opposite of
 * `src/corpus/github/orgApi.ts`, which stops after twenty pages and returns no truncation flag — an atlas that
 * inherited that would publish a generation claiming to cover an organisation it had only partly walked.
 *
 * @param api the bound seam
 * @param organisations the logins to enumerate
 * @returns the `owner/repo` coordinates, sorted, or why the enumeration could not be completed
 */
async function enumerateRepositories({
  api,
  organisations,
}: {
  api: GithubAtlasApi;
  organisations: readonly string[];
}): Promise<Listing> {
  const call = githubCallById({ id: "org-repositories" });
  const repos: string[] = [];
  for (const org of organisations) {
    const listed = await listOneOrganisation({ api, call, org });
    if (listed.isErr()) {
      return err(listed.error);
    }
    repos.push(...listed.value);
  }
  return ok(repos.toSorted());
}

/** `slopweaver atlas github sync` — read the configuration surface and publish a generation. */
export const githubAtlasSyncCommand = defineCommand({
  run: async (argv: readonly string[]): Promise<number> => {
    const options = parseGithubSyncOptions({
      defaultHome: slopweaverHome(),
      rest: verbTail({ argv, at: VERB_DEPTH, verbs: ["sync"] }),
    });
    if (options.isErr()) {
      for (const line of options.error) {
        process.stderr.write(`${line}\n`);
      }
      process.stderr.write(`${GITHUB_SYNC_USAGE}\n`);
      return EXIT_USAGE;
    }
    return runSync({ options: options.value });
  },
});
