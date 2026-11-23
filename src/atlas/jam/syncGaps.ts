/**
 * The gaps the Jam compiled generation raises on each kind, and the rechecks that let one it stopped raising
 * close.
 *
 * Computed apart from the fold that writes them, so `syncFold.ts` folds and `sync.ts` publishes while every
 * finding the compiled channel can raise, and the measured facts behind them, sit together here.
 */
import { type JamGapRecheck, openJamGap } from "./gaps.js";
import { JAM_CENSUS } from "./generated/specLock.js";
import { JAM_SCOPES } from "./generated/surfaces.js";
import {
  JAM_OPERATION_KIND,
  JAM_PAGE_KIND,
  JAM_ROUTE_KIND,
  JAM_SCOPE_KIND,
  type JamAtlasGap,
  type JamAtlasKind,
  type JamGapCondition,
} from "./model.js";
import { JAM_MCP_SURFACE, JAM_MCP_UNBLOCKED_BY, JAM_ROUTE_SURFACE, JAM_WEB_APP_SURFACE } from "./surfaces.js";

/**
 * The three operations whose validation error does not match their own declared error schema.
 *
 * MEASURED by hand, ONCE, and recorded here rather than re-measured by the generator — probing
 * these needs a POST to an OAuth authorisation server, and an atlas whose descriptor says
 * `refuse-every-write` must not have a tool that quietly registers a client. Each answers an empty body with
 * HTTP 500 `FST_ERR_FAILED_ERROR_SERIALIZATION` where its two siblings answer a clean 400, so a client
 * cannot tell a malformed request from a broken server. Reproduce one:
 *
 * ```bash
 * curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://api.jam.dev/oauth/token   # 500
 * curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://api.jam.dev/oauth/revoke  # 400
 * ```
 */
const UNSERIALISABLE_ERROR_OPERATIONS: readonly string[] = [
  "POST /oauth/authorize",
  "POST /oauth/register",
  "POST /oauth/token",
];

/**
 * The host serving a bearer-protected resource that the published description's `servers` list omits.
 *
 * MEASURED: `https://mcp.jam.dev/mcp` answers an unauthenticated request with
 * `{"error":"invalid_token","error_description":"Access token is missing or invalid"}`, and
 * `https://mcp.jam.dev/.well-known/oauth-protected-resource` names it as a resource in Jam's own words —
 * while `https://api.jam.dev/openapi.json` declares exactly one server, `https://api.jam.dev`, and no
 * operation at all against that host.
 */
const UNDECLARED_RESOURCE_HOST = "https://mcp.jam.dev";

/** The gap every kind carries: the MCP resource has no credential on this install. */
function credentialGap({ kind, at }: { kind: JamAtlasKind; at: string }): JamAtlasGap {
  return openJamGap({
    at,
    condition: "mcp-credential-absent",
    fields: [],
    kind,
    reason:
      "no Jam access token exists in this installation, so the MCP resource has never been called and no " +
      `team, member, integration or recording of this workspace has been read. ${JAM_MCP_UNBLOCKED_BY}`,
    // Scoped per KIND rather than per surface: a gap's identity is its (condition, scope) pair, so one
    // shared scope would give five files five rows carrying the same id, and a recheck that closed it for
    // one kind would read as having closed it for all five.
    scope: `${JAM_MCP_SURFACE}:${kind}`,
    surfaces: ["api"],
  });
}

/** The two findings the published description produces on its own, with no credential and no browser. */
function operationGaps({ at }: { at: string }): readonly JamAtlasGap[] {
  return [
    openJamGap({
      at,
      condition: "published-api-declares-no-product-operation",
      fields: [],
      kind: JAM_OPERATION_KIND,
      reason:
        `the document Jam titles "Jam Public API" declares ${String(JAM_CENSUS.operations)} operation(s) ` +
        "and not one of them returns a jam, a team, a member or an integration — it is an OAuth 2.1 " +
        "authorisation server plus `GET /whoami` plus a health check. Every product noun this atlas is " +
        "asked about is reachable only through the MCP resource or the browser. Permanently open until Jam " +
        "publishes a product API; a reader who takes the operations below for the whole story would " +
        "conclude the platform offers no way to list a recording, which is false",
      scope: "openapi",
      surfaces: ["compiled"],
    }),
    openJamGap({
      at,
      condition: "endpoint-error-shape-unserialisable",
      fields: [...UNSERIALISABLE_ERROR_OPERATIONS],
      kind: JAM_OPERATION_KIND,
      reason:
        `MEASURED: ${UNSERIALISABLE_ERROR_OPERATIONS.join(", ")} each answer an empty body with ` +
        "HTTP 500 `FST_ERR_FAILED_ERROR_SERIALIZATION` — the server's own validation error does not match " +
        "its declared error schema — where `POST /oauth/introspect` and `POST /oauth/revoke` answer a clean " +
        "400. A client cannot tell a malformed request from a broken server on those three. Closed by Jam " +
        "fixing its error serialisation, not by anything in this repository",
      scope: "oauth-error-shape",
      surfaces: ["compiled"],
    }),
  ];
}

