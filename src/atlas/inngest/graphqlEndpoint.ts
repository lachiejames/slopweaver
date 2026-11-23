/**
 * The one surface here that no published source declares, and the reason a probe cannot open it.
 *
 * `api.inngest.com/gql` is the endpoint the dashboard's own client talks to — the entry bundle names it
 * directly — and it is a first-class Inngest API rather than an implementation detail. It publishes no
 * schema document, and introspection is switched off:
 *
 * ```bash
 * curl -s https://api.inngest.com/gql -H 'content-type: application/json' \
 *   -d '{"query":"query { __schema { types { name } } }"}'
 * # {"errors":[{"message":"introspection disabled","path":["__schema"]}],"data":{"__schema":null}}
 * ```
 *
 * MEASURED. That command is in this comment rather than in the sync ON PURPOSE: it is a POST, and
 * this atlas sends only GETs — the read-through-POST exemption is deliberately not taken here, exactly as the
 * Twilio atlas declines it. What the sync DOES send is a GET, which establishes that the endpoint exists and
 * is a GraphQL server without carrying a document at all; the introspection finding is recorded as a
 * permanent `graphql-introspection-disabled` gap carrying the command above, so a reader can settle it
 * themselves in one line.
 *
 * The consequence is the whole reason the `graphql-operation` kind exists: with no schema and no
 * introspection, the ONLY census of this surface is what the dashboard's own client is watched sending, and
 * that census is a FLOOR rather than a denominator. `docs/atlas-intent/02-both-surfaces.md` is the claim this platform
 * proves hardest — an API-only atlas here would report that Inngest offers no GraphQL API at all.
 */
import { ok, type Result } from "../../lib/result.js";

import type { InngestProbeTransport } from "./transport.js";

/**
 * The endpoint the dashboard's own client talks to.
 *
 * @internal
 */
export const INNGEST_GRAPHQL_URL = "https://api.inngest.com/gql";

/** The one line a reader runs to settle the introspection finding themselves. */
export const INNGEST_GRAPHQL_INTROSPECTION_REPRO =
  `curl -s ${INNGEST_GRAPHQL_URL} -H 'content-type: application/json' ` +
  `-d '{"query":"query { __schema { types { name } } }"}'`;

/** What a GET to the GraphQL endpoint established. */
export interface InngestGraphqlProbeResult {
  /** True when the endpoint answered at all, whatever it answered. */
  readonly reachable: boolean;
  readonly note: string;
}

/**
 * Ask the GraphQL endpoint what it answers to a request carrying no document.
 *
 * A GraphQL server answers such a request with a validation error rather than a 404, which is enough to
 * establish that the endpoint is there and what kind of server it is. No document is sent, so nothing is
 * queried and nothing is written.
 *
 * @param probeTransport how an address's answer is obtained
 * @returns what the endpoint answered, or why no request could be made at all
 */
export async function probeInngestGraphql({
  probeTransport,
}: {
  probeTransport: InngestProbeTransport;
}): Promise<Result<InngestGraphqlProbeResult>> {
  const answer = await probeTransport({ url: INNGEST_GRAPHQL_URL });
  if (answer.isErr()) {
    return ok({ note: answer.error.join("; "), reachable: false });
  }
  return ok({
    note: `GET ${INNGEST_GRAPHQL_URL} answered ${String(answer.value.status)} to a request carrying no document`,
    reachable: true,
  });
}
