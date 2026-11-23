/**
 * What this atlas's operation registry is generated from, pinned by digest and census, plus the findings
 * that are properties of the DOCUMENT rather than of any one operation.
 *
 * ## The authority is the platform's own OpenAPI document, and it serves it to anybody
 *
 * `GET https://api.prisma.io/v1/doc` answers an OpenAPI 3.1.0 document describing the whole Management API,
 * with no credential and no account. Prisma does not link it: it was found in the `hint` of a 422 the API
 * itself returns — _"Check the request body against the API docs at GET /v1/doc"_ — after four guessed
 * addresses (`/v1/swagger.json`, `/v1/openapi.json`, `/openapi.json`, `www.prisma.io/docs/rest-api.json`)
 * all answered 404. MEASURED. That is `docs/atlas-intent/02-both-surfaces.md`'s unknown-unknowns argument
 * arriving before the atlas even exists: the machine-readable description of this platform is reachable and
 * undocumented, which is exactly the class of thing the browser and error surfaces are mapped to find.
 *
 * ## The digest is of a LIVE document, so a moved pin is a review rather than an outage
 *
 * Unlike a pinned npm tarball, this URL answers whatever Prisma is serving right now — three consecutive
 * fetches agreed byte for byte, so it is stable minute to minute and not release to release.
 * The generator refuses when the digest moves, and the refusal distinguishes a digest-only move (Prisma
 * edited prose) from a census move (the surface changed), because those need different amounts of a
 * reviewer's attention. Nothing a USER runs fetches this: `slopweaver atlas prisma-data-platform sync`
 * reads the committed registry, so a moved document never blocks anybody — it opens a diff.
 *
 * ## The document declares no `servers` block, which is why the host is pinned here
 *
 * Every path in it is relative, and nothing in the document says what to make it relative TO. The host
 * comes from Prisma's own published examples (`curl -X GET "https://api.prisma.io/v1/databases"`) and from
 * the fact that the document is served from that host. Recording it as a pin rather than deriving it is
 * deliberate: a reader who took the paths alone would have a surface map with no address.
 */

/** The document this registry is compiled from, pinned by its own bytes. */
export const PRISMA_SPEC_PIN = {
  /** The instant the pinned bytes were fetched. */
  fetchedIso: "2026-09-06T00:01:29Z",
  /** The document's own `info.title`. Note it names Postgres, and describes far more — see the census. */
  title: "Prisma Postgres Management API",
  /** The document's own `info.version`, which is the API version rather than a release number. */
  apiVersion: "v1",
  /** The OpenAPI dialect the document declares. */
  openapi: "3.1.0",
  /** The unauthenticated address that serves it. */
  documentUrl: "https://api.prisma.io/v1/doc",
  /** SHA-256 of the served bytes. */
  documentSha256: "f02c7fb57003027202102e8598419d989a8cd133fcd2d619bcbd4a37b184394d",
  /** How many bytes those were, so a truncated fetch is a different failure from a changed document. */
  byteLength: 325935,
  /**
   * The host every declared path is relative to. NOT from the document, which declares no `servers` — see
   * this file's header.
   */
  server: "https://api.prisma.io",
} as const;

/**
 * The census the generator asserts before it writes a single row.
 *
 * It is not decoration. The Datadog registry's own census caught a lookahead in an extraction regex that
 * silently lost one operation out of 1,735, and an extraction that quietly returns 114 of 115 is
 * indistinguishable from an API that shrank.
 */
export const PRISMA_SPEC_CENSUS = {
  /** Operations by HTTP method, which is what makes the 61 mutating refusals arithmetic rather than a claim. */
  methodCounts: { DELETE: 18, GET: 54, PATCH: 8, POST: 31, PUT: 4 },
  /** Distinct `operationId`s. Equal to `operations`, which is what makes the id usable as a surface name. */
  operationIds: 115,
  operations: 115,
  paths: 72,
  /** Query, path and header parameters, counted across every operation. */
  queryParameters: 78,
  pathParameters: 128,
  headerParameters: 11,
  /** Operations declaring a request body, and the distinct field paths across those bodies. */
  requestBodies: 39,
  requestBodyFieldPaths: 143,
  /** Declared responses across every operation, and the distinct field paths inside them. */
  declaredResponses: 499,
  responseFieldPaths: 3051,
  /**
   * Named schemas under `components/schemas`. ZERO — every shape in this document is inlined at its use
   * site, which is why `responseFieldPaths` is 3,051 across 499 responses rather than a handful of `$ref`s.
   * It also means there is no schema catalogue to compare a live response against, so a future disagreement
   * detector on this platform has to walk the inline shapes.
   */
  schemas: 0,
  /** Distinct OAuth scopes named anywhere in the document. */
  scopes: 2,
  /** Tags the document DECLARES in its root `tags` array. */
  tags: 12,
  /** Tags at least one operation actually carries. THIRTEEN — see {@link PRISMA_UNDECLARED_TAGS}. */
  tagsCarriedByOperations: 13,
  /** How many operations carry `deprecated: true`. All eleven are in {@link PRISMA_DEPRECATED_OPERATIONS}. */
  deprecatedOperations: 11,
} as const;

