/**
 * Pure readers over the unvalidated nodes a Linear verification pass reads back: a string or a bare `{ id }`
 * off one node, the id-to-name index the pass resolves, and the shaped facts indexed by identifier. The pass
 * itself is `./verify.ts`.
 */
import { isRecord } from "../../lib/parsers.js";
import type { LinearLiveFacts } from "./verifyDocument.js";

/** The id-to-name maps a citation's facts need, resolved once per verification pass. */
export interface LinearNameIndex {
  readonly users: ReadonlyMap<string, string>;
  readonly states: ReadonlyMap<string, string>;
  readonly projectStatuses: ReadonlyMap<string, string>;
}

/** An empty index — what a pass with nothing to resolve uses, rather than a nullable one. */
export const NO_NAMES: LinearNameIndex = { projectStatuses: new Map(), states: new Map(), users: new Map() };

/**
 * A defined, non-empty string off an unvalidated record, else undefined. Pure.
 *
 * @returns the string under `key`, or undefined when it is absent, empty or not a string
 */
export function fieldString({ node, key }: { node: Record<string, unknown>; key: string }): string | undefined {
  const value = node[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** A nested `{ displayName }` / `{ name }` off an unvalidated record, else undefined. Pure. */
function nestedName({
  node,
  key,
  field,
}: {
  node: Record<string, unknown>;
  key: string;
  field: string;
}): string | undefined {
  const holder = node[key];
  return isRecord(holder) ? fieldString({ key: field, node: holder }) : undefined;
}

/**
 * The id under a bare `{ id }` relation reference, else undefined. Pure.
 *
 * @returns the relation's id, or undefined when the relation is absent or carries none
 */
export function nestedId({ node, key }: { node: Record<string, unknown>; key: string }): string | undefined {
  return nestedName({ field: "id", key, node });
}

/**
 * Index the shaped facts of one connection response by the identifier a citation keys on. Pure.
 *
 * @returns the shaped facts keyed by identifier, omitting every node the shaper could not key
 */
export function factsByIdentifier({
  nodes,
  names,
  shape,
}: {
  nodes: readonly Record<string, unknown>[];
  names: LinearNameIndex;
  shape: (args: { node: Record<string, unknown>; names: LinearNameIndex }) => LinearLiveFacts | undefined;
}): ReadonlyMap<string, LinearLiveFacts> {
  const facts = new Map<string, LinearLiveFacts>();
  for (const node of nodes) {
    const shaped = shape({ names, node });
    if (shaped !== undefined) {
      facts.set(shaped.identifier, shaped);
    }
  }
  return facts;
}
