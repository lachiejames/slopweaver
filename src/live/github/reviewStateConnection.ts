/**
 * The GraphQL shape readers `./reviewState.ts` parses a pull-request node with: a field, an actor, and whether a
 * connection came back whole. Whole matters most, because an absent review is only an absence when the page that
 * would have held it is complete.
 *
 * Pure.
 */
import { isRecord } from "#lib/parsers.js";

/**
 * A string field, or the empty string — the fail-loud spelling this repo prefers over a nullable.
 *
 * @returns the string, or `""` when the field is not one
 */
export function str({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}

/**
 * A nested `{ login }` object's login, or the empty string.
 *
 * @returns the login, or `""` for an actor GitHub no longer resolves
 */
export function login({ value }: { value: unknown }): string {
  return isRecord(value) ? str({ value: value["login"] }) : "";
}

/**
 * Whether GitHub typed an actor a `Bot` — the only word on it, since GraphQL drops the REST `[bot]` suffix.
 *
 * @returns true for a `Bot` actor
 */
export function isBotActor({ value }: { value: unknown }): boolean {
  return isRecord(value) && value["__typename"] === "Bot";
}

/**
 * A GraphQL connection's `nodes` array, defensively unwrapped to the records it holds.
 *
 * @returns the records, empty when the connection or its `nodes` is missing
 */
export function nodesOf({ connection }: { connection: unknown }): readonly Record<string, unknown>[] {
  if (!isRecord(connection) || !Array.isArray(connection["nodes"])) {
    return [];
  }
  return connection["nodes"].filter(isRecord);
}

/**
 * Whether a connection reported more items than the page asked for.
 *
 * @returns true when `pageInfo.hasNextPage` is true
 */
export function hasNextPage({ connection }: { connection: unknown }): boolean {
  const info = isRecord(connection) ? connection["pageInfo"] : undefined;
  return isRecord(info) && info["hasNextPage"] === true;
}

/**
 * Whether a connection the query selected came back whole: a record, its `nodes` an array of records, exactly
 * as many as its numeric `totalCount`. GitHub answers a node it could not resolve as `null` beside partial
 * data, and a dropped null, a short page or a missing connection would otherwise read as a complete page —
 * nobody reviewed. A capped page is short by this measure too, whichever end the query read from.
 *
 * @returns true only for a complete page
 */
export function connectionIntact({ connection }: { connection: unknown }): boolean {
  if (!isRecord(connection) || typeof connection["totalCount"] !== "number") {
    return false;
  }
  const nodes = connection["nodes"];
  return Array.isArray(nodes) && nodes.every(isRecord) && nodes.length === connection["totalCount"];
}

/**
 * A connection's own `totalCount`, or zero when GitHub reported none.
 *
 * @returns the count
 */
export function totalCountOf({ connection }: { connection: unknown }): number {
  const total = isRecord(connection) ? connection["totalCount"] : undefined;
  return typeof total === "number" ? total : 0;
}
