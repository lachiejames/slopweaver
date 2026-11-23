/**
 * The member-hydration edge of `refresh`: after activity ingest, enumerate each selected source's members
 * (official SDKs, behind the same injected seams the activity lanes use) and persist them to member bronze.
 * Read-only + additive to activity: a hydration failure is WARNING-only — it never flips the refresh exit
 * code — so a capability/scope gap (e.g. no Slack email scope, a non-SAML GitHub org) degrades gracefully
 * instead of sinking the whole refresh. The resolver then auto-links the team cross-source on the next
 * `derive` / `identity show`.
 */
import { fetchGithubMembers, makeGithubMembersApi } from "../../../corpus/github/members.js";
import { fetchLinearMembers, fetchLinearReferences, makeLinearApi } from "../../../corpus/linear/fetch.js";
import { sharedLinearTransport } from "../../../corpus/linear/transport.js";
import { readMemberRows, writeMemberRows } from "../../../corpus/members/store.js";
import type { MemberBronzeRow } from "../../../corpus/members/types.js";
import { fetchNotionMembers } from "../../../corpus/notion/fetch.js";
import { makeNotionApi } from "../../../corpus/notion/liveApi.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { listedMemberIds, mergeConnectMembers } from "../../../corpus/slack/connectMembers.js";
import { harvestConnectMembers } from "../../../corpus/slack/connectMembersScan.js";
import { fetchSlackMembers } from "../../../corpus/slack/members.js";
import type { CorpusSource } from "../../../corpus/types.js";
import { ok, type Result } from "../../../lib/result.js";
import type { IdentitySource } from "../../../silver/identity.js";
import type { RefreshSummaryLine } from "./core.js";

