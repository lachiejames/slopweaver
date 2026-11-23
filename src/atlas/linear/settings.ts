/**
 * The CONFIGURATION half of the surface map: the pure projection that turns each answer to a row of
 * `./settingSurfaces.ts`'s closed inventory into `setting` entities.
 *
 * ## The selection IS the allowlist
 *
 * Every inventory row names the exact fields its query asks for. Nothing is read with a wildcard, and there is
 * no path by which a caller supplies a document — so a field Linear adds next month is absent because it
 * was never requested, rather than stored because nobody thought to exclude it. This is the 1Password
 * atlas's projection discipline applied to a platform whose configuration genuinely does carry secrets.
 *
 * ## What is deliberately NOT selected, and why each one is dangerous
 *
 * These fields exist on types this atlas reads and are omitted by name, because a configuration atlas that
 * quietly stored them would be a credential store:
 *
 * - `Webhook.secret` — the signing secret. Anyone holding it can forge Linear's own webhook deliveries.
 * - `Team.cycleCalenderUrl` — an iCal address with a bearer token embedded in the path.
 * - `UserSettings.calendarHash` — the same class, for the member's own calendar feed.
 * - `TimeSchedule.externalUrl` — the address of a third-party on-call schedule, which routinely carries a
 *   token in its query string. Its sibling `externalId` is selected, so the LINK to the external system
 *   is still visible without the credential that opens it.
 * - `Organization.samlSettings`, `scimSettings`, `authSettings`, `securitySettings` — identity-provider
 *   configuration. Whether any given workspace's copy holds a secret is not knowable from the schema, and
 *   "probably fine" is not the standard for an SSO configuration blob.
 * - `Organization.aiProviderConfiguration` — model-provider configuration, the shape that carries keys.
 *
 * `sensitivity.ts` re-checks the same class at publish time, so a future row that forgets this comment
 * fails rather than ships. Two mechanisms, because one of them is a comment.
 *
 * ## Why these ROOT fields and not the other hundred and fifty
 *
 * Owner's rule: for a platform whose entities the corpus holds, the atlas maps the surface.
 * So the criterion for an inventory row is that the thing read CONFIGURES the workspace rather than being work
 * tracked in it — a workflow state configures how issues move, an issue does not. Everything on the other
 * side of that line is named in `descriptor.ts`'s `excludes` rather than silently left out.
 */

import { isRecord } from "../../lib/parsers.js";

import { type FieldTree, selectedFieldTree } from "../kit/graphqlDocument.js";

import type { LinearSettingApiDetail } from "./model.js";
import type { LinearSettingSurface } from "./settingSurfaces.js";

/** One reduced piece of configuration, with the provider key the store matches on. */
export interface LinearSettingRecord {
  /** `<group>:<provider id>` — unique across groups without depending on ids being globally unique. */
  readonly providerId: string;
  readonly detail: LinearSettingApiDetail;
}

/**
 * The provider key one configuration record is stored under.
 *
 * A row that fans out per team carries its SCOPE in the key, and that is a finding rather than a
 * convention: measured, one live workspace returned the SAME SLA configuration ids for
 * every one of its teams, and the kit's duplicate-id guard refused the whole merge. So one Linear
 * object can be reachable from several teams, and the association is exactly the fact worth holding — a
 * scope-less key would have to pick one team and discard the rest, or de-duplicate and lose which teams a
 * configuration governs.
 *
 * A row with no id of its own — the workspace's own settings, the rate-limit budgets — keys on the group,
 * because there is exactly one of it.
 */
function providerIdFor({
  surface,
  scope,
  id,
  index,
}: {
  surface: LinearSettingSurface;
  scope: string;
  id: string | null;
  index: number;
}): string {
  const prefix = surface.perTeam ? `${surface.group}:${scope}` : surface.group;
  if (id !== null) {
    return `${prefix}:${id}`;
  }
  return surface.shape.kind === "single" ? `${prefix}:${surface.group}` : `${prefix}:${String(index)}`;
}

/**
 * A configuration record's human label, as a string a reader can hold.
 *
 * An `if` rather than `?? ""` or a ternary, deliberately: the house rule bans coalescing to an empty string
 * and the linter prefers `??` over a ternary, so the only construction that satisfies both is a named
 * function that spells out the two cases. The empty string here is a real state — this configuration
 * carries no human label — rather than an absent value being papered over.
 *
 * @param label the label read off the provider's own row, or `null` when the row declares none
 * @returns the label, or the empty string that means it has none
 */
function labelText({ label }: { label: string | null }): string {
  if (label === null) {
    return "";
  }
  return label;
}

/**
 * The field tree one surface's own document selects, computed once per surface and cached.
 *
 * Parsing the document rather than trusting GraphQL to return only what was asked is the second mechanism,
 * and a Codex review pass is why it exists: the earlier version stored the provider's row WHOLESALE, so the
 * claim that "the selection IS the allowlist" rested on the server being well-behaved rather than on
 * anything in this repository. Now it rests on {@link prune}.
 */
const SELECTION_TREES = new Map<string, FieldTree>();