/** The two findings the scope table produces: nothing spends them, and Jam's own documents disagree. */
function scopeGaps({ at }: { at: string }): readonly JamAtlasGap[] {
  const gaps: JamAtlasGap[] = [];
  const unnamed = JAM_SCOPES.filter((scope) => scope.namedBy.length === 0).map((scope) => scope.scope);
  if (unnamed.length > 0) {
    gaps.push(
      openJamGap({
        at,
        condition: "scope-named-by-no-operation",
        fields: unnamed.toSorted((left, right) => left.localeCompare(right)),
        kind: JAM_SCOPE_KIND,
        reason:
          `all ${String(unnamed.length)} scope(s) the authorisation server declares are named by NO ` +
          "published operation: the consent screen a user is shown is strictly wider than anything the " +
          "published description can spend. Closed by Jam publishing operations that declare them",
        scope: "scopes_supported",
        surfaces: ["compiled"],
      }),
    );
  }
  const mcpClaimed = new Set(
    JAM_SCOPES.filter((scope) => scope.claimedByResources.includes("mcp-protected-resource")).map(
      (scope) => scope.scope,
    ),
  );
  const onlyApi = JAM_SCOPES.filter(
    (scope) => scope.claimedByResources.includes("api-protected-resource") && !mcpClaimed.has(scope.scope),
  )
    .map((scope) => scope.scope)
    .toSorted((left, right) => left.localeCompare(right));
  if (onlyApi.length > 0) {
    gaps.push(
      openJamGap({
        at,
        condition: "discovery-documents-disagree",
        fields: onlyApi,
        kind: JAM_SCOPE_KIND,
        reason:
          "the two protected-resource documents Jam publishes disagree about which resource these scopes " +
          "belong to: `api.jam.dev`'s names the resource `https://api.jam.dev` and claims all " +
          `${String(JAM_CENSUS.scopes)}, while \`mcp.jam.dev\`'s names the resource ` +
          "`https://mcp.jam.dev/mcp` and claims only the two `mcp:` ones. Both records are kept and neither " +
          "is preferred — `docs/atlas-intent/04-corroboration.md` applied to a disagreement INSIDE one surface",
        scope: "oauth-protected-resource",
        surfaces: ["compiled"],
      }),
    );
  }
  return gaps;
}

/** The route surface's own two: a denominator this repository chose, and a host no document declares. */
function routeGaps({ at }: { at: string }): readonly JamAtlasGap[] {
  return [
    openJamGap({
      at,
      condition: "route-denominator-is-local",
      fields: [],
      kind: JAM_ROUTE_KIND,
      reason:
        "Jam publishes no index of its own API surface, so the set of routes ASKED about is a table in this " +
        "repository. Every verdict below is the server's own; a route nobody here named is simply never " +
        "probed. Permanently open by construction, and the reason this surface is graded `discovery` rather " +
        "than `authoritative`",
      scope: JAM_ROUTE_SURFACE,
      surfaces: ["compiled"],
    }),
    openJamGap({
      at,
      condition: "undeclared-resource-host",
      fields: [UNDECLARED_RESOURCE_HOST],
      kind: JAM_ROUTE_KIND,
      reason:
        `${UNDECLARED_RESOURCE_HOST} serves a bearer-protected resource at \`/mcp\` and publishes its own ` +
        "protected-resource metadata naming it — while `https://api.jam.dev/openapi.json` declares exactly " +
        "one server, `https://api.jam.dev`, and no operation against that host at all. So the surface an " +
        "MCP client actually talks to appears in no document Jam publishes as an API. This is " +
        "`docs/atlas-intent/02-both-surfaces.md` arriving as a measured property rather than as a principle: an API-only " +
        "atlas built from the published description would answer that Jam offers no way to read a recording",
      scope: UNDECLARED_RESOURCE_HOST,
      surfaces: ["compiled"],
    }),
  ];
}

