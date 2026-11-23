/**
 * How a Nightfall operation is named, grouped and paged — the judgements the generator applies to the
 * vendor's own documents, kept out of the generated table so they are reviewable on their own.
 *
 * Every function here is total over the six pinned documents and THROWS on anything it cannot decide. That
 * is deliberate: a generator that guessed a kind would publish a plausible taxonomy nobody could check,
 * and the failure mode of this atlas is not a crash — it is a confident wrong answer about where a
 * platform keeps something.
 */

/** The vendor's own published documents, by the file name each is served under. */
export const NIGHTFALL_SPEC_DOCUMENTS = [
  "activitydlp",
  "activitylogexfil",
  "ai-governance",
  "apps",
  "oldapis",
  "postureupdate",
] as const;

/** One of the vendor's published OpenAPI documents. */
export type NightfallSpecDocument = (typeof NIGHTFALL_SPEC_DOCUMENTS)[number];

/**
 * The product areas the documents describe, named for the path segment the vendor's own base URL carries.
 *
 * `scan` is the odd one: its document declares the bare `https://api.nightfall.ai` as its server and puts
 * the version in every path, because it is the original Developer Platform API and predates the workflow
 * APIs' per-product base URLs. Naming it for its product rather than for an empty path segment keeps the
 * vocabulary a reader can use.
 */
export const NIGHTFALL_APIS = ["ai-governance", "apps", "dlp", "exfiltration", "posture", "scan"] as const;

/** One of the vendor's product APIs. */
export type NightfallApi = (typeof NIGHTFALL_APIS)[number];

/**
 * How an operation returns more than one page.
 *
 * - `page-token` — it declares a `pageToken` query parameter and a `nextPageToken` response field. Every
 *   listing operation in these documents uses exactly this pair.
 * - `none` — a single-shot read or a write.
 */
export const NIGHTFALL_PAGINGS = ["page-token", "none"] as const;

/** How an operation pages. */
export type NightfallPaging = (typeof NIGHTFALL_PAGINGS)[number];

/** Which product API one document describes. */
const API_BY_DOCUMENT: Readonly<Record<NightfallSpecDocument, NightfallApi>> = {
  activitydlp: "dlp",
  activitylogexfil: "exfiltration",
  "ai-governance": "ai-governance",
  apps: "apps",
  oldapis: "scan",
  postureupdate: "posture",
};

/**
 * Which product API a document describes.
 *
 * @param document the document's own file name
 * @returns the product API it describes
 * @internal
 */
export function nightfallApiFor({ document }: { document: NightfallSpecDocument }): NightfallApi {
  return API_BY_DOCUMENT[document];
}

/**
 * One rule mapping a path segment to a kind, within one product API.
 *
 * A table rather than a branch tree, and the reason is the gate that made it one: the branching version was
 * 72 lines at cognitive complexity 38, which is a function nobody re-reads before adding a case to it. The
 * data here is the whole judgement — an API, a position, a segment, a kind — and it is scanned in order, so
 * a more specific rule simply sits above a more general one.
 */
interface NightfallKindRule {
  /** Which product API this rule applies within. */
  readonly api: NightfallApi;
  /** Which path segment to test, counted from the front; a NEGATIVE index counts from the back. */
  readonly at: number;
  readonly kind: string;
  /** The segment value that selects this kind. */
  readonly segment: string;
}

/**
 * Every kind rule, first match winning.
 *
 * Kinds are the vendor's own resource nouns, singularised, and PREFIXED with the product API wherever two
 * APIs use the same noun for different things. `/events` under `exfiltration` and `/events` under `posture`
 * is the case that forces it: identical path, identical shape, unrelated content.
 *
 * The first row is the one that is easy to get wrong. `/violations/{violationId}/findings` is a FINDING
 * read, not a violation read, and the sub-resource has to win over the root — without it the `finding` kind
 * holds only the two annotation writes and its record shape gets derived from an `Annotation`. A shape
 * describing the wrong thing is worse than an absent one, because nothing about it looks wrong.
 */
