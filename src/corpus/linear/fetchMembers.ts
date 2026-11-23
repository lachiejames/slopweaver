/**
 * Member hydration: project a raw Linear `users` node into a {@link MemberBronzeRow}, page the `users` lane to
 * exhaustion, and fold in EXTERNAL (non-member) users so a comment from a customer contact is no longer
 * authorless. Split out from `fetch.ts` — the lanes in {@link ./fetchCollect} and {@link ./fetchLanes} share
 * nothing with member hydration beyond the injected {@link LinearApi}.
 */
import { appendAll } from "../../lib/arrays.js";
import { advanceOrWarn, openCursorPage } from "../../lib/paging.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { buildMemberIdentity, finaliseMemberTrust } from "../members/email.js";
import { aggregateMemberWarnings } from "../members/project.js";
import { optBool } from "../members/read.js";
import type { MemberBronzeRow } from "../members/types.js";
import type { LinearApi } from "./apiTypes.js";
import { externalUserRow } from "./entities.js";
import { type LinearHydrationError, LinearHydrationErrors } from "./errors.js";
import { entityLane } from "./fetchLanes.js";
import { connectionPage } from "./nested.js";
import { connectionStrings, str } from "./parseFields.js";

/**
 * Project one raw Linear `users` GraphQL node into a {@link MemberBronzeRow} — id + email (always present
 * for real users) + display name + timezone/avatar/teams/active/admin/guest, plus `title` (their ROLE, which
 * nobody's profile carried before), keeping the full raw node. Pure — undefined for an id-less node.
 *
 * @param node the raw user node
 * @param fetchedAtIso the hydration timestamp
 * @returns the member row, or `undefined`
 */
export function parseLinearUserNode({
  node,
  fetchedAtIso,
}: {
  node: unknown;
  fetchedAtIso: string;
}): MemberBronzeRow | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ value: node["id"] });
  if (id === undefined) {
    return undefined;
  }
  const displayNameVal = str({ value: node["displayName"] });
  const name = str({ value: node["name"] }) ?? displayNameVal;
  const email = str({ value: node["email"] });
  return {
    fetchedAtIso,
    identity: buildMemberIdentity({
      nativeId: id,
      source: "linear",
      ...(displayNameVal !== undefined ? { handle: displayNameVal } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
    }),
    profile: linearUserProfile({ node }),
    provenance: ["linear.users"],
    raw: node,
    source: "linear",
    sourceId: id,
    version: 1,
    warnings: email === undefined ? ["no email on Linear user"] : [],
  };
}

/** The member profile off a raw Linear user node — absent fields drop out rather than being faked. Pure. */
function linearUserProfile({ node }: { node: Record<string, unknown> }): MemberBronzeRow["profile"] {
  const timezone = str({ value: node["timezone"] });
  const avatarUrl = str({ value: node["avatarUrl"] });
  const title = str({ value: node["title"] });
  const teams = connectionStrings({ field: "key", nodes: connectionPage({ holder: node, key: "teams" }).nodes });
  // `active` is READ, never inferred from absence. `node["active"] !== false` used to answer `true` for a
  // payload that carried no such field, and the store copies this onto an identity whose
  // contract is "what the provider said" — so an inferred `true` would report a person as confirmed-present
  // on the word of an API that never answered. Absent stays absent, which reads back as `null`.
  const active = optBool({ value: node["active"] });
  return {
    bot: false,
    ...(active !== undefined ? { active } : {}),
    ...(node["admin"] === true ? { admin: true } : {}),
    ...(node["guest"] === true ? { guest: true } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
    ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(teams.length > 0 ? { teams } : {}),
  };
}

/**
 * Hydrate every Linear org member (the `users` lane, paged), projecting each node + finalising trust across
 * the org. A failure is fatal (`err`) after the transport's retry budget.
 *
 * @param api the injected Linear seam
 * @param fetchedAtIso the hydration timestamp
 * @returns the member rows + warnings, or `err` on a fatal failure
 */
export async function fetchLinearMembers({
  api,
  fetchedAtIso,
}: {
  api: LinearApi;
  fetchedAtIso: string;
}): Promise<Result<{ rows: readonly MemberBronzeRow[]; warnings: readonly string[] }, LinearHydrationError>> {
  const orgMembers = await collectOrgMembers({ api, fetchedAtIso });
  if (orgMembers.isErr()) {
    return err(orgMembers.error);
  }
  // EXTERNAL users join the same store, and closing that gap is the point: 652 non-member commenters were
  // entirely anonymous in the corpus, so a comment from a customer contact had no author at all. They are
  // marked by `provenance`, and they go through `finaliseMemberTrust` with everyone else so an email shared
  // with a real member is HELD rather than silently merged.
  // The members store keeps no cursor, so a lane that did not arrive whole has nothing to hold back: it
  // reports as a warning here, where the activity crawl reports the same line as a coverage gap.
  const externalWarnings: string[] = [];
  const externalNodes = await entityLane({
    fetch: api.externalUsers,
    incomplete: externalWarnings,
    label: "externalUsers",
    warnings: externalWarnings,
  });
  const external = externalNodes
    .map((node) => externalUserRow({ fetchedAtIso, node }))
    .filter((row): row is MemberBronzeRow => row !== undefined);
  const finalised = finaliseMemberTrust({ rows: [...orgMembers.value.rows, ...external] });
  return ok({
    rows: finalised,
    warnings: [...aggregateMemberWarnings({ rows: finalised }), ...orgMembers.value.warnings, ...externalWarnings],
  });
}

/** Every raw user node that projects to a member row, in page order. Pure. */
function memberRowsOf({
  nodes,
  fetchedAtIso,
}: {
  nodes: readonly unknown[];
  fetchedAtIso: string;
}): readonly MemberBronzeRow[] {
  return nodes
    .map((node) => parseLinearUserNode({ fetchedAtIso, node }))
    .filter((row): row is MemberBronzeRow => row !== undefined);
}

/** Page the `users` lane to exhaustion into member rows. A failure is fatal after the retry budget. */
async function collectOrgMembers({
  api,
  fetchedAtIso,
}: {
  api: LinearApi;
  fetchedAtIso: string;
}): Promise<Result<{ rows: readonly MemberBronzeRow[]; warnings: readonly string[] }, LinearHydrationError>> {
  const rows: MemberBronzeRow[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  try {
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const open = openCursorPage({
        collected: rows.length,
        cursor,
        lane: "linear members",
        maxItems: undefined,
        pages: pages,
        seen,
        warnings,
      });
      if (open === undefined) {
        break;
      }
      const page = await api.users(cursor !== undefined ? { cursor } : {});
      pages += 1;
      appendAll({ from: memberRowsOf({ fetchedAtIso, nodes: page.nodes }), into: rows });
      // Optional and additive on the page contract (see `LinearIssuesPage.warnings`): a seam need not carry it.
      const pageWarnings = page.warnings;
      if (pageWarnings !== undefined) {
        appendAll({ from: pageWarnings, into: warnings });
      }
      const next = advanceOrWarn({
        lane: "linear members",
        next: page.nextCursor,
        seen,
        warnings,
      });
      if (next === undefined) {
        break;
      }
      cursor = next;
    }
  } catch (error: unknown) {
    return err(LinearHydrationErrors.memberHydrationFailed({ cause: error }));
  }
  return ok({ rows, warnings });
}
