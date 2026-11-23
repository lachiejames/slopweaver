/**
 * Turn what the first-party Linear client asked for into atlas rows — the root fields its own documents
 * selected, and the response field paths those fields handed back. PURE.
 *
 * ## This file IS the redaction, which is why it is committed rather than scripted
 *
 * A walk of a real workspace's settings pages captures real GraphQL traffic: team names, member names,
 * label names, integration configuration, and every variable the client sent. The atlas's `operation` kind
 * must record what the API can DO, never what this workspace contains — so the reduction has to be a thing
 * a reviewer reads and a test pins, not a transformation somebody trusts. The Slack atlas learned this the
 * expensive way: its first reduction shipped real object ids into a committed file because it only
 * looked for timestamps.
 *
 * Two things follow, and both are properties rather than intentions. **No variable is ever read** — this
 * module takes the DOCUMENT out of a request and nothing else, so a variables object cannot reach a stored
 * record by any path. And every response path goes through the kit's value-dropping walk with
 * {@link LINEAR_SEGMENTS}, so an id used as a map key becomes `<id>`.
 *
 * ## Attribution comes from the REQUEST, because response keys are aliases
 *
 * The obvious reduction — read `data`'s own keys as schema root field names — is unsound, and a Codex
 * review pass caught it before it shipped: `query { latest: issues { … } }` answers under
 * `data.latest`, a name the schema does not declare. A comparator built on response keys would report that
 * as an undocumented operation, which is a fabricated finding in an atlas whose entire purpose is real
 * ones. So `graphqlDocument.ts` parses the document the client actually sent, and this module maps each
 * response key back through it.
 *
 * ## What it refuses to guess
 *
 * A captured request with no readable document — a persisted query sending only a hash — is COUNTED and not
 * attributed. `projection.ts` turns that count into a `request-shape-unresolved` gap. The same applies to a
 * response key the document does not explain, which is what a client-only field looks like from here.
 */
import { isRecord } from "../../lib/parsers.js";
import { resolveRootFields } from "../kit/graphqlDocument.js";
import { responseFieldPaths, type SegmentClassifier } from "../kit/responseShape.js";
import type { LinearOperationBrowserDetail } from "./model.js";

/**
 * How deep a response path is kept.
 *
 * Three, matching the Slack atlas, because that is where a connection's own leaf lives: `nodes[].team.key`
 * is three segments and is exactly the kind of path that makes a browser observation worth comparing.
 * @internal
 */
export const PATH_DEPTH = 3;

/**
 * How many paths one operation keeps.
 *
 * A cap rather than a filter, and the count that was cut is stored beside it — so a truncated list says it
 * is truncated instead of reading like a complete one.
 * @internal
 */
export const BROWSER_PATH_CAP = 400;

/** A Linear id: a lower-case UUID, which is what this API uses for every object and as map keys. */
const LINEAR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A bare run of digits, which a client uses to key a map by count or index. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Linear's own value-segment shapes, handed to the kit's redaction pass.
 *
 * Neither shape collapses with its neighbour: Linear's ids are single tokens rather than a dotted pair, so
 * two adjacent ones were two distinct values and folding them would lose a level of the path.
 *
 * @param segment one dot-separated path segment
 * @returns how to redact it, or `null` when it is a genuine field name
 *
 * @internal
 */
export const LINEAR_SEGMENTS: SegmentClassifier = ({ segment }) => {
  if (LINEAR_UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<id>" };
  }
  return DIGITS_ONLY.test(segment) ? { collapsesWithPrevious: false, placeholder: "<n>" } : null;
};

/** One captured GraphQL exchange, as the page transport hands it over. */
export interface CapturedGraphqlResponse {
  /** The address the response came from, so a non-GraphQL capture can be discarded here. */
  readonly url: string;
  /** The parsed response body. */
  readonly body: unknown;
  /** The request body the client posted, when the transport captured one. */
  readonly requestBody?: string;
}

/** What the browser channel saw, keyed by the SCHEMA root field the document selected. */
interface LinearBrowserObservation {
  /** `<rootKind>.<fieldName>` — the same key the API channel stores, so a match is byte-exact. */
  readonly providerId: string;
  readonly detail: LinearOperationBrowserDetail;
}

/** Everything one walk's captures reduced to. */
export interface LinearBrowserObservations {
  readonly observations: readonly LinearBrowserObservation[];
  /** How many captured exchanges were GraphQL at all. */
  readonly graphqlResponses: number;
  /**
   * How many GraphQL exchanges carried no readable document, so nothing was attributed from them. A
   * persisted query looks exactly like this, and so does a capture that lost its request body.
   */
  readonly unresolvedRequests: number;
  /**
   * Response keys a document did explain nothing about — a client-only field, or a document whose operation
   * the envelope named differently. Sorted, and never attributed.
   */
  readonly unexplainedKeys: readonly string[];
}

/**
 * Rewrite a response path's ALIASED segments back to the schema names the document asked for.
 *
 * Segment by segment, because an alias is declared at a level: `latest.displayName` may alias `displayName`
 * without aliasing anything above it. Array markers (`[]`) are stripped for the lookup and put back, since
 * a document aliases a field rather than an element.
 *
 * @param aliases the alias-to-schema-name map for this root field, keyed by dotted response path
 * @param path one dotted response path, straight from the walk
 * @returns the path with every aliased segment replaced by the field the schema declares
 * @internal
 */
