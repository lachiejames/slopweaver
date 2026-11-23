/**
 * The structural-hydration edge of `refresh`: after activity ingest + member hydration, capture each selected
 * source's ORG GRAPH (org/team/repo/channel/usergroup/workflow-state/cycle/data-source) into structure bronze.
 * Read-only + additive, exactly like member hydration: a failure is WARNING-only — it never flips the refresh
 * exit code — so a capability/scope gap (no `read:org`, a thin Notion teamspace) degrades gracefully. GitHub
 * structural capture is gated on ORG MODE (`--all-repos`): it enumerates org repos + teams, so it stays opt-in
 * rather than firing an expensive teams sweep on a bare single-repo refresh. `derive` then surfaces the graph.
 */
import { fetchGithubStructures } from "../../../corpus/github/org.js";
import { makeGithubOrgApi } from "../../../corpus/github/orgApi.js";
import { fetchLinearReferences } from "../../../corpus/linear/references.js";
import { fetchLinearStructures } from "../../../corpus/linear/structures.js";
import { sharedLinearTransport } from "../../../corpus/linear/transport.js";
import { fetchNotionStructures, makeNotionStructuresApi } from "../../../corpus/notion/structures.js";
import { fetchSlackStructures, makeSlackStructuresApi } from "../../../corpus/slack/structures.js";
import { writeStructureRows } from "../../../corpus/structures/store.js";
import type { StructureBronzeRow } from "../../../corpus/structures/types.js";
import type { CorpusSource } from "../../../corpus/types.js";
import type { Result } from "../../../lib/result.js";
import type { IdentitySource } from "../../../silver/identity.js";
import type { RefreshSummaryLine } from "./core.js";
import type { MemberTokens } from "./members.js";

/** One source's structural-hydration outcome (folded into the refresh summary, never the exit code). */
export interface StructureHydrationResult {
  readonly source: IdentitySource;
  readonly ok: boolean;
  readonly hydrated: number;
  readonly written: number;
  readonly deduped: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/** The GitHub org-mode selection knobs the structural lane needs (mirrors the activity fan-out). */
export interface StructureGithubOptions {
  readonly org: string;
  readonly includeRepos: readonly string[];
  readonly excludeRepos: readonly string[];
  readonly repoCap?: number;
  readonly pageCap: number;
}

/** A fetched structural result the persist step consumes. */
type FetchedStructures = Result<{ rows: readonly StructureBronzeRow[]; warnings: readonly string[] }>;

/** Write a source's fetched structures to structure bronze, folding the counts + warnings into a result. */
function persist({
  source,
  fetched,
  home,
}: {
  source: IdentitySource;
  fetched: FetchedStructures;
  home: string;
}): StructureHydrationResult {
  if (fetched.isErr()) {
    return { deduped: 0, errors: fetched.error, hydrated: 0, ok: false, source, warnings: [], written: 0 };
  }
  const { rows, warnings } = fetched.value;
  const wrote = writeStructureRows({ home, rows, source });
  if (wrote.isErr()) {
    return { deduped: 0, errors: wrote.error, hydrated: rows.length, ok: false, source, warnings, written: 0 };
  }
  return {
    deduped: wrote.value.deduped,
    errors: [],
    hydrated: rows.length,
    ok: true,
    source,
    warnings,
    written: wrote.value.written,
  };
}

/**
 * Hydrate ONE source's structure over its live seam (undefined ⇒ not hydratable: no token, or GitHub without
 * org mode). Effectful — the injected connector seams do the network.
 *
 * @param source the source to hydrate
 * @param home the Slopweaver home
 * @param fetchedAtIso the hydration timestamp
 * @param tokens the per-source tokens
 * @param github the GitHub org-mode selection (present only in org mode)
 * @param slackMembershipCap the Slack channel-membership cap; omitted (the default) resolves every active
 *   channel — see `planChannelMembership` for what that costs
 * @returns the hydration result, or `undefined` when the source isn't hydratable
 */
export async function hydrateOneSourceStructures({
  source,
  home,
  fetchedAtIso,
  tokens,
  github,
  slackMembershipCap,
}: {
  source: CorpusSource;
  home: string;
  fetchedAtIso: string;
  tokens: MemberTokens;
  github?: StructureGithubOptions;
  slackMembershipCap?: number;
}): Promise<StructureHydrationResult | undefined> {
  if (source === "slack" && tokens.slack !== undefined) {
    const fetched = await fetchSlackStructures({
      api: makeSlackStructuresApi({ token: tokens.slack }),
      fetchedAtIso,
      ...(slackMembershipCap !== undefined ? { membershipCap: slackMembershipCap } : {}),
    });
    return persist({ fetched, home, source });
  }
  if (source === "linear" && tokens.linear !== undefined) {
    const request = sharedLinearTransport({ token: tokens.linear }).request;
    // The reference pass first: this lane's label and saved-view projectors read NAMES off references that
    // `@linear/sdk`'s fragments carry as bare ids. See `corpus/linear/references.ts`.
    const referenced = await fetchLinearReferences({ request });
    const fetched = await fetchLinearStructures({
      fetchedAtIso,
      references: referenced.references,
      request,
    });
    return persist({ fetched: fetched.mapErr((error) => [error.message]), home, source });
  }
  if (source === "notion" && tokens.notion !== undefined) {
    const fetched = (
      await fetchNotionStructures({
        api: makeNotionStructuresApi({ token: tokens.notion }),
        fetchedAtIso,
      })
    ).mapErr((error) => [error.message]);
    return persist({ fetched, home, source });
  }
  if (source === "github" && github !== undefined) {
    const fetched = (
      await fetchGithubStructures({
        api: makeGithubOrgApi({ pageCap: github.pageCap, token: tokens.github }),
        cap: github.repoCap,
        exclude: github.excludeRepos,
        fetchedAtIso,
        include: github.includeRepos,
        org: github.org,
        pageCap: github.pageCap,
      })
    ).mapErr((error) => [error.message]);
    return persist({ fetched, home, source });
  }
  return undefined;
}

/**
 * The structural-hydration summary lines (WARN for failures/warnings, OUT for successes) — structural
 * hydration never fails the verb, so nothing here is an `error` level. Pure.
 *
 * @param results the per-source structural-hydration results
 * @returns the ordered summary lines
 */
export function summariseStructureHydration({
  results,
}: {
  results: readonly StructureHydrationResult[];
}): readonly RefreshSummaryLine[] {
  const lines: RefreshSummaryLine[] = [];
  for (const result of results) {
    for (const warning of result.warnings) {
      lines.push({ level: "warn", text: `  structures ${result.source}: ${warning}` });
    }
    if (result.ok === false) {
      for (const error of result.errors) {
        lines.push({ level: "warn", text: `  structures ${result.source}: ${error}` });
      }
      continue;
    }
    lines.push({
      level: "out",
      text: `structures ${result.source}: hydrated ${String(result.hydrated)} (wrote ${String(result.written)} new, deduped ${String(result.deduped)})`,
    });
  }
  return lines;
}
