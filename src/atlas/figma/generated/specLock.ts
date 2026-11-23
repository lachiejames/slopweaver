/**
 * What this atlas's operation registry is generated from, pinned by package version, digest and census.
 *
 * ## The authority is Figma's OWN OpenAPI document, and Figma publishes it as an npm package
 *
 * `@figma/rest-api-spec` carries `openapi/openapi.yaml` — the document Figma's own REST reference is built
 * from, versioned in lockstep with the API surface it describes. That is a better artifact than either
 * sibling this generator was modelled on had available: the Airtable atlas had to raw-decode its document
 * out of a rendered page because Airtable publishes no file at all, and the Nightfall atlas had to pin two
 * documents by URL because its vendor ships only what its docs site loads. Here the vendor ships a
 * versioned, immutable, digest-addressed tarball, so the pin is exact and the fetch is one registry read.
 *
 * ## Two digests, because they prove different things
 *
 * {@link FIGMA_SPEC_PIN.tarballSha256} is the whole published package as npm serves it, which is what makes
 * "version 0.42.0" mean one specific set of bytes rather than a label. {@link FIGMA_SPEC_PIN.specSha256} is
 * the `openapi.yaml` member inside it, which is the only file this atlas reads — so a package that
 * republished with a new README moves the first digest and not the second, and the generator can say which
 * happened. Both are the file's own bytes; neither is a re-serialisation, so no canonicalisation step sits
 * between the vendor's artifact and the pin.
 *
 * ## What a digest match does and does not prove
 *
 * It proves the document is byte-for-byte the one that was reviewed. It does NOT prove Figma's API is
 * exactly these 54 operations, and on this platform the shortfall is unusually easy to name: the document
 * itself references three OAuth endpoints it declares no path for ({@link FIGMA_UNDECLARED_ENDPOINTS}), and
 * no operation anywhere returns the set of teams a credential can see, so every team-scoped call needs an
 * id that only the browser can supply. `descriptor.ts` states both, and `browserPages.ts` is the surface
 * that answers them.
 *
 * ## Reproduce every number here
 *
 * ```bash
 * yarn tsx tools/generateFigmaSurfaces.ts --verify   # fetch, extract, and check both pins and the census
 * yarn tsx tools/generateFigmaSurfaces.ts            # rewrite ./surfaces.ts and review the diff
 * ```
 */

/** Where the document is fetched from, which member of it is read, and what both are pinned at. */
export const FIGMA_SPEC_PIN = {
  /** The document's own `info.title`. */
  title: "Figma API",
  /** The npm package Figma publishes the document in. */
  packageName: "@figma/rest-api-spec",
  /** The pinned release. Equal to the document's own `info.version`, which is what makes the label usable. */
  packageVersion: "0.42.0",
  /** The OpenAPI version the document declares. */
  openapi: "3.1.0",
  /** The one member of the tarball this atlas reads. */
  specPath: "package/openapi/openapi.yaml",
  /** SHA-256 of `openapi.yaml`'s own bytes, exactly as the tarball carries them. */
  specSha256: "d7ab5681d84cbf3398084e5182583b53ab73da21a3bc8b6cb0d8cf5409350a5c",
  /** Byte length of `openapi.yaml`, so a truncated extraction fails on the cheaper check first. */
  specByteLength: 400016,
  /** The immutable tarball npm serves for this exact release. */
  tarballUrl: "https://registry.npmjs.org/@figma/rest-api-spec/-/rest-api-spec-0.42.0.tgz",
  /** SHA-256 of the tarball's own bytes. */
  tarballSha256: "2c50a8f24bde11cd772f3adfd34bc4d1778d5806a497ec9b1529c0c366e30e7a",
  /** The single API host every declared operation is relative to, from the document's own `servers`. */
  server: "https://api.figma.com",
} as const;

/**
 * The census the generator asserts before it writes a single row.
 *
 * It is not decoration. The Datadog registry's own census caught a lookahead in an extraction regex that
 * silently lost one operation out of 1,735, and an extraction that quietly returns 53 of 54 is
 * indistinguishable from an API that shrank.
 */
export const FIGMA_SPEC_CENSUS = {
  /** How many operations carry `deprecated: true`. All four are named in {@link FIGMA_DEPRECATED_OPERATIONS}. */
  deprecatedOperations: 4,
  /** Operations by HTTP method, which is what makes the 11 mutating refusals arithmetic rather than a claim. */
  methodCounts: { DELETE: 4, GET: 42, POST: 6, PUT: 2 },
  /** Distinct `operationId`s. Equal to `operations`, which is what makes the id usable as a surface name. */
  operationIds: 54,
  operations: 54,
  paths: 47,
  /** Named schemas under `components/schemas`. */
  schemas: 230,
  /** Distinct OAuth scopes named across every operation's `security`. */
  scopes: 22,
  /** Tags the document DECLARES. Unlike Airtable's, every one of them carries at least one operation. */
  tags: 18,
  /** Tags at least one operation carries. Equal to `tags` — see {@link FIGMA_UNSERVED_TAGS}. */
  tagsWithOperations: 18,
} as const;

