/**
 * The GitHub curated-knowledge lane (PR4.3): the deliberately-authored planning + ownership artefacts —
 * **discussions** (GraphQL), **releases** + **milestones** (REST), and **CODEOWNERS** (repo content) —
 * gathered for one repo, the raw payloads handed to the shapers in `./curated.ts`, with milestone→issue
 * numbers attached. Every sub-lane is BEST-EFFORT: discussions may be disabled, a repo may have no CODEOWNERS, so a
 * failure warns + skips rather than sinking the pass. Projects v2 is noted as a follow-on (heavy GraphQL,
 * frequently empty) and deliberately not built here — see the PR notes.
 *
 * The GraphQL/REST boundary is an INJECTED seam ({@link GithubCuratedApi}); production wires it to the
 * resilient octokit client (retry + throttle plugins) via {@link makeGithubCuratedApi}. The shapers +
 * projectors in `./curated.ts` are pure and unit-tested with fixtures.
 */
import type { Repository } from "../../config.js";
import { errorStatus, ingestErrorToThrowable } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import {
  type GithubCuratedItems,
  type GithubDiscussionItem,
  type GithubMilestoneItem,
  type GithubReleaseItem,
  issueNumbersOf,
  parseCodeowners,
  parseDiscussionNode,
  parseMilestoneNode,
  parseReleaseNode,
} from "./curated.js";
import { type GithubClient, githubScopeId, makeGithubClient } from "./githubClient.js";

const PER_PAGE = 100;
const DISCUSSIONS_PER_PAGE = 50;

/** The raw content + path of a discovered CODEOWNERS file. */
interface GithubCodeownersRaw {
  readonly content: string;
  readonly path: string;
}

/**
 * The injected GitHub curated seam. Each method returns raw payloads (the shell shapes them); production
 * wires them to the resilient octokit client. Kept small so each can be safe-wrapped in isolation.
 */
export interface GithubCuratedApi {
  discussions: (args: { repo: Repository }) => Promise<readonly unknown[]>;
  releases: (args: { repo: Repository }) => Promise<readonly unknown[]>;
  milestones: (args: { repo: Repository }) => Promise<readonly unknown[]>;
  milestoneIssues: (args: { repo: Repository; milestone: number }) => Promise<readonly unknown[]>;
  codeowners: (args: { repo: Repository }) => Promise<GithubCodeownersRaw | undefined>;
}

/** Run one best-effort lane: on failure, push a warning + return the fallback (never throws). */
async function bestEffort<T>({
  run,
  label,
  warnings,
  fallback,
}: {
  run: () => Promise<T>;
  label: string;
  warnings: string[];
  fallback: T;
}): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    warnings.push(`github ${label} skipped: ${error instanceof Error ? error.message : "unknown"}`);
    return fallback;
  }
}

/** Fetch milestone items, attaching each milestone's grouped issue/PR numbers (best-effort per milestone). */
async function fetchMilestones({
  api,
  repo,
  warnings,
}: {
  api: GithubCuratedApi;
  repo: Repository;
  warnings: string[];
}): Promise<readonly GithubMilestoneItem[]> {
  const raw = await bestEffort({
    fallback: [] as readonly unknown[],
    label: "milestones",
    run: () => api.milestones({ repo }),
    warnings,
  });
  const milestones: GithubMilestoneItem[] = [];
  for (const node of raw) {
    const base = parseMilestoneNode({ raw: node });
    if (base === undefined) {
      continue;
    }
    const issues = await bestEffort({
      fallback: [] as readonly unknown[],
      label: `milestone ${String(base.number)} issues`,
      run: () => api.milestoneIssues({ milestone: base.number, repo }),
      warnings,
    });
    milestones.push({ ...base, issueNumbers: issueNumbersOf({ raw: issues }) });
  }
  return milestones;
}

/**
 * Gather every curated GitHub surface for one repo, best-effort (a disabled/absent lane warns + skips).
 *
 * @param api the injected curated seam
 * @param repo the repository coordinate
 * @returns the gathered curated surfaces + any per-lane warnings
 */
export async function fetchGithubCurated({
  api,
  repo,
}: {
  api: GithubCuratedApi;
  repo: Repository;
}): Promise<{ items: GithubCuratedItems; warnings: readonly string[] }> {
  const warnings: string[] = [];
  const discussionsRaw = await bestEffort({
    fallback: [] as readonly unknown[],
    label: "discussions",
    run: () => api.discussions({ repo }),
    warnings,
  });
  const releasesRaw = await bestEffort({
    fallback: [] as readonly unknown[],
    label: "releases",
    run: () => api.releases({ repo }),
    warnings,
  });
  const milestones = await fetchMilestones({ api, repo, warnings });
  const codeownersRaw = await bestEffort({
    fallback: undefined,
    label: "codeowners",
    run: () => api.codeowners({ repo }),
    warnings,
  });
  const items: GithubCuratedItems = {
    discussions: discussionsRaw
      .map((node) => parseDiscussionNode({ node }))
      .filter((d): d is GithubDiscussionItem => d !== undefined),
    milestones,
    releases: releasesRaw
      .map((raw) => parseReleaseNode({ raw }))
      .filter((r): r is GithubReleaseItem => r !== undefined),
    ...(codeownersRaw !== undefined
      ? { codeowners: parseCodeowners({ content: codeownersRaw.content, path: codeownersRaw.path }) }
      : {}),
  };
  return { items, warnings };
}

