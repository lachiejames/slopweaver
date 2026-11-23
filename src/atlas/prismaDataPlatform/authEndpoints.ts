/**
 * `auth.prisma.io` — the third surface of this platform, which neither of the other two declares a path for.
 *
 * ## Why it is a surface rather than a footnote
 *
 * The OpenAPI document names three addresses on this host inside `components.securitySchemes` and declares
 * no operation for any of them, so a reader enumerating `paths` would conclude the platform has no
 * authorization surface at all. The console never navigates to it in anything a signed-out browser can see.
 * And the host publishes an RFC 8414 metadata document that names two MORE endpoints — a JWKS and an OAuth
 * dynamic client registration endpoint — that appear in no Prisma documentation anywhere.
 *
 * That is `docs/atlas-intent/01-information-places.md` in one host: the set of all places information can be found, including
 * the ones no single published artifact lists.
 *
 * ## And unlike the console, this origin DISCRIMINATES
 *
 * MEASURED against a control that answers 404: `/authorize` answers 400, `/token` and
 * `/register` answer 405 (they are POST-only), both `.well-known` documents answer 200, and `/userinfo`,
 * `/logout` and `/.well-known/openid-configuration` answer the control's own 404. So every row below is
 * confirmed, and three NEGATIVES are confirmed too — which is the part a reader cannot get anywhere else.
 *
 * The sharpest of those negatives: **`/.well-known/openid-configuration` and `/userinfo` are both absent.**
 * Prisma runs OAuth 2.0, not OpenID Connect. A reader who assumed OIDC — a reasonable assumption for a
 * platform whose tokens are JWTs verified against a JWKS — would build an integration around an identity
 * layer that is not there, and would find out at runtime rather than from this atlas.
 *
 * ```bash
 * yarn tsx tools/probePrismaDataPlatformSurface.ts --auth          # print each endpoint's evidence class
 * yarn tsx tools/probePrismaDataPlatformSurface.ts --auth --verify # exit non-zero if a row moved
 * ```
 */

/**
 * What an unauthenticated request established about one authorization-server endpoint.
 *
 * - `serves-200` — it answered a document with no credential.
 * - `rejects-400` — it answered a bad-request, so it exists and wanted parameters this probe deliberately
 *   did not send.
 * - `method-not-allowed-405` — it exists and refuses GET, which is how a POST-only endpoint proves itself
 *   to a probe that will not send a POST.
 * - `absent-404` — the control's own answer. Probed, and NOT there.
 * @internal
 */
export const PRISMA_AUTH_EVIDENCE = ["serves-200", "rejects-400", "method-not-allowed-405", "absent-404"] as const;

/**
 * What an unauthenticated request established about one authorization-server endpoint.
 * @internal
 */
export type PrismaAuthEvidence = (typeof PRISMA_AUTH_EVIDENCE)[number];

/** One endpoint on the authorization server. */
export interface PrismaAuthEndpoint {
  /** What a signed-out probe established. */
  readonly evidence: PrismaAuthEvidence;
  /** What this endpoint is for, in a reader's words. */
  readonly holds: string;
  /** Where this atlas learned the endpoint exists at all, before probing it. */
  readonly namedBy: "openapi-security-scheme" | "authorization-server-metadata" | "probe-only";
  /** The path on {@link PRISMA_AUTH_ORIGIN}. */
  readonly path: string;
}

/** The origin every authorization endpoint hangs off. */
export const PRISMA_AUTH_ORIGIN = "https://auth.prisma.io";

/**
 * The control every verdict on this origin is measured against. It answers 404.
 * @internal
 */
export const PRISMA_AUTH_CONTROL = "/zzz-not-a-real-endpoint-control";

/**
 * Every authorization-server endpoint this atlas has established, sorted by path.
 *
 * Nine rows: six that exist and three that do not. The three absences are as much of the deliverable as the
 * six presences — see this file's header on why a missing OIDC layer is the useful half.
 */
export const PRISMA_AUTH_ENDPOINTS: readonly PrismaAuthEndpoint[] = [
  {
    evidence: "serves-200",
    holds: "the authorization server's own landing page, served as HTML to anybody",
    namedBy: "probe-only",
    path: "/",
  },
  {
    evidence: "absent-404",
    holds:
      "nothing. An OpenID Connect discovery document would live here and does not, so this platform is" +
      " OAuth 2.0 without an identity layer — recorded so a reader learns the negative from the atlas",
    namedBy: "probe-only",
    path: "/.well-known/openid-configuration",
  },
  {
    evidence: "serves-200",
    holds:
      "the RFC 8414 authorization-server metadata: the issuer, the authorization, token and registration" +
      " endpoints, the JWKS address, `response_types_supported: [code]`," +
      " `code_challenge_methods_supported: [S256]` and the three client authentication methods. It is the" +
      " only machine-readable description of this surface Prisma publishes, and nothing links to it",
    namedBy: "probe-only",
    path: "/.well-known/oauth-authorization-server",
  },
  {
    evidence: "serves-200",
    holds: "the JSON Web Key Set an access token's signature is verified against",
    namedBy: "authorization-server-metadata",
    path: "/.well-known/jwks.json",
  },
  {
    evidence: "rejects-400",
    holds:
      "the authorization step a person is sent to in a browser, which mints the grant code. PKCE is" +
      " mandatory for a public client and optional-but-sticky for a confidential one",
    namedBy: "openapi-security-scheme",
    path: "/authorize",
  },
  {
    evidence: "absent-404",
    holds: "nothing. The authorization server has no sign-out endpoint of its own",
    namedBy: "probe-only",
    path: "/logout",
  },
  {
    evidence: "method-not-allowed-405",
    holds:
      "OAuth 2.0 dynamic client registration, which mints a client id. Named by the metadata document and" +
      " by no Prisma documentation page at all — the published OAuth guide tells a reader to create an" +
      " application by hand in the console instead",
    namedBy: "authorization-server-metadata",
    path: "/register",
  },
  {
    evidence: "method-not-allowed-405",
    holds:
      "both the code-for-token exchange and the refresh-token rotation. The OpenAPI document names this" +
      " one address twice, as `tokenUrl` and as `refreshUrl`",
    namedBy: "openapi-security-scheme",
    path: "/token",
  },
  {
    evidence: "absent-404",
    holds:
      "nothing. The OIDC userinfo endpoint is absent, which is consistent with the missing discovery" +
      " document: the caller's identity is read from `GET /v1/me` on the management API instead",
    namedBy: "probe-only",
    path: "/userinfo",
  },
];

/**
 * Every endpoint on this origin whose existence is confirmed.
 *
 * @returns the rows that are not `absent-404`
 */
export function prismaConfirmedAuthEndpoints(): readonly PrismaAuthEndpoint[] {
  return PRISMA_AUTH_ENDPOINTS.filter((row) => row.evidence !== "absent-404");
}

/**
 * Every endpoint on this origin confirmed NOT to be there.
 *
 * @returns the `absent-404` rows
 */
export function prismaAbsentAuthEndpoints(): readonly PrismaAuthEndpoint[] {
  return PRISMA_AUTH_ENDPOINTS.filter((row) => row.evidence === "absent-404");
}
