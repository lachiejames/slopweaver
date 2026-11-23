/**
 * The shapes of the four committed tables `generated/surfaces.ts` satisfies, hand-written and kept beside
 * the generator's output rather than inside it.
 *
 * The TYPE is reviewable independently of the rows that satisfy it — a generated file nobody reads is a poor
 * place to discover that a field changed meaning. `tools/generateJamSurfaces.ts` is what writes the rows,
 * and `--verify` is what refuses a table whose census has moved.
 */

/** One published document, pinned by digest. */
export interface JamSpecPin {
  readonly byteLength: number;
  /** The document's own `info.title`, e.g. `Jam Public API`. */
  readonly documentTitle: string;
  /** This atlas's own stable handle for the document — `openapi`, `authorization-server`, `protected-*`. */
  readonly id: string;
  readonly operationCount: number;
  readonly pathCount: number;
  /** The security schemes the document declares, sorted; empty when it declares none. */
  readonly securitySchemes: readonly string[];
  /** The first server URL the document declares, or the empty string for a discovery document. */
  readonly serverUrl: string;
  readonly sha256: string;
  readonly url: string;
  /** The document's own `info.version`, or `unversioned` when it publishes none. */
  readonly version: string;
}

/** One published API operation, as the pinned description declares it. */
export interface JamOperationRow {
  /** Whether this atlas may call it. */
  readonly callable: boolean;
  /** Why it is not callable, or `null` when it is. */
  readonly excludedBecause: string | null;
  /** The kind this row is filed under. Always `operation`; carried so the table is self-describing. */
  readonly kind: "operation";
  readonly method: string;
  /** Every declared parameter name, sorted. */
  readonly parameters: readonly string[];
  readonly path: string;
  /** Response field paths to the declared depth, `[]` marking an array, sorted. */
  readonly responseFields: readonly string[];
  /** The scopes the description says this operation needs. */
  readonly scopes: readonly string[];
  /** The security schemes it declares, sorted. */
  readonly security: readonly string[];
  readonly serverUrl: string;
  /** The description's own summary, or `null`. */
  readonly synopsis: string | null;
  /** The description's own tag, or `null`. */
  readonly tag: string | null;
}

/** One OAuth scope the authorization server declares. */
export interface JamScopeRow {
  /** Which protected-resource documents claim it, by this atlas's own document ids, sorted. */
  readonly claimedByResources: readonly string[];
  /** Which published operations name it, sorted. */
  readonly namedBy: readonly string[];
  readonly scope: string;
}

/** One route the credential-free probe asked about, and what the server answered. */
export interface JamRouteRow {
  readonly contentType: string;
  readonly host: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  /**
   * Whether this row is the probe's own CONTROL — a path that must not exist. A table whose control stopped
   * answering `not-routed` is measuring nothing, and `sync.ts` refuses to publish one.
   */
  readonly control: boolean;
  readonly verdict: "answered" | "routed-no-leaf" | "not-routed" | "indeterminate";
}

/** One integration Jam publishes a page for. */
export interface JamIntegrationRow {
  readonly pageUrl: string;
  readonly slug: string;
}
