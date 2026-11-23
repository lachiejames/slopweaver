/**
 * The PURE parse of one Linear project node. Its optional fields come from `projectOptionals` in `parse.ts`, under
 * that file's rule that a fetched field needs a destination in `attrs` or `text`.
 */
import { isRecord } from "#lib/parsers.js";
import type { LinearProjectItem, LinearUpdateItem } from "./items.js";
import type { NestedNodes } from "./nested.js";
import { projectOptionals } from "./parse.js";
import { str, strOrEmpty } from "./parseFields.js";

/**
 * Shape one project node.
 *
 * `content` is the project's full rich-text brief and was the single biggest per-field content loss in the
 * connector — only the short `description` was ever captured. `status { name }` replaces the DEPRECATED
 * `state` the connector was still selecting. Pure.
 *
 * @param node the raw project node
 * @param updates the project's complete update list (paged to exhaustion by the caller)
 * @param nested the COMPLETED connection node lists, keyed by connection — the caller pages each to
 *   exhaustion first, so this projection never has to know it is looking at a partial list
 * @returns the shaped project, or undefined without an id + name
 */
export function parseProject({
  node,
  updates,
  nested,
}: {
  node: unknown;
  updates: readonly LinearUpdateItem[];
  /** The COMPLETED connection node lists (paged to exhaustion by the caller), keyed by connection. */
  nested: NestedNodes;
}): LinearProjectItem | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ value: node["id"] });
  const name = str({ value: node["name"] });
  if (id === undefined || name === undefined) {
    return undefined;
  }
  return {
    id,
    name,
    raw: node,
    tsIso: strOrEmpty({ value: node["updatedAt"] }),
    url: strOrEmpty({ value: node["url"] }),
    ...projectOptionals({ nested, node }),
    ...(updates.length > 0 ? { updates } : {}),
  };
}
