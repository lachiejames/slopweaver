/**
 * Slack MEMBER hydration — the `users.list` walk that fills the sibling member store, kept apart from the
 * activity crawl in {@link ./fetch} because they share only a seam. It moved out when the crawl's own file hit
 * the repository's 1,000-line ceiling, and the split follows the seam that was already there: nothing here
 * reads a message, and nothing in the crawl reads a profile.
 */
import { advanceOrWarn, openCursorPage } from "../../lib/paging.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { buildMemberIdentity, finaliseMemberTrust } from "../members/email.js";
import { aggregateMemberWarnings } from "../members/project.js";
import { optBool } from "../members/read.js";
import type { MemberBronzeRow } from "../members/types.js";
import { USERS_LIST_PROVENANCE } from "./connectMembers.js";
import type { SlackApi } from "./fetch.js";
import { optStr } from "./shape.js";

/**
 * The workspace member's best display name: `profile.display_name` → `real_name` → `name`, else undefined.
 *
 * Exported because the crawl's id→name map needs the SAME rule — two copies of "what do we call this person"
 * is how one surface starts calling them something else.
 *
 * @param raw the raw member payload
 * @returns the display name, or undefined when the payload carries none
 */
export function memberName({ raw }: { raw: Record<string, unknown> }): string | undefined {
  const profile: Record<string, unknown> = isRecord(raw["profile"]) ? raw["profile"] : {};
  return (
    optStr({ value: profile["display_name"] }) ??
    optStr({ value: profile["real_name"] }) ??
    optStr({ value: raw["real_name"] }) ??
    optStr({ value: raw["name"] })
  );
}

/** The Slack member profile object (defensively `{}` when absent). */
function slackProfile({ raw }: { raw: Record<string, unknown> }): Record<string, unknown> {
  return isRecord(raw["profile"]) ? raw["profile"] : {};
}

/** The 48px and 72px pictures Slack draws beside a message, each only when the profile carries it. */
function messageAvatars({ profile }: { profile: Record<string, unknown> }): {
  avatar48Url?: string;
  avatar72Url?: string;
} {
  const avatar48Url = optStr({ value: profile["image_48"] });
  const avatar72Url = optStr({ value: profile["image_72"] });
  return {
    ...(avatar48Url !== undefined ? { avatar48Url } : {}),
    ...(avatar72Url !== undefined ? { avatar72Url } : {}),
  };
}

/**
 * Project one raw Slack `users.list` member into a {@link MemberBronzeRow}. The full raw Member is kept;
 * `profile.email` populates the join key ONLY when the `users:read.email` scope granted it (else a warning
 * + `missing` trust — never a guessed email). Pure — undefined for an id-less row.
 *
 * @param raw the raw member object
 * @param fetchedAtIso the hydration timestamp
 * @returns the member row, or `undefined` when it has no id
 */
export function projectSlackMember({
  raw,
  fetchedAtIso,
}: {
  raw: unknown;
  fetchedAtIso: string;
}): MemberBronzeRow | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const id = optStr({ value: raw["id"] });
  if (id === undefined) {
    return undefined;
  }
  const profile = slackProfile({ raw });
  const email = optStr({ value: profile["email"] });
  const deleted = optBool({ value: raw["deleted"] });
  const handle = optStr({ value: raw["name"] });
  const name = memberName({ raw });
  const title = optStr({ value: profile["title"] });
  const timezone = optStr({ value: raw["tz"] });
  const guest = raw["is_restricted"] === true || raw["is_ultra_restricted"] === true;
  const avatarUrl = optStr({ value: profile["image_512"] }) ?? optStr({ value: profile["image_192"] });
  return {
    fetchedAtIso,
    identity: buildMemberIdentity({
      nativeId: id,
      source: "slack",
      ...(handle !== undefined ? { handle } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
    }),
    profile: {
      // Read from `deleted` rather than inferred from its absence: `users.list` always carries the field,
      // so an absent one is an anomaly rather than a live account, and the store's `identity.active`
      // reports what the provider SAID, with `null` for "it said nothing".
      ...(deleted !== undefined ? { active: !deleted } : {}),
      bot: raw["is_bot"] === true,
      guest,
      ...(raw["is_admin"] === true ? { admin: true } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...messageAvatars({ profile }),
    },
    provenance: [USERS_LIST_PROVENANCE],
    raw,
    source: "slack",
    sourceId: id,
    version: 1,
    warnings: email === undefined ? ["no email — set the users:read.email scope for cross-source linking"] : [],
  };
}

/** Every raw member payload that projects to a member row, in page order. Pure. */
function slackMemberRowsOf({
  members,
  fetchedAtIso,
}: {
  members: readonly unknown[];
  fetchedAtIso: string;
}): readonly MemberBronzeRow[] {
  return members
    .map((raw) => projectSlackMember({ fetchedAtIso, raw }))
    .filter((row): row is MemberBronzeRow => row !== undefined);
}

/**
 * Hydrate every Slack workspace member (`users.list`, paged) into member rows, with trust finalised across
 * the workspace. Reuses the existing safe-wrapped `listUsers` seam — no new boundary. A discovery failure
 * is fatal (`err`); an empty workspace is `ok([])`.
 *
 * @param api the injected Slack seam
 * @param fetchedAtIso the hydration timestamp
 * @returns the member rows + warnings, or `err` on a fatal discovery failure
 */
export async function fetchSlackMembers({
  api,
  fetchedAtIso,
}: {
  api: SlackApi;
  fetchedAtIso: string;
}): Promise<Result<{ rows: readonly MemberBronzeRow[]; warnings: readonly string[] }>> {
  const rows: MemberBronzeRow[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  try {
    let pages = 0;
    for (;;) {
      const open = openCursorPage({
        collected: rows.length,
        cursor,
        lane: "slack members",
        maxItems: undefined,
        pages: pages,
        seen,
        warnings,
      });
      if (open === undefined) {
        break;
      }
      const page = await api.listUsers(cursor !== undefined ? { cursor } : {});
      pages += 1;
      rows.push(...slackMemberRowsOf({ fetchedAtIso, members: page.members }));
      const next = advanceOrWarn({
        lane: "slack members",
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
    return err([`slack member hydration failed: ${error instanceof Error ? error.message : "unknown"}`]);
  }
  const finalised = finaliseMemberTrust({ rows });
  return ok({ rows: finalised, warnings: [...warnings, ...aggregateMemberWarnings({ rows: finalised })] });
}
