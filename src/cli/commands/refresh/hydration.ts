/**
 * The two hydration lanes that run AFTER activity ingest — members, then structures.
 *
 * Both are WARNING-only by design: they never change the refresh exit code, because a roster or a channel list
 * that failed to refresh does not make the activity records that did land less worth keeping. Both are also
 * no-ops when their seam is not injected, which is how the test decks written before each lane existed keep
 * passing unedited.
 *
 * The `production*` pair is the effectful half — the real token reads and the org-mode selection — kept beside
 * the steps they serve so the shell only has to name them once.
 */

import { githubToken, linearToken, notionToken } from "../../../config.js";
import type { CorpusSource } from "../../../corpus/types.js";
import type { RefreshOptions } from "./core.js";
import type { RefreshDeps } from "./deps.js";
import { githubPageCapOf, resolveGithubOrg } from "./githubJobs.js";
import {
  hydrateOneSource,
  type MemberHydrationResult,
  type MemberTokens,
  summariseMemberHydration,
} from "./members.js";
import {
  hydrateOneSourceStructures,
  type StructureGithubOptions,
  type StructureHydrationResult,
  summariseStructureHydration,
} from "./structures.js";
import { emitSummaryLine } from "./summary.js";
import { slackReadToken } from "./tokens.js";

/**
 * Hydrate each selected source's members after activity ingest, emitting non-blocking `members:<source>`
 * progress and folding the results into the summary. Hydration is WARNING-only — it never changes the
 * refresh exit code. A no-op when the member seam isn't injected (pre-PR4.1 test decks).
 *
 * @param deps the effectful seams
 * @param sources the selected sources, in order
 * @param home the Slopweaver home
 * @param options the parsed refresh options
 * @param fetchedAtIso the run's observation timestamp, stamped on every hydrated row
 */
export async function hydrateMembersStep({
  deps,
  sources,
  home,
  options,
  fetchedAtIso,
}: {
  deps: RefreshDeps;
  sources: readonly CorpusSource[];
  home: string;
  options: RefreshOptions;
  fetchedAtIso: string;
}): Promise<void> {
  if (deps.hydrateMember === undefined) {
    return;
  }
  const results: MemberHydrationResult[] = [];
  for (const [index, source] of sources.entries()) {
    deps.onProgress?.({ done: index, label: source, phase: "members", total: sources.length });
    const org = resolveGithubOrg({ options });
    const result = await deps.hydrateMember({
      fetchedAtIso,
      home,
      source,
      ...(org.isOk() ? { githubOrg: org.value } : {}),
    });
    if (result !== undefined) {
      results.push(result);
    }
    deps.onProgress?.({
      done: index + 1,
      label: source,
      phase: "members",
      total: sources.length,
      ...(result !== undefined ? { written: result.written } : {}),
    });
  }
  for (const line of summariseMemberHydration({ results })) {
    emitSummaryLine({ level: line.level, sink: deps.logger, text: line.text });
  }
}

/**
 * Hydrate each selected source's STRUCTURE after activity + member hydration, emitting non-blocking
 * `structures:<source>` progress and folding the results into the summary. Structural hydration is
 * WARNING-only — it never changes the refresh exit code. A no-op when the seam isn't injected.
 *
 * @param deps the effectful seams
 * @param sources the selected sources, in order
 * @param home the Slopweaver home
 * @param options the parsed refresh options
 * @param fetchedAtIso the run's observation timestamp, stamped on every hydrated row
 */
