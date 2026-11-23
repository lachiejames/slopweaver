/**
 * The five surface names this atlas reports coverage under, and what each one claims.
 *
 * In one module rather than beside their writers, because the two publishers and the reader all name them
 * and a surface spelled differently in two places is a coverage cell that silently never gets replaced —
 * `coverage.ts`'s `withJamCoverageCell` filters on exactly this string.
 */

/**
 * The compiled surface: what Jam's own published documents declare.
 *
 * Public, credential-free, and therefore a claim about the PRODUCT rather than about this workspace. It is
 * one OpenAPI description plus the three OAuth discovery documents `api.jam.dev` and `mcp.jam.dev` serve.
 */
export const JAM_SPEC_SURFACE = "published-api";

/**
 * The measured route-existence surface.
 *
 * `discovery` and never more: a probe establishes that a path is SERVED and nothing at all about what it
 * would answer to a credential. `routeProbe.ts` carries the oracle and its control.
 */
export const JAM_ROUTE_SURFACE = "route-probe";

/**
 * The live MCP resource: the reads that would fill this workspace's own entities.
 *
 * Has no credential in this installation, and the cells written under it say so rather than staying absent.
 */
export const JAM_MCP_SURFACE = "mcp-resource";

/** The browser channel's PAGE coverage — which routes were reached, and how each answered. */
export const JAM_WEB_APP_SURFACE = "web-app";

/**
 * The browser channel's OBSERVED-OPERATION coverage.
 *
 * A separate surface from the pages, because they answer different questions and one can succeed while the
 * other does not: a walk can reach every page and observe no call at all.
 */
export const JAM_WEB_CLIENT_SURFACE = "web-client-operations";

/**
 * What a caller must do to fill the MCP surface.
 *
 * Named in every `not-configured` cell rather than left as "configure a credential", because a cell that
 * cannot say WHAT would unblock it is a complaint. The registration endpoint is Jam's own dynamic-client
 * one, so no console visit is needed — what is needed is a person completing the authorisation-code grant,
 * which is a credential widening rather than a piece of work.
 */
export const JAM_MCP_UNBLOCKED_BY =
  "register a client at `POST https://api.jam.dev/oauth/register`, complete the authorization-code grant " +
  "for the `mcp:read` scope against `https://api.jam.dev/oauth/authorize`, then " +
  "`slopweaver secrets set jam-access-token`";

/**
 * What a caller must do to fill the browser surface.
 */
export const JAM_BROWSER_UNBLOCKED_BY =
  "run `slopweaver atlas jam walk`, which visits the application's own routes in the owner's own Chrome " +
  "through the shared Playwright extension transport";