/** The browser half's two standing bounds, written by the sync so they exist before any walk has run. */
function pageGaps({ at }: { at: string }): readonly JamAtlasGap[] {
  return [
    openJamGap({
      at,
      condition: "jam-payload-withheld-on-disclosure",
      fields: [],
      kind: JAM_PAGE_KIND,
      reason:
        "a jam is a screen recording of a real working session, so its frames, console log, network log and " +
        "DOM snapshot are customer-adjacent material this atlas holds a recording's EXISTENCE and metadata " +
        "instead of. `browserPages.ts` refuses `/v/`, `/c/` and `/to/` outright, which is why there is no " +
        "`jam` kind at all. Permanently open: a bound settled before any ingest rather than a shortfall a " +
        "later run closes",
      scope: JAM_WEB_APP_SURFACE,
      surfaces: ["browser"],
    }),
    openJamGap({
      at,
      condition: "web-denominator-is-harvested",
      fields: [],
      kind: JAM_PAGE_KIND,
      reason:
        "Jam's sitemap carries 33 marketing addresses and no application route, every application path " +
        "answers the same marketing shell to an unauthenticated prober, and the application " +
        "renders almost no anchors — so the walk's denominator is the router table its own bundle declares " +
        "and nothing can widen it by crawling. Permanently open by construction",
      scope: JAM_WEB_APP_SURFACE,
      surfaces: ["browser"],
    }),
  ];
}

/**
 * Every gap one kind carries in the compiled generation.
 *
 * @param kind the kind to build gaps for
 * @param at this run's ISO timestamp
 * @returns the gaps, sorted by id so a re-run writes identical bytes
 */
export function compiledGaps({ kind, at }: { kind: JamAtlasKind; at: string }): readonly JamAtlasGap[] {
  // Every kind is named, so a kind added to the model fails to compile here rather than reading as gapless.
  const perKind: Readonly<Record<JamAtlasKind, readonly JamAtlasGap[]>> = {
    integration: [],
    operation: operationGaps({ at }),
    page: pageGaps({ at }),
    route: routeGaps({ at }),
    scope: scopeGaps({ at }),
  };
  return [credentialGap({ at, kind }), ...perKind[kind]].toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Every condition the compiled channel is able to raise on one kind, whether or not it raised it this run.
 *
 * This is what makes the gap reconciliation honest in BOTH directions. The fold accumulates, so a gap the
 * walk opened survives a sync — and without this list a compiled gap that has stopped applying would survive
 * too, open forever, because `reconcileGaps` closes only what a run says it genuinely rechecked. The sync
 * recomputes every one of these from the committed table on every run, so every one of them IS rechecked;
 * the two scope conditions are the only ones that can come back empty, and they are exactly the pair that
 * would otherwise be stuck. A pair here that this run DID observe is skipped by `reconcileGaps` rather than
 * closed, which is why listing the unconditional ones is safe and keeps the list a mirror of
 * {@link compiledGaps} rather than a subset somebody has to remember to extend.
 *
 * `unit/atlas/jam/sync.test.ts` asserts the mirroring, so the two cannot drift apart silently.
 *
 * @param kind the kind to list
 * @returns one recheck per condition, each marked resolved so an unobserved one closes
 */
export function compiledRechecks({ kind }: { kind: JamAtlasKind }): readonly JamGapRecheck[] {
  const perKind: Readonly<Partial<Record<JamAtlasKind, readonly { condition: JamGapCondition; scope: string }[]>>> = {
    operation: [
      { condition: "published-api-declares-no-product-operation", scope: "openapi" },
      { condition: "endpoint-error-shape-unserialisable", scope: "oauth-error-shape" },
    ],
    page: [
      { condition: "jam-payload-withheld-on-disclosure", scope: JAM_WEB_APP_SURFACE },
      { condition: "web-denominator-is-harvested", scope: JAM_WEB_APP_SURFACE },
    ],
    route: [
      { condition: "route-denominator-is-local", scope: JAM_ROUTE_SURFACE },
      { condition: "undeclared-resource-host", scope: UNDECLARED_RESOURCE_HOST },
    ],
    scope: [
      { condition: "scope-named-by-no-operation", scope: "scopes_supported" },
      { condition: "discovery-documents-disagree", scope: "oauth-protected-resource" },
    ],
  };
  const own = perKind[kind];
  const pairs: { condition: JamGapCondition; scope: string }[] = [
    { condition: "mcp-credential-absent", scope: `${JAM_MCP_SURFACE}:${kind}` },
  ];
  if (own !== undefined) {
    pairs.push(...own);
  }
  return pairs.map((pair) => ({ ...pair, resolved: true }));
}