/** One source's member-hydration outcome (folded into the refresh summary, never the exit code). */
export interface MemberHydrationResult {
  readonly source: IdentitySource;
  readonly ok: boolean;
  readonly hydrated: number;
  readonly written: number;
  readonly deduped: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/** The tokens the hydration lanes need (Slack read token / Linear / Notion / GitHub). */
export interface MemberTokens {
  readonly slack?: string;
  readonly linear?: string;
  readonly notion?: string;
  readonly github?: string;
}

/** A fetched member result the persist step consumes. */
type FetchedMembers = Result<{ rows: readonly MemberBronzeRow[]; warnings: readonly string[] }>;

/**
 * Add the Slack members `users.list` structurally cannot return — recovered from `user_profile` on messages
 * bronze already holds — to what it did return. A failed `users.list` is passed straight through: the
 * recovery is a supplement to that roster, never a substitute for it, and writing only the recovered rows
 * after a failed list would silently rewrite what the member store means.
 *
 * Reads bronze off disk rather than the network, so it runs after the activity lanes and sees what they just
 * wrote. See {@link ../../../corpus/slack/connectMembers} for why these people are invisible to `users.list`
 * and why the recovered rows classify nobody.
 *
 * Exported for the unit lane, which drives it over a `mkdtempSync` home: everything it decides depends on what
 * two real stores hold, so a test that did not read them would be testing a restatement of this function.
 *
 * @param listed what `users.list` returned
 * @param home the Slopweaver home, whose Slack bronze is scanned
 * @param fetchedAtIso the hydration timestamp
 * @returns the combined rows, with a warning line counting what the recovery added — or `listed` unchanged,
 *   plus a warning naming the reason, when there is no trustworthy roster to subtract
 */
export function withConnectMembers({
  listed,
  home,
  fetchedAtIso,
}: {
  listed: FetchedMembers;
  home: string;
  fetchedAtIso: string;
}): FetchedMembers {
  if (listed.isErr()) {
    return listed;
  }
  const { rows, warnings } = listed.value;
  // The subtracted set spans every PAST hydration as well as this one. Subtracting only this batch would let
  // a colleague who moved to a sibling Grid workspace — gone from `users.list`, still carrying a profile on
  // their old messages — pick up a recovered row with a later `fetchedAtIso`, which `latestMemberRows` would
  // then prefer over their richer `users.list` row. See `mergeConnectMembers`.
  const stored = readMemberRows({ home, source: "slack" });
  // A member store that did not read cleanly means the subtracted set is INCOMPLETE, and `readMemberRows`
  // reports that only in `warnings` — every non-ENOENT failure answers `{ rows: [], warnings: [message] }`,
  // so `.rows` alone cannot tell "nobody has ever been hydrated" from "this file could not be read". Reading
  // only the rows there would silently restore the exact shape above. The recovery is a supplement, so with
  // no roster to trust it is SKIPPED rather than computed against a short one. Found by the r1 review pass.
  if (stored.warnings.length > 0) {
    return ok({
      rows,
      warnings: [
        ...warnings,
        `skipped user_profile recovery — the stored member roster did not read cleanly, so the ids to subtract are unknown: ${stored.warnings.join("; ")}`,
      ],
    });
  }
  // Slack bronze the owner's protect list refuses is not read at all, and the recovery is skipped by name rather
  // than computed over an empty harvest, which would read as "nobody to recover".
  const harvested = harvestConnectMembers({ fetchedAtIso, home });
  if (harvested.isErr()) {
    return ok({
      rows,
      warnings: [...warnings, `skipped user_profile recovery — ${harvested.error.join("; ")}`],
    });
  }
  const everListed = listedMemberIds({ stored: stored.rows });
  const recovered = mergeConnectMembers({
    harvested: harvested.value,
    listed: new Set([...everListed, ...rows.map((row) => row.sourceId)]),
  });
  if (recovered.length === 0) {
    return ok({ rows, warnings });
  }
  return ok({
    rows: [...rows, ...recovered],
    warnings: [
      ...warnings,
      `recovered ${String(recovered.length)} member(s) from message user_profile — people users.list cannot return (Slack Connect / another Grid workspace)`,
    ],
  });
}

/** Write a source's fetched members to member bronze, folding the counts + warnings into a result. */
function persist({
  source,
  fetched,
  home,
}: {
  source: IdentitySource;
  fetched: FetchedMembers;
  home: string;
}): MemberHydrationResult {
  if (fetched.isErr()) {
    return { deduped: 0, errors: fetched.error, hydrated: 0, ok: false, source, warnings: [], written: 0 };
  }
  const { rows, warnings } = fetched.value;
  const wrote = writeMemberRows({ home, rows, source });
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
 * Hydrate ONE source's members over its live seam (undefined ⇒ not hydratable: gold, or no token/org).
 * Effectful — the injected connector seams do the network.
 *
 * @param source the source to hydrate
 * @param home the Slopweaver home
 * @param fetchedAtIso the hydration timestamp
 * @param tokens the per-source tokens
 * @param githubOrg the GitHub org (repo owner), when GitHub is selected + resolvable
 * @returns the hydration result, or `undefined` when the source isn't hydratable
 */
export async function hydrateOneSource({
  source,
  home,
  fetchedAtIso,
  tokens,
  githubOrg,
}: {
  source: CorpusSource;
  home: string;
  fetchedAtIso: string;
  tokens: MemberTokens;
  githubOrg?: string;
}): Promise<MemberHydrationResult | undefined> {
  if (source === "slack" && tokens.slack !== undefined) {
    return persist({
      fetched: withConnectMembers({
        fetchedAtIso,
        home,
        listed: await fetchSlackMembers({ api: makeSlackApi({ token: tokens.slack }), fetchedAtIso }),
      }),
      home,
      source,
    });
  }
  if (source === "linear" && tokens.linear !== undefined) {
    const request = sharedLinearTransport({ token: tokens.linear }).request;
    // The reference pass first, for the one thing this lane needs from it: `@linear/sdk`'s `User` fragment
    // carries no `teams` connection, and a member's team list is how the resolver places them in the org.
    // It is rebuilt from the root `teamMemberships` walk — see `corpus/linear/references.ts`.
    const referenced = await fetchLinearReferences({ request });
    const members = await fetchLinearMembers({
      api: makeLinearApi({ references: referenced.references, request }),
      fetchedAtIso,
    });
    return persist({ fetched: members.mapErr((error) => [error.message]), home, source });
  }
  if (source === "notion" && tokens.notion !== undefined) {
    return persist({
      fetched: (await fetchNotionMembers({ api: makeNotionApi({ token: tokens.notion }), fetchedAtIso })).mapErr(
        (error) => [error.message],
      ),
      home,
      source,
    });
  }
  if (source === "github" && githubOrg !== undefined) {
    const fetched = (
      await fetchGithubMembers({
        api: makeGithubMembersApi({ token: tokens.github }),
        fetchedAtIso,
        org: githubOrg,
      })
    ).mapErr((error) => [error.message]);
    return persist({ fetched, home, source });
  }
  return undefined;
}

/**
 * The member-hydration summary lines (WARN for failures/warnings, OUT for successes) — hydration never
 * fails the verb, so nothing here is an `error` level. Pure.
 *
 * @param results the per-source hydration results
 * @returns the ordered summary lines
 */
export function summariseMemberHydration({
  results,
}: {
  results: readonly MemberHydrationResult[];
}): readonly RefreshSummaryLine[] {
  const lines: RefreshSummaryLine[] = [];
  for (const result of results) {
    for (const warning of result.warnings) {
      lines.push({ level: "warn", text: `  members ${result.source}: ${warning}` });
    }
    if (result.ok === false) {
      for (const error of result.errors) {
        lines.push({ level: "warn", text: `  members ${result.source}: ${error}` });
      }
      continue;
    }
    lines.push({
      level: "out",
      text: `members ${result.source}: hydrated ${String(result.hydrated)} (wrote ${String(result.written)} new, deduped ${String(result.deduped)})`,
    });
  }
  return lines;
}