/**
 * How the surface splits on the two facts that make this atlas worth having.
 *
 * The partition is EXACT and that is the finding: the 45 operations `www.prisma.io/docs` publishes a page
 * for are precisely the 45 that carry no `x-prisma-stability`, and the 70 marked `experimental` have no
 * documentation page at all. Neither number was chosen; the generator computes both from two independent
 * sources — the document's own extension and the docs sitemap — and refuses if they stop agreeing.
 *
 * What that means for a reader is the whole point. `www.prisma.io/docs/rest-api` describes a Management API
 * for Prisma Postgres: projects, databases, connections, backups, buckets, workspaces, service tokens.
 * The document additionally declares the whole **Prisma Compute** product — services, deployments, builds,
 * branches, custom domains, environment variables, SCM installations, source repositories and a
 * twelve-operation infrastructure-state store — reachable today and documented nowhere.
 */
export const PRISMA_STABILITY_CENSUS = {
  /** Operations carrying `x-prisma-stability: "experimental"`. */
  experimentalOperations: 70,
  /** Operations carrying no stability extension at all. */
  stableOperations: 45,
  /** Operations with a page under `www.prisma.io/docs/rest-api/endpoints/`. */
  documentedOperations: 45,
  /** Operations with no documentation page anywhere on the docs site. */
  undocumentedOperations: 70,
  /**
   * Operations that are documented AND experimental, or undocumented AND stable. ZERO both ways, which is
   * what makes the partition a finding rather than a correlation. The generator refuses if either moves,
   * because the two fields would then be saying different things and the atlas would owe a reader both.
   */
  documentedExperimentalOperations: 0,
  undocumentedStableOperations: 0,
} as const;

/**
 * Tags at least one operation carries that the document's root `tags` array does not declare.
 *
 * One member, and it is the inverse of the Figma registry's `FIGMA_UNSERVED_TAGS`: there a tag was declared
 * and served nothing, here a tag serves seven operations and is declared nowhere. `Buckets` covers Prisma's
 * whole S3-compatible object-storage surface — creating a bucket, listing buckets, and minting and revoking
 * its access keys — so a reader who built a product-area map from `tags` would omit object storage
 * entirely, while the docs site publishes all seven pages. The generator refuses if the set moves.
 */
export const PRISMA_UNDECLARED_TAGS: readonly string[] = ["Buckets"];

/**
 * Tags the document declares and no operation carries.
 *
 * EMPTY on this document, and the constant exists anyway so the generator can refuse the day that changes —
 * a declared tag with no operations is a surface the vendor has promised and not shipped, which is a
 * different fact from {@link PRISMA_UNDECLARED_TAGS} and worth telling apart.
 * @internal
 */
export const PRISMA_UNSERVED_TAGS: readonly string[] = [];

/**
 * Every operation the document marks deprecated, pinned by name so a change is a diff rather than a count.
 *
 * All eleven are under `/v1/apps`, and every one has a `/v1/services` sibling with the same shape: Prisma is
 * renaming its Compute noun from "app" to "service" in place. That is why the flag is recorded per
 * operation rather than inferred — eleven unrelated retirements and one noun being renamed look identical
 * in a count and completely different in a list.
 *
 * They stay in the registry with an ordinary disposition. A deprecated operation Prisma still serves is part
 * of the reachable surface, and an atlas that dropped them would answer "there is no way to list apps",
 * which is false today.
 */