const KIND_RULES: readonly NightfallKindRule[] = [
  { api: "dlp", at: -1, kind: "finding", segment: "findings" },
  { api: "dlp", at: 0, kind: "violation", segment: "violations" },
  { api: "dlp", at: 0, kind: "annotation", segment: "annotations" },
  { api: "dlp", at: 0, kind: "finding", segment: "findings" },
  { api: "exfiltration", at: 0, kind: "exfiltration-event", segment: "events" },
  { api: "exfiltration", at: 0, kind: "exfiltration-activity", segment: "asset" },
  { api: "exfiltration", at: 0, kind: "exfiltration-activity", segment: "actor" },
  { api: "posture", at: 0, kind: "posture-event", segment: "events" },
  { api: "posture", at: 0, kind: "posture-activity", segment: "asset" },
  { api: "posture", at: 0, kind: "posture-activity", segment: "actor" },
  { api: "ai-governance", at: 0, kind: "mcp-server", segment: "mcp-servers" },
  { api: "ai-governance", at: 0, kind: "ai-device", segment: "devices" },
  { api: "ai-governance", at: 0, kind: "plugin", segment: "plugins" },
  { api: "ai-governance", at: 0, kind: "hook", segment: "hooks" },
  { api: "ai-governance", at: 0, kind: "ide-extension", segment: "ide-extensions" },
  { api: "apps", at: 0, kind: "github-repository", segment: "github" },
  { api: "apps", at: 1, kind: "endpoint-device", segment: "devices" },
  { api: "apps", at: 1, kind: "endpoint-collection", segment: "collections" },
  { api: "apps", at: 1, kind: "endpoint-mcp-collection", segment: "mcp-collections" },
  { api: "scan", at: 1, kind: "scan", segment: "scan" },
  { api: "scan", at: 1, kind: "upload", segment: "upload" },
];

/**
 * The path's literal segments, with every `{brace}` parameter dropped.
 *
 * Parameters are dropped rather than kept because a kind is about WHAT a path addresses, and a parameter
 * names an instance rather than a resource — so `/violations/{violationId}/findings` and `/findings` reduce
 * to the same tail.
 *
 * @param path the document's own path template
 * @returns the literal segments, in path order
 */
function literalSegments({ path }: { path: string }): readonly string[] {
  return path.split("/").filter((segment) => segment.length > 0 && !segment.startsWith("{"));
}

/**
 * The atlas kind one operation contributes to, decided from its API and its own literal path segments.
 *
 * THROWS rather than defaulting, and that is deliberate: a generator that guessed a kind would publish a
 * plausible taxonomy nobody could check, and the failure mode of this atlas is not a crash but a confident
 * wrong answer about where a platform keeps something.
 *
 * @param api which product API declared the operation
 * @param path the document's own path template
 * @returns the kind name
 */
export function nightfallKindFor({ api, path }: { api: NightfallApi; path: string }): string {
  const segments = literalSegments({ path });
  const rule = KIND_RULES.find((candidate) => candidate.api === api && segments.at(candidate.at) === candidate.segment);
  if (rule === undefined) {
    throw new Error(`nightfallKindFor: no ${api} kind for ${path} — add a rule to KIND_RULES`);
  }
  return rule.kind;
}

/**
 * The registry-unique name a caller uses instead of a URL.
 *
 * Built from the API, the method and the path rather than from the document's `operationId`, because only
 * one of the six documents declares operation ids at all. A path parameter contributes its own name, so
 * `GET /violations/{violationId}` and `GET /violations/search` cannot collide.
 *
 * @param api which product API declared it
 * @param method the HTTP method
 * @param path the document's own path template
 * @returns a kebab-cased name, unique across the registry (asserted by the generator)
 */
export function nightfallOperationName({
  api,
  method,
  path,
}: {
  api: NightfallApi;
  method: string;
  path: string;
}): string {
  const segments = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => (segment.startsWith("{") ? `by-${segment.slice(1, -1)}` : segment));
  const words = [api, method.toLowerCase(), ...segments]
    .join("-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return words;
}

/**
 * The provider key a channel is matched on, byte-exactly.
 *
 * The server is in it because two of these documents declare the same path templates against different
 * base URLs — see `surfaceRow.ts`'s header for the measurement.
 *
 * @param method the HTTP method
 * @param path the document's own path template
 * @param server the document's own server URL
 * @returns `<METHOD> <server><path>`
 */
export function nightfallProviderId({
  method,
  path,
  server,
}: {
  method: string;
  path: string;
  server: string;
}): string {
  return `${method} ${server}${path}`;
}

/**
 * How an operation pages, read from what it declares rather than from its shape.
 *
 * @param queryParams every query parameter name the document declares for it
 * @param responseFields every top-level response field name the declared success schema carries
 * @returns `page-token` when it declares both halves of the cursor pair, `none` otherwise
 * @internal
 */
export function nightfallPagingFor({
  queryParams,
  responseFields,
}: {
  queryParams: readonly string[];
  responseFields: readonly string[];
}): NightfallPaging {
  const asksForACursor = queryParams.includes("pageToken");
  const returnsACursor = responseFields.includes("nextPageToken");
  if (asksForACursor && returnsACursor) {
    return "page-token";
  }
  return "none";
}