const DISCUSSIONS_QUERY = `
query Discussions($owner: String!, $repo: String!, $after: String) {
  repository(owner: $owner, name: $repo) {
    discussions(first: ${String(DISCUSSIONS_PER_PAGE)}, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number title body url updatedAt author { login } category { name } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/** The candidate CODEOWNERS locations, in GitHub's documented precedence. */
const CODEOWNERS_PATHS: readonly string[] = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

/** Fetch every discussion node via GraphQL, paged to exhaustion (safe-wrapped). */
async function discussionsLive({
  client,
  scopeId,
  repo,
}: {
  client: GithubClient;
  scopeId: string;
  repo: Repository;
}): Promise<readonly unknown[]> {
  const nodes: unknown[] = [];
  let after: string | undefined;
  for (;;) {
    const data = orThrow({
      result: await safeProviderCall({
        execute: () => client.graphql(DISCUSSIONS_QUERY, { after, owner: repo.owner, repo: repo.repo }),
        operation: "github.graphql.discussions",
        provider: "github",
        retryMode: "never",
        scopeId,
      }),
    });
    const connection = isRecord(data) && isRecord(data["repository"]) ? data["repository"]["discussions"] : undefined;
    const page = isRecord(connection) && Array.isArray(connection["nodes"]) ? connection["nodes"] : [];
    nodes.push(...page);
    const next = connectionNextCursor({ connection });
    if (next === undefined) {
      return nodes;
    }
    after = next;
  }
}

/** The `endCursor` of a GraphQL connection when it has a next page, else undefined. Pure. */
function connectionNextCursor({ connection }: { connection: unknown }): string | undefined {
  const info = isRecord(connection) && isRecord(connection["pageInfo"]) ? connection["pageInfo"] : undefined;
  const endCursor = info?.["endCursor"];
  return info?.["hasNextPage"] === true && typeof endCursor === "string" ? endCursor : undefined;
}

/**
 * Fetch the repo's CODEOWNERS from its first present location, or undefined when genuinely absent. A 404
 * for a path means "not here" — try the next; ANY OTHER error (403 permissions, 5xx, network) is thrown so
 * the caller's best-effort wrapper turns it into a warning rather than silently conflating failure with
 * absence.
 */
async function codeownersLive({
  client,
  scopeId,
  repo,
}: {
  client: GithubClient;
  scopeId: string;
  repo: Repository;
}): Promise<GithubCodeownersRaw | undefined> {
  for (const path of CODEOWNERS_PATHS) {
    const res = await safeProviderCall({
      execute: () => client.rest.repos.getContent({ owner: repo.owner, path, repo: repo.repo }),
      operation: "github.repos.getContent",
      provider: "github",
      retryMode: "never",
      scopeId,
    });
    if (res.isErr()) {
      if (errorStatus({ error: res.error }) === 404) {
        continue; // this path has no CODEOWNERS — try the next documented location
      }
      throw ingestErrorToThrowable({ error: res.error }); // a real failure — surfaced as a warning upstream
    }
    const data: unknown = res.value.data;
    if (isRecord(data) && data["encoding"] === "base64" && typeof data["content"] === "string") {
      return { content: Buffer.from(data["content"], "base64").toString("utf8"), path };
    }
  }
  return undefined;
}

/**
 * Build the production GitHub curated seam over a resilient octokit client. Discussions via GraphQL;
 * releases/milestones/milestone-issues via REST pagination; CODEOWNERS via repo content. Every SDK call is
 * routed through a `safe*` wrapper.
 *
 * @param token the GitHub token
 * @returns the live curated seam
 */
export function makeGithubCuratedApi({ token }: { token: string | undefined }): GithubCuratedApi {
  const client = makeGithubClient({ token });
  const scopeId = githubScopeId({ token });
  return {
    codeowners: ({ repo }) => codeownersLive({ client, repo, scopeId }),
    discussions: ({ repo }) => discussionsLive({ client, repo, scopeId }),
    milestoneIssues: async ({ repo, milestone }) =>
      orThrow({
        result: await safeProviderCall({
          execute: () =>
            client.rest.issues.listForRepo({
              milestone: String(milestone),
              owner: repo.owner,
              per_page: PER_PAGE,
              repo: repo.repo,
              state: "all",
            }),
          operation: "github.issues.listForRepo",
          provider: "github",
          retryMode: "never",
          scopeId,
        }),
      }).data,
    milestones: async ({ repo }) =>
      orThrow({
        result: await safeProviderCall({
          execute: () =>
            client.rest.issues.listMilestones({ owner: repo.owner, per_page: PER_PAGE, repo: repo.repo, state: "all" }),
          operation: "github.issues.listMilestones",
          provider: "github",
          retryMode: "never",
          scopeId,
        }),
      }).data,
    releases: async ({ repo }) =>
      orThrow({
        result: await safeProviderCall({
          execute: () => client.rest.repos.listReleases({ owner: repo.owner, per_page: PER_PAGE, repo: repo.repo }),
          operation: "github.repos.listReleases",
          provider: "github",
          retryMode: "never",
          scopeId,
        }),
      }).data,
  };
}
