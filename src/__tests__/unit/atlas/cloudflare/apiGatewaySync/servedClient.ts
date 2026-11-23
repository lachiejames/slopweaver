/*
 * The real Cloudflare client every `syncApiGatewayKind` test file drives, over a routing fetch serving each
 * declared subtype's endpoint from `harness.ts`'s cases. The routing core is the one zone-scoped subtype suites
 * share, in `../sync/zoneSubtypeKind.ts`, and the JSON response primitive is the whole-atlas sync tests' own, in
 * `../sync/httpResponses.ts`; what is this kind's is the success body a bare-bodied subtype needs. A plain
 * module, not a `*.test.ts`, so no test registers twice. It was split out when the API Gateway sync suite became
 * one file per behaviour.
 */
import type Cloudflare from "cloudflare";

import type { CloudflareApiGatewaySubtype } from "../../../../../atlas/cloudflare/projection/apiGateway.js";
import { requestedPage } from "../requestedPage.js";
import { jsonResponse } from "../sync/httpResponses.js";
import { routedSubtypeClient } from "../sync/zoneSubtypeKind.js";
import { ALL_CASES, type Wire } from "./harness.js";

/** The success body for one subtype: a list serves its items on page 1 and an empty page after, a single its enveloped payload, a bare one its body as is. */
function successBody({ wire, page }: { wire: Wire; page: number }): unknown {
  if (wire.shape === "bare") {
    return wire.body;
  }
  if (wire.shape === "single") {
    return { result: wire.result, success: true };
  }
  const items = page === 1 ? wire.items : [];
  return { result: items, result_info: { count: items.length, page }, success: true };
}

/**
 * A real client over a routing fetch serving each case's endpoint. Any subtype named in `denied` answers 403.
 * An unrouted path answers 404 naming it, so a wrongly-wired endpoint fails loudly. Every requested pathname
 * is pushed onto `requests`.
 *
 * @returns the client, and the list every requested pathname is pushed onto
 */
export function servedClient({ denied = [] }: { denied?: readonly CloudflareApiGatewaySubtype[] }): {
  client: Cloudflare;
  requests: string[];
} {
  return routedSubtypeClient({
    cases: ALL_CASES,
    denied,
    respond: ({ served, url }) =>
      jsonResponse({ body: successBody({ page: requestedPage({ url }), wire: served.wire }), status: 200 }),
  });
}
