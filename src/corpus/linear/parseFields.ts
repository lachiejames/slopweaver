/**
 * The PURE readers every Linear node parse shares: one field off a raw GraphQL node, of unvalidated shape. No I/O,
 * no transport, no paging, and no knowledge of which item the field lands in.
 */
import { isRecord } from "#lib/parsers.js";
import { optStr as str } from "../slack/shape.js";
import { connectionPage } from "./nested.js";

export { str };

/**
 * A required string field parsed from an external node: the string, or "" when absent (honest sentinel).
 *
 * @param value the raw field, of unvalidated shape
 * @returns the string, or empty — empty is the sentinel for a REQUIRED field that was absent, which keeps the
 *   loss visible rather than dropping the whole record
 */
export function strOrEmpty({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}

/**
 * A finite number field, or undefined (Linear types `priority`/`estimate`/`number` as Float).
 *
 * @returns the number, or undefined when the value is not a finite number
 */
export function num({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * `displayName` off a nested user-like object.
 *
 * @param value the raw user-like object, of unvalidated shape
 * @returns the display name, or undefined when the value is not a record or carries none
 */
export function displayName({ value }: { value: unknown }): string | undefined {
  return isRecord(value) ? str({ value: value["displayName"] }) : undefined;
}

/**
 * `str` off a nested object field (`node.state.name`, `node.team.key`), or undefined.
 *
 * @param value the raw holder object, of unvalidated shape
 * @param key the field to read off it
 * @returns the string, or undefined when the holder is not a record or the field is absent/empty
 */
export function nestedStr({ value, key }: { value: unknown; key: string }): string | undefined {
  return isRecord(value) ? str({ value: value[key] }) : undefined;
}

/**
 * A nested object's numeric field (`node.cycle.number`), or undefined.
 *
 * @returns the number, or undefined when the holder is not a record or the field is not a finite number
 */
export function nestedNum({ value, key }: { value: unknown; key: string }): number | undefined {
  return isRecord(value) ? num({ value: value[key] }) : undefined;
}

/**
 * Every `<field>` string off a connection's nodes, deduped and SORTED, skipping nodes that lack it. Pure.
 *
 * Canonicalising here rather than at the writer is deliberate, and it closes a gap the writer alone could not.
 * `recordSerialisation` sorts array-valued ATTRS, so `attrs.labels` was already stable — but the same list is also
 * embedded in the record's `text` summary line, and `text` is fingerprinted too. So a reshuffled `labels`
 * connection still appended a false new bronze version on every refresh, through the summary rather than
 * through the attr. Sorting at the parse edge makes ONE canonical list that both destinations share.
 *
 * Every list this is used for is a genuine SET — labels, subscribers, team keys, member names, project names —
 * so ordering carries no information to lose.
 *
 * @param nodes the connection's nodes
 * @param field the string field to read off each node
 * @returns the deduped, sorted values
 */
export function connectionStrings({ nodes, field }: { nodes: readonly unknown[]; field: string }): readonly string[] {
  const values = nodes
    .map((node) => (isRecord(node) ? str({ value: node[field] }) : undefined))
    .filter((value): value is string => value !== undefined);
  return [...new Set(values)].toSorted();
}

/**
 * Linear's `reactionData` (a JSON blob of `{ emoji, userIds }` entries) as `:emoji: xN` lines — the SAME shape
 * the Slack connector already writes into `attrs.reactions`, so a downstream reader sees one convention rather
 * than one per source. Pure.
 *
 * @param value the raw `reactionData`
 * @returns the reaction lines, deduped and empty when there are none
 */
export function parseReactionData({ value }: { value: unknown }): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const emoji = str({ value: entry["emoji"] });
    if (emoji === undefined) {
      continue;
    }
    const users = entry["userIds"];
    const count = Array.isArray(users) ? users.length : 1;
    out.push(`:${emoji}: x${String(count)}`);
  }
  return [...new Set(out)];
}

/**
 * `label (url)` lines off an `externalLinks` / `links` connection — the `attrs` destination that stops these
 * from being fetched into `raw` and silently discarded. Ref-only, never bytes. Pure.
 *
 * @param nodes the connection's nodes
 * @returns the deduped link lines
 */
export function parseExternalLinks({ nodes }: { nodes: readonly unknown[] }): readonly string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const url = str({ value: node["url"] });
    if (url === undefined) {
      continue;
    }
    const label = str({ value: node["label"] });
    out.push(label === undefined ? url : `${label} (${url})`);
  }
  return [...new Set(out)].toSorted();
}

/** The plain string fields a project carries, mapped from node key to item key. */
export const PROJECT_STRING_FIELDS: readonly (readonly [string, string])[] = [
  ["description", "description"],
  ["content", "content"],
  ["health", "health"],
  ["startDate", "startDate"],
  ["targetDate", "targetDate"],
  ["completedAt", "completedAtIso"],
  ["canceledAt", "canceledAtIso"],
  ["archivedAt", "archivedAtIso"],
  ["createdAt", "createdAtIso"],
];

/**
 * Copy each present string field under its item key, dropping absent ones. Pure.
 *
 * @returns only the fields present on the node, each under its item key
 */
export function optionalStrings({
  node,
  pairs,
}: {
  node: Record<string, unknown>;
  pairs: readonly (readonly [string, string])[];
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [from, to] of pairs) {
    const value = str({ value: node[from] });
    if (value !== undefined) {
      out[to] = value;
    }
  }
  return out;
}

/**
 * A connection's nodes off any holder (empty when absent/malformed). Pure.
 *
 * @param holder the raw object carrying the connection
 * @param key the connection's field name
 * @returns the nodes, or empty when the holder or its `nodes` array is absent or the wrong shape
 */
export function connectionNodes({ holder, key }: { holder: unknown; key: string }): readonly unknown[] {
  return connectionPage({ holder, key }).nodes;
}
