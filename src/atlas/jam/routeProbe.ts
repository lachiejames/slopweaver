/**
 * The oracle that lets this atlas establish a route's EXISTENCE on Jam's own hosts with no credential, and
 * the control that keeps its negative honest.
 *
 * ## The oracle, measured rather than assumed
 *
 * MEASURED against `api.jam.dev` and `mcp.jam.dev`, both fronted by the same edge and answering
 * with byte-identical response headers. Two different 404s come back, and the difference is which layer
 * produced them:
 *
 * - a path the APPLICATION router received answers `application/json` with Fastify's own not-found body,
 *   which NAMES the method and path — `{"message":"Route GET:/mcp not found","error":"Not Found", …}`;
 * - a path the edge never routed to the application answers `text/plain` with a flat `404 Not Found`.
 *
 * So a served PREFIX is establishable without an account: `GET https://api.jam.dev/mcp` answers the first
 * and `GET https://api.jam.dev/health` answers the second, on the same host in the same second. Reproduce
 * the pair:
 *
 * ```bash
 * curl -sS -w '\n%{content_type}\n' https://api.jam.dev/mcp
 * curl -sS -w '\n%{content_type}\n' https://api.jam.dev/health
 * ```
 *
 * ## What a verdict does NOT establish, stated because it is the easy over-claim
 *
 * `routed-no-leaf` says the application received the request and has no handler for that METHOD and PATH. It
 * says nothing about whether a sibling path under the same prefix exists, and `not-routed` is a fact about
 * the pair rather than about the path: a path served only for `POST` answers `not-routed` to a `GET` probe
 * on some edge configurations. Every row therefore carries its own method, and the atlas's `route` kind is
 * graded `discovery` rather than `authoritative` for exactly this reason.
 *
 * ## The control, and why the table refuses without it
 *
 * A probe whose negative has stopped firing is measuring nothing: a host that began answering the JSON
 * not-found to everything would fill this atlas with routes that do not exist and nothing would notice. So
 * every probed host is also asked for {@link JAM_CONTROL_PATH}, which cannot exist, and `sync.ts` refuses to
 * publish a table whose control rows are not all `not-routed`. The method is WorkOS's; the oracle is Jam's.
 */

import type { JamRouteVerdict } from "./model.js";

/**
 * A path that must not exist on any Jam host, probed alongside the real candidates.
 *
 * Deliberately unlovely, so it cannot become a real route by accident.
 */
export const JAM_CONTROL_PATH = "/zzz-control-must-not-exist";

/** The content type Jam's edge answers with when it never routed the request to the application. */
const EDGE_NOT_FOUND_CONTENT_TYPE = "text/plain";

/** The content type the application router's own not-found body carries. */
const APPLICATION_NOT_FOUND_CONTENT_TYPE = "application/json";

/**
 * Grade one probed response.
 *
 * @param statusCode the status the server returned
 * @param contentType the response's own content type header, or the empty string when it sent none
 * @returns what the pair establishes about the route
 */
export function jamRouteVerdictFor({
  statusCode,
  contentType,
}: {
  statusCode: number;
  contentType: string;
}): JamRouteVerdict {
  if (statusCode !== 404) {
    return "answered";
  }
  if (contentType.startsWith(EDGE_NOT_FOUND_CONTENT_TYPE)) {
    return "not-routed";
  }
  // Deliberately not an `else`: a 404 carrying neither shape — an absent header, an HTML error page from an
  // edge that has changed — is a response this oracle cannot read, and both remaining verdicts would be an
  // over-claim. See `model.ts` on why `indeterminate` is a member rather than a fallback to the safer-looking
  // of two guesses.
  return contentType.startsWith(APPLICATION_NOT_FOUND_CONTENT_TYPE) ? "routed-no-leaf" : "indeterminate";
}

/**
 * The rule that decided one verdict, in English, for the stored row.
 *
 * A verdict with no stated rule is a number a reader has to take on trust, and this atlas's whole claim on
 * the route surface rests on a distinction two 404s make.
 *
 * @param verdict what the probe concluded
 * @returns the sentence to store beside it
 */
export function jamRouteVerdictBecause({ verdict }: { verdict: JamRouteVerdict }): string {
  if (verdict === "answered") {
    return "the server answered with something other than 404, so this method and path are served";
  }
  if (verdict === "routed-no-leaf") {
    return (
      "the 404 came back as JSON naming the method and path, which is the application router's own " +
      "not-found — so the edge routes this prefix to the application and the application has no handler " +
      "for this exact method and path"
    );
  }
  if (verdict === "not-routed") {
    return (
      "the 404 came back as flat text/plain, which is the edge answering before the application saw the " +
      "request — so this method and path are not routed at all. A fact about the PAIR, never about the path"
    );
  }
  return (
    "the 404 carried neither of the two content types this oracle reads, so nothing was established: " +
    "grading it either way would assert a served prefix, or an absence, on no evidence at all"
  );
}