export const PRISMA_DEPRECATED_OPERATIONS: readonly string[] = [
  "deleteV1AppsByAppId",
  "getV1Apps",
  "getV1AppsByAppId",
  "getV1AppsByAppIdDeployments",
  "getV1AppsByAppIdDomains",
  "patchV1AppsByAppId",
  "postV1Apps",
  "postV1AppsByAppIdDeployments",
  "postV1AppsByAppIdDomains",
  "postV1AppsByAppIdPromote",
  "postV1AppsByAppIdRollback",
];

/**
 * Endpoints the document NAMES and declares no operation for.
 *
 * All four are on `auth.prisma.io`, and none appears in `paths`, so a reader who enumerated the operation
 * list alone would conclude this platform has no authorization surface at all. Two come from the document's
 * own `components.securitySchemes.OAuth2` flow — and it names the token endpoint TWICE, as `tokenUrl` and
 * as `refreshUrl`, which is why three named references collapse to two addresses. The other two come from
 * the authorization server's own metadata document, which is itself an endpoint the OpenAPI document never
 * mentions.
 *
 * They are inventory content by `docs/atlas-intent/01-information-places.md` — the atlas maps every place information can be
 * reached — and every one of them has been probed, so `authEndpoints.ts` carries what each answered rather
 * than only that the document named it.
 */
export const PRISMA_UNDECLARED_ENDPOINTS: readonly {
  readonly url: string;
  readonly method: string;
  readonly namedAt: string;
  readonly holds: string;
}[] = [
  {
    holds: "the OAuth authorization step a person is sent to in a browser, which mints the grant code",
    method: "GET",
    namedAt: "components.securitySchemes.OAuth2.flows.authorizationCode.authorizationUrl",
    url: "https://auth.prisma.io/authorize",
  },
  {
    holds:
      "both the code-for-token exchange and the refresh-token rotation — ONE address the document names" +
      " twice, as `tokenUrl` and again as `refreshUrl`",
    method: "POST",
    namedAt: "components.securitySchemes.OAuth2.flows.authorizationCode.tokenUrl and .refreshUrl",
    url: "https://auth.prisma.io/token",
  },
  {
    holds: "the signing keys an access token's JWT is verified against",
    method: "GET",
    namedAt: "auth.prisma.io/.well-known/oauth-authorization-server → jwks_uri",
    url: "https://auth.prisma.io/.well-known/jwks.json",
  },
  {
    holds:
      "OAuth 2.0 dynamic client registration — an endpoint that mints a client id, named by the metadata" +
      " document and by nothing Prisma writes for a reader anywhere",
    method: "POST",
    namedAt: "auth.prisma.io/.well-known/oauth-authorization-server → registration_endpoint",
    url: "https://auth.prisma.io/register",
  },
];

/**
 * Where the document contradicts either itself or the live service, pinned so a fix is visible as a diff.
 *
 * One member, and it is the single sharpest corroboration finding this atlas has: `docs/atlas-intent/04-corroboration.md`
 * asks that the disagreement between two surfaces be an OUTPUT rather than a build-time check, and here the
 * document's machine-readable half and its human-readable half disagree about the same operation, with the
 * live service settling it.
 */
export const PRISMA_SPEC_DISAGREEMENTS: readonly {
  readonly operation: string;
  readonly documentSays: string;
  readonly liveServiceSays: string;
  readonly reading: string;
}[] = [
  {
    documentSays:
      "it declares no `security` of its own, so it inherits the document root's `[{OAuth2: […]}, {Bearer:" +
      " []}]` — which states that a credential is required",
    liveServiceSays:
      "answers `200 {\"version\":5}` with no Authorization header at all, and answers the same for two" +
      " different synthetic project and branch ids — so it neither authenticates nor resolves what it was" +
      " addressed with",
    operation: "GET /v1/projects/{projectId}/branches/{branchId}/alchemy-state/version",
    reading:
      "the operation's own `description` agrees with the live service — \"Unauthenticated contract-version" +
      " probe served verbatim from the pinned alchemy HttpStateApi contract. Returns the constant only and" +
      " never inspects the addressed project or branch\" — so the prose and the service agree and only the" +
      " `security` block is wrong. A generated client that trusted `security` would refuse to call an" +
      " endpoint anybody can call; one that trusted the description would be right. Recorded rather than" +
      " resolved: which surface wins when two disagree is the owner's call (`docs/atlas-intent/04-corroboration.md`)",
  },
];
