/**
 * The PURE parse of one Linear document node, under `parse.ts`'s rule that a fetched field needs a destination in
 * `attrs` or `text`.
 */
import { isRecord } from "#lib/parsers.js";
import type { LinearDocumentItem } from "./items.js";
import { displayName, nestedStr, optionalStrings, str, strOrEmpty } from "./parseFields.js";

/**
 * Shape one document node.
 *
 * The parent bindings (`project`/`initiative`/`issue`/`team`/`creator`/`owner`) were ALL dropped before, so
 * documents landed in the corpus context-free — a spec with no indication of what it specified. They are now
 * folded into the record's searchable text as well as its attrs, because `retrievalIndex.ts` indexes
 * title/text/refs and a binding that lives only in `attrs` cannot be searched for. Pure.
 *
 * @param node the raw document node
 * @returns the shaped document, or undefined without an id + title
 */
export function parseDocumentNode({ node }: { node: unknown }): LinearDocumentItem | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const id = str({ value: node["id"] });
  const title = str({ value: node["title"] });
  if (id === undefined || title === undefined) {
    return undefined;
  }
  const project = nestedStr({ key: "name", value: node["project"] });
  const initiative = nestedStr({ key: "name", value: node["initiative"] });
  const issue = nestedStr({ key: "identifier", value: node["issue"] });
  const team = nestedStr({ key: "key", value: node["team"] });
  const creator = displayName({ value: node["creator"] });
  const owner = displayName({ value: node["owner"] });
  return {
    id,
    raw: node,
    title,
    tsIso: strOrEmpty({ value: node["updatedAt"] }),
    url: strOrEmpty({ value: node["url"] }),
    ...optionalStrings({
      node,
      pairs: [
        ["content", "content"],
        ["createdAt", "createdAtIso"],
        ["archivedAt", "archivedAtIso"],
      ],
    }),
    ...(project !== undefined ? { project } : {}),
    ...(initiative !== undefined ? { initiative } : {}),
    ...(issue !== undefined ? { issue } : {}),
    ...(team !== undefined ? { team } : {}),
    ...(creator !== undefined ? { creator } : {}),
    ...(owner !== undefined ? { owner } : {}),
  };
}