export async function hydrateStructuresStep({
  deps,
  sources,
  home,
  options,
  fetchedAtIso,
}: {
  deps: RefreshDeps;
  sources: readonly CorpusSource[];
  home: string;
  options: RefreshOptions;
  fetchedAtIso: string;
}): Promise<void> {
  if (deps.hydrateStructure === undefined) {
    return;
  }
  const results: StructureHydrationResult[] = [];
  for (const [index, source] of sources.entries()) {
    deps.onProgress?.({ done: index, label: source, phase: "structures", total: sources.length });
    const result = await deps.hydrateStructure({ fetchedAtIso, home, options, source });
    if (result !== undefined) {
      results.push(result);
    }
    deps.onProgress?.({
      done: index + 1,
      label: source,
      phase: "structures",
      total: sources.length,
      ...(result !== undefined ? { written: result.written } : {}),
    });
  }
  for (const line of summariseStructureHydration({ results })) {
    emitSummaryLine({ level: line.level, sink: deps.logger, text: line.text });
  }
}

/**
 * Production member hydration for ONE source (real token reads + the resolved org).
 *
 * @param source the source to hydrate members for
 * @param home the Slopweaver home
 * @param fetchedAtIso the run's observation timestamp
 * @param githubOrg the org to hydrate members for, already resolved by `resolveGithubOrg`
 * @returns the hydration result, or `undefined` when the source has no member lane
 */
export async function productionHydrateMember({
  source,
  home,
  fetchedAtIso,
  githubOrg,
}: {
  source: CorpusSource;
  home: string;
  fetchedAtIso: string;
  githubOrg?: string;
}): Promise<MemberHydrationResult | undefined> {
  return hydrateOneSource({
    fetchedAtIso,
    home,
    source,
    tokens: allSourceTokens({ home }),
    ...(githubOrg !== undefined ? { githubOrg } : {}),
  });
}

/**
 * Production structural hydration for ONE source (real token reads + the org-mode selection).
 *
 * @param source the source to hydrate structures for
 * @param home the Slopweaver home
 * @param fetchedAtIso the run's observation timestamp
 * @param options the parsed refresh options
 * @returns the hydration result, or `undefined` when the source has no structural lane
 */
export async function productionHydrateStructure({
  source,
  home,
  fetchedAtIso,
  options,
}: {
  source: CorpusSource;
  home: string;
  fetchedAtIso: string;
  options: RefreshOptions;
}): Promise<StructureHydrationResult | undefined> {
  return hydrateOneSourceStructures({
    fetchedAtIso,
    home,
    source,
    tokens: allSourceTokens({ home }),
    ...githubStructureOptions({ options }),
    ...(options.slackMembershipCap !== undefined ? { slackMembershipCap: options.slackMembershipCap } : {}),
  });
}

/**
 * All four sources' tokens (present ones only) — the member/structure hydration lanes' token bag.
 *
 * GitHub resolves from THIS run's `home`, so a `--home B` hydration reads B's secrets rather than the
 * ambient home's. The other three are left on the ambient home ON PURPOSE: the missing-token gate and the
 * job planner resolve them there (`resolveTokens`/`slackReadToken` in `./tokens.ts`, reached through
 * `./deps.ts`), and a hydration lane reading B while the crawl read A would run one source under two
 * credentials. Scoping that contract is its own change.
 */
function allSourceTokens({ home }: { home: string }): MemberTokens {
  const github = githubToken({ home });
  const linear = linearToken();
  const notion = notionToken();
  const slack = slackReadToken().token;
  return {
    ...(github !== undefined ? { github } : {}),
    ...(linear !== undefined ? { linear } : {}),
    ...(notion !== undefined ? { notion } : {}),
    ...(slack !== undefined ? { slack } : {}),
  };
}

/** The GitHub structural selection (only in org mode, when the org resolves) — else no GitHub structure. */
function githubStructureOptions({ options }: { options: RefreshOptions }): { github?: StructureGithubOptions } {
  if (!options.allRepos) {
    return {};
  }
  const org = resolveGithubOrg({ options });
  if (org.isErr()) {
    return {};
  }
  return {
    github: {
      excludeRepos: options.excludeRepos,
      includeRepos: options.includeRepos,
      org: org.value,
      pageCap: githubPageCapOf({ options }),
      ...(options.repoCap !== undefined ? { repoCap: options.repoCap } : {}),
    },
  };
}
