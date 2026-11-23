/**
 * The avatar roster — the one projection of member bronze that carries a profile picture.
 *
 * Member bronze (`store.ts`) has held `profile.avatarUrl` since the first hydrate, and nothing ever printed
 * it: the derive projection strips `avatar_url`, the Postgres `person` table has no column for it, and
 * `identity show` projects it away. The work console shows profile
 * pictures, so this is the projection a verb prints and the console reads. Pure: rows in, entries out.
 */

import type { IdentitySource } from "../../silver/identity.js";
import type { MemberBronzeRow } from "./types.js";

/** One person's picture, keyed the way the platform names them. */
export interface AvatarEntry {
  readonly source: IdentitySource;
  /** The source-native id — a Slack user id, a GitHub login — which is what a row elsewhere carries. */
  readonly nativeId: string;
  readonly handle: string | undefined;
  readonly name: string | undefined;
  readonly avatarUrl: string;
  /** Whether the platform marks the member as a bot; absent on the row reads as a person. */
  readonly bot: boolean;
}

/**
 * Every member with a picture, one entry each, in the order the sources were read.
 *
 * A row with no `avatarUrl` is left out rather than given a placeholder: the console draws initials for a
 * person it has no picture of, and it needs the absence to know to. Member bronze is append-only, so one
 * member is many rows — MEASURED, 29 rows for one Slack id
 * (`grep -c '"nativeId":"<id>"' $SLOPWEAVER_HOME/corpus/members/slack.jsonl`) — and the entry kept is the
 * one fetched LAST, which is the picture the platform shows today.
 *
 * @param rows the member bronze rows, any source
 * @param source when named, only that source's rows are kept
 * @returns the entries with a picture
 */
export function avatarRoster({
  rows,
  source,
  ids,
}: {
  rows: readonly MemberBronzeRow[];
  source?: IdentitySource;
  /** When given, only members whose platform id is in the set — a thread's authors, not a whole roster. */
  ids?: ReadonlySet<string>;
}): readonly AvatarEntry[] {
  const latest = new Map<string, { readonly fetchedAtIso: string; readonly entry: AvatarEntry }>();
  for (const row of rows) {
    if (source !== undefined && row.source !== source) {
      continue;
    }
    if (ids !== undefined && !ids.has(row.identity.nativeId)) {
      continue;
    }
    const avatarUrl = row.profile.avatarUrl;
    if (avatarUrl === undefined || avatarUrl.trim() === "") {
      continue;
    }
    const key = `${row.source}:${row.identity.nativeId}`;
    const held = latest.get(key);
    if (held !== undefined && held.fetchedAtIso > row.fetchedAtIso) {
      continue;
    }
    latest.set(key, {
      entry: {
        avatarUrl,
        bot: row.profile.bot === true,
        handle: row.identity.handle,
        name: row.identity.name,
        nativeId: row.identity.nativeId,
        source: row.source,
      },
      fetchedAtIso: row.fetchedAtIso,
    });
  }
  return [...latest.values()].map((held) => held.entry);
}