export function unaliasPath({ aliases, path }: { aliases: ReadonlyMap<string, string>; path: string }): string {
  if (aliases.size === 0) {
    return path;
  }
  const rebuilt: string[] = [];
  const walked: string[] = [];
  for (const segment of path.split(".")) {
    const markers = segment.length - segment.replace(/\[\]/g, "").length;
    const bare = segment.replace(/\[\]/g, "");
    // A LEADING array marker is its own segment with no field name — `[].ident` splits to `["[]","ident"]`.
    // Pushing its empty name would make the lookup key `.ident` and the alias would never resolve, which a
    // Codex review pass produced as a counterexample against a root field returning a direct list.
    if (bare !== "") {
      walked.push(bare);
    }
    const real = bare === "" ? undefined : aliases.get(walked.join("."));
    rebuilt.push(real === undefined ? segment : `${real}${"[]".repeat(markers / 2)}`);
  }
  return rebuilt.join(".");
}

/** Whether one captured exchange came from Linear's GraphQL endpoint. */
function isGraphqlResponse({ url }: { url: string }): boolean {
  try {
    return new URL(url).pathname.endsWith("/graphql");
  } catch {
    return false;
  }
}

/** The `data` object out of a GraphQL response envelope, or `null` when there is none to walk. */
function dataOf({ body }: { body: unknown }): Record<string, unknown> | null {
  if (!isRecord(body)) {
    return null;
  }
  const data = body["data"];
  return isRecord(data) ? data : null;
}

/**
 * Reduce a walk's captured exchanges to one row per SCHEMA root field the client actually selected.
 *
 * @param responses every exchange the walk captured, GraphQL or not
 * @returns the observations, the GraphQL exchange count, and everything deliberately not attributed
 */
export function observationsFromResponses({
  responses,
}: {
  responses: readonly CapturedGraphqlResponse[];
}): LinearBrowserObservations {
  const byRootField = new Map<string, RootFieldTally>();
  const unexplained = new Set<string>();
  let graphqlResponses = 0;
  let unresolvedRequests = 0;

  for (const response of responses) {
    if (!isGraphqlResponse({ url: response.url })) {
      continue;
    }
    graphqlResponses += 1;
    const folded = foldExchange({ byRootField, response, unexplained });
    unresolvedRequests += folded.unresolved ? 1 : 0;
  }

  return {
    graphqlResponses,
    observations: [...byRootField.entries()]
      .map(([providerId, entry]): LinearBrowserObservation => {
        const paths = [...entry.paths].toSorted();
        return {
          detail: {
            callCount: entry.calls,
            responsePaths: paths.slice(0, BROWSER_PATH_CAP),
            responsePathsTotal: paths.length,
          },
          providerId,
        };
      })
      .toSorted((left, right) => left.providerId.localeCompare(right.providerId)),
    unexplainedKeys: [...unexplained].toSorted(),
    unresolvedRequests,
  };
}

/** How often one root field was answered, and every field path its answers carried. */
interface RootFieldTally {
  calls: number;
  paths: Set<string>;
}

/** The tally a root field already holds, or a fresh empty one the first time a response reaches it. */
function tallyFor({ held }: { held: RootFieldTally | undefined }): RootFieldTally {
  if (held == null) {
    return { calls: 0, paths: new Set<string>() };
  }
  return held;
}

/**
 * Fold ONE GraphQL exchange into the accumulators.
 *
 * Split out because it carries every judgement the reduction makes: whether a document was readable at all,
 * which schema root field a response key stands for, and what to do with a key no document explains. The
 * loop above is then only a loop.
 *
 * @param byRootField the per-root-field accumulator to fill
 * @param response the captured exchange
 * @param unexplained the set collecting response keys no document accounts for
 * @returns whether this exchange carried no readable document, so the caller can count it
 */
function foldExchange({
  byRootField,
  response,
  unexplained,
}: {
  byRootField: Map<string, RootFieldTally>;
  response: CapturedGraphqlResponse;
  unexplained: Set<string>;
}): { readonly unresolved: boolean } {
  const resolved = resolveRootFields({ requestBody: response.requestBody });
  if (resolved.rootFields.length === 0) {
    return { unresolved: true };
  }
  const data = dataOf({ body: response.body });
  if (data === null) {
    return { unresolved: false };
  }
  for (const [responseKey, value] of Object.entries(data)) {
    // `resolveRootFields` sets both maps for one response key in the same step, so a key the document
    // explains has its root field and its alias table together, and a key it does not explain has neither.
    const providerId = resolved.keyToRootField.get(responseKey);
    const aliases = resolved.aliasPaths.get(responseKey);
    if (providerId === undefined || aliases === undefined) {
      unexplained.add(responseKey);
      continue;
    }
    const entry = tallyFor({ held: byRootField.get(providerId) });
    entry.calls += 1;
    for (const path of responseFieldPaths({ body: value, classify: LINEAR_SEGMENTS, depthCap: PATH_DEPTH })) {
      entry.paths.add(unaliasPath({ aliases, path }));
    }
    byRootField.set(providerId, entry);
  }
  return { unresolved: false };
}