/**
 * How many operations accept each declared security scheme.
 *
 * The interesting row is `OrgOAuth2` at one. Exactly one operation in Figma's whole REST surface —
 * `getActivityLogs` — is reachable with an organisation-scoped OAuth grant, which says that an org-level
 * integration can read the activity log and nothing else at all. That is a posture fact an atlas can answer
 * for free and a reader would otherwise have to derive by hand from 54 `security` blocks.
 */
export const FIGMA_AUTH_METHOD_CENSUS = {
  OAuth2: 50,
  OrgOAuth2: 1,
  PersonalAccessToken: 50,
  PlanAccessToken: 44,
} as const;

/**
 * Tags the document declares and serves no operation for.
 *
 * EMPTY on this document, and the constant exists anyway so the generator can refuse the day that changes.
 * The Airtable registry's equivalent has a member (`workflow`, its noun for automations), and that
 * asymmetry is worth stating rather than leaving as a blank: Figma's tag list is honest about its own
 * coverage, so this atlas's "the API cannot reach this" findings come from
 * {@link FIGMA_UNDECLARED_ENDPOINTS} and from `browserPages.ts` instead — not from a tag that promises a
 * surface and ships nothing.
 */
export const FIGMA_UNSERVED_TAGS: readonly string[] = [];

/**
 * The tags whose EVERY operation is deprecated.
 *
 * One member. All three operations under `Projects` carry `deprecated: true`, so Figma has retired a whole
 * declared surface in place rather than removing it — and the replacement is visible from the other side of
 * the atlas: `browserPages.ts` records that `www.figma.com/files/project/{projectId}` answers
 * `resource_type=folder` on its sign-in redirect, which is the v2 `Folders` vocabulary arriving in the
 * browser gate for the noun the v1 API still calls a project. That is `docs/atlas-intent/04-corroboration.md`'s
 * corroboration between two surfaces producing a finding neither surface states on its own.
 */
export const FIGMA_FULLY_DEPRECATED_TAGS: readonly string[] = ["Projects"];

/**
 * Every operation the document marks deprecated, pinned by name so a change is a diff rather than a count.
 *
 * They stay in the registry with an ordinary disposition. A deprecated operation Figma still serves is part
 * of the reachable surface, and an atlas that dropped it would answer "there is no way to list a team's
 * projects", which is false today.
 */
export const FIGMA_DEPRECATED_OPERATIONS: readonly string[] = [
  "getProjectFiles",
  "getProjectMeta",
  "getTeamProjects",
  "getTeamWebhooks",
];

/**
 * Endpoints the document NAMES and declares no operation for.
 *
 * All three sit in `components.securitySchemes`, where the OAuth2 flow gives its authorization, token and
 * refresh URLs — real, callable, first-party endpoints that appear in no `paths` entry, so a reader who
 * enumerated `paths` alone would conclude Figma has no OAuth surface at all. They are inventory content by
 * `docs/atlas-intent/01-information-places.md`: the atlas maps every place information can be reached, and a documented
 * endpoint that the document's own operation list omits is exactly the kind of thing that goes missing.
 *
 * Note the host split, which is itself the finding: the authorization step is on `www.figma.com` while the
 * token exchange is on `api.figma.com`, so the OAuth surface straddles the API host and the web app — the
 * one place in this platform where the two surfaces this atlas maps are not merely complementary but joined.
 */
export const FIGMA_UNDECLARED_ENDPOINTS: readonly {
  readonly url: string;
  readonly method: string;
  readonly namedAt: string;
  readonly holds: string;
}[] = [
  {
    holds: "the OAuth authorization step a person is sent to in a browser, which mints the grant code",
    method: "GET",
    namedAt: "components.securitySchemes.OAuth2.flows.authorizationCode.authorizationUrl",
    url: "https://www.figma.com/oauth",
  },
  {
    holds: "the exchange that turns an authorization code into an access token",
    method: "POST",
    namedAt: "components.securitySchemes.OAuth2.flows.authorizationCode.tokenUrl",
    url: "https://api.figma.com/v1/oauth/token",
  },
  {
    holds: "the refresh that mints a new access token from a refresh token",
    method: "POST",
    namedAt: "components.securitySchemes.OAuth2.flows.authorizationCode.refreshUrl",
    url: "https://api.figma.com/v1/oauth/refresh",
  },
];
