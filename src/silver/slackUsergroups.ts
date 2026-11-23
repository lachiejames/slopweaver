/**
 * Every Slack usergroup this installation knows, read from the CORPUS's own structure rows.
 *
 * ## Why the corpus and not the atlas
 *
 * The atlas holds the surface map for Slack, because something else better suited is holding all the
 * entities. Slack is the
 * one platform where the two are split — Vanta, JumpCloud, 1Password and Cloudflare are small enough that
 * their atlases hold everything reachable, entities included, while Slack's entities are the corpus's job
 * and its atlas maps the SURFACE. So the source for a usergroup is `corpus/structures/slack.jsonl`, which
 * `refresh` writes from `usergroups.list` with inline membership.
 *
 * ## The defect this closes, as the measurement rather than the intent
 *
 * MEASURED on the owner's own store: 48 distinct usergroups in structure bronze, and **0 of them
 * resolvable** — every bare `<!subteam^S…>` in the corpus rendered as the generic `@group`, and asking any
 * addressing surface here to resolve `@insights-eng` answered "no colleague answers to it", the same answer
 * a person who does not exist gets. Nothing was missing from the store. Nothing READ it.
 *
 * That is the whole shape of the bug and it is worth stating plainly, because the obvious fix was the wrong
 * one: fetching the usergroups a third time would have changed nothing. A read path is what was absent.
 *
 * Pure apart from the one file read; every judgement below takes rows and returns rows.
 */
import { readStructureRows } from "../corpus/structures/store.js";
import type { StructureBronzeRow } from "../corpus/structures/types.js";
import { isRecord } from "../lib/parsers.js";

import type { MentionGroup } from "./groupMention.js";

/**
 * The newest row per usergroup id.
 *
 * The structure store APPENDS a row per hydration rather than replacing, so a group captured five times has
 * five rows — measured at 103 rows for 48 distinct groups on the owner's store. Counting rows would report
 * the workspace as twice its real size, and worse, an OLD row can outvote the current one on a renamed
 * handle. `fetchedAtIso` is ISO-8601 and therefore sorts lexicographically, so the newest capture wins by
 * string comparison with no date parsing.
 *
 * @param rows every structure row, of any kind and any source
 * @returns the newest row per usergroup id, in no particular order
 */
export function latestUsergroupRows({ rows }: { rows: readonly StructureBronzeRow[] }): readonly StructureBronzeRow[] {
  const newest = new Map<string, StructureBronzeRow>();
  for (const row of rows) {
    if (row.kind !== "usergroup") {
      continue;
    }
    const held = newest.get(row.sourceId);
    if (held === undefined || row.fetchedAtIso > held.fetchedAtIso) {
      newest.set(row.sourceId, row);
    }
  }
  return [...newest.values()];
}

/**
 * Project one structure row into the shape a resolver reads.
 *
 * A DISABLED group is kept and flagged rather than dropped. Slack disables a usergroup instead of removing
 * it, and every message written while it was live carries its id forever — so refusing to name one would
 * take a reader back to the generic `@group` for exactly the mentions a name most helps explain.
 *
 * @param row the newest capture of one usergroup
 * @returns the group
 */
export function usergroupFromRow({ row }: { row: StructureBronzeRow }): MentionGroup {
  const raw = isRecord(row.raw) ? row.raw : {};
  const users = raw["users"];
  return {
    // `date_delete` is Slack's own disabled marker and lives only in the raw payload — the projection that
    // writes these rows keeps `attrs` empty for a usergroup, so this is the one place it can be read.
    deleted: typeof raw["date_delete"] === "number" && raw["date_delete"] > 0,
    handle: row.identity.slug,
    id: row.sourceId,
    memberIds: Array.isArray(users) ? users.filter((id): id is string => typeof id === "string").toSorted() : [],
    name: row.identity.name,
  };
}

/**
 * Every usergroup the corpus holds, newest capture of each.
 *
 * @param rows every Slack structure row, as `refresh` wrote them
 * @returns the groups, sorted by id so two reads over one store answer identically
 */
export function usergroupsFromRows({ rows }: { rows: readonly StructureBronzeRow[] }): readonly MentionGroup[] {
  return latestUsergroupRows({ rows })
    .map((row) => usergroupFromRow({ row }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * The id→handle map a markup resolver needs.
 *
 * A group whose capture carries no handle is OMITTED rather than mapped to an empty string: a caller that
 * found `""` would render `@` and think it had resolved something. An absent key is what makes the caller
 * fall back to the generic `@group`, which is a visible non-answer.
 *
 * @param groups the groups the corpus holds
 * @returns usergroup id → its `@`-less handle
 */
export function usergroupHandleMap({ groups }: { groups: readonly MentionGroup[] }): Readonly<Record<string, string>> {
  const handles: Record<string, string> = {};
  for (const group of groups) {
    if (group.handle !== undefined && group.handle.length > 0) {
      handles[group.id] = group.handle;
    }
  }
  return handles;
}

/**
 * Read every Slack usergroup out of the corpus.
 *
 * A store that cannot be read answers an empty list rather than throwing: every caller here is a resolver
 * whose fallback is the generic `@group`, and a refresh or a `identity resolve` that died over a truncated
 * structure file would be a far worse failure than an unresolved mention.
 *
 * @param home the Slopweaver home
 * @returns every usergroup the corpus holds
 */
export function readSlackUsergroups({ home }: { home: string }): readonly MentionGroup[] {
  return usergroupsFromRows({ rows: readStructureRows({ home, source: "slack" }).rows });
}