/** The selected field tree for one surface, parsed from its own document. */
function selectionTreeFor({ surface }: { surface: LinearSettingSurface }): FieldTree {
  const cached = SELECTION_TREES.get(surface.group);
  if (cached !== undefined) {
    return cached;
  }
  const tree = selectedFieldTree({ document: surface.document, rootField: surface.shape.field });
  SELECTION_TREES.set(surface.group, tree);
  return tree;
}

/**
 * Keep only the fields one surface's document actually asked for, at every depth.
 *
 * A field the document did not select cannot reach disk by any path, whatever a provider chooses to return.
 * That is what makes `settings.ts`'s own header claim — the selection IS the allowlist — a property rather
 * than a description of how GraphQL usually behaves.
 *
 * @param tree the selected field tree for this level
 * @param value the provider's own value at this level
 * @returns the value with every unselected field removed
 */
function prune({ tree, value }: { tree: FieldTree; value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => prune({ tree, value: entry }));
  }
  if (!isRecord(value)) {
    return value;
  }
  const kept: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const branch = tree[key];
    // An unselected field has no branch in the tree, and is dropped.
    if (branch !== undefined) {
      kept[key] = prune({ tree: branch, value: child });
    }
  }
  return kept;
}

/** Which scope one configuration row belongs to: the team it was read for, one it names, or the workspace. */
function scopeOf({
  row,
  surface,
  teamKey,
}: {
  row: unknown;
  surface: LinearSettingSurface;
  teamKey: string | null;
}): string {
  if (surface.perTeam) {
    return teamKey ?? "workspace";
  }
  if (surface.teamKeyPath !== null) {
    const named = stringAt({ path: surface.teamKeyPath, value: row });
    if (named !== null) {
      return named;
    }
  }
  // A surface with no team-key path is workspace-scoped, and a workspace-level label or integration carries
  // `team: null` in Linear's own schema: both belong to the workspace.
  return "workspace";
}

/** Follow a dotted path through nested records, returning the string it lands on. */
function stringAt({ value, path }: { value: unknown; path: readonly string[] }): string | null {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }
  return typeof current === "string" && current.length > 0 ? current : null;
}

/** The rows one surface's answer carries, whatever shape that surface declared. */
function rowsOf({ data, surface }: { data: unknown; surface: LinearSettingSurface }): readonly unknown[] {
  // An answer that is not a record carries no rows, whatever shape the surface declared.
  const value = isRecord(data) ? data[surface.shape.field] : null;
  if (surface.shape.kind === "single") {
    return value == null ? [] : [value];
  }
  if (surface.shape.kind === "list") {
    return Array.isArray(value) ? value : [];
  }
  const nodes = isRecord(value) ? value["nodes"] : null;
  return Array.isArray(nodes) ? nodes : [];
}

/**
 * Project one surface's answer into `setting` records. PURE.
 *
 * A row with no `id` of its own — the workspace's own settings, the rate-limit budgets — keys on the
 * group, because there is exactly one of it. A row WITH an id keys on it, so the same configuration keeps
 * its identity across generations and `accumulate never replace` means what it says.
 *
 * @param data the `data` object one surface's document returned
 * @param surface the inventory row that asked for it
 * @param teamKey which team this answer was read for, when the row fans out per team
 * @returns one record per configured thing, in the order the provider returned them
 */
export function projectSettingSurface({
  data,
  surface,
  teamKey = null,
}: {
  data: unknown;
  surface: LinearSettingSurface;
  teamKey?: string | null;
}): readonly LinearSettingRecord[] {
  return rowsOf({ data, surface }).map((row, index) => {
    const id = isRecord(row) ? stringAt({ path: ["id"], value: row }) : null;
    const scope = scopeOf({ row, surface, teamKey });
    const label = surface.labelField === null ? null : stringAt({ path: [surface.labelField], value: row });
    return {
      detail: {
        group: surface.group,
        label: labelText({ label }),
        settingScope: scope,
        value: prune({ tree: selectionTreeFor({ surface }), value: row }),
      },
      providerId: providerIdFor({ id, index, scope, surface }),
    };
  });
}

/**
 * Where one connection surface's answer says the next page starts.
 *
 * A non-connection surface has no next page and says so, rather than reporting a cursor of `null` that a
 * caller could mistake for "the end of a connection I have not read".
 *
 * @param data the `data` object one surface's document returned
 * @param surface the inventory row that asked for it
 * @returns whether another page exists and the cursor that reaches it
 */
export function settingsPageCursor({ data, surface }: { data: unknown; surface: LinearSettingSurface }): {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
} {
  if (surface.shape.kind !== "connection" || !isRecord(data)) {
    return { endCursor: null, hasNextPage: false };
  }
  const connection = data[surface.shape.field];
  const pageInfo = isRecord(connection) ? connection["pageInfo"] : null;
  if (!isRecord(pageInfo)) {
    return { endCursor: null, hasNextPage: false };
  }
  const endCursor = typeof pageInfo["endCursor"] === "string" ? pageInfo["endCursor"] : null;
  return { endCursor, hasNextPage: pageInfo["hasNextPage"] === true && endCursor !== null };
}
