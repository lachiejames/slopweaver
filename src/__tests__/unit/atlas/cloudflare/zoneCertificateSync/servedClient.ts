/*
 * The real Cloudflare client every `syncZoneCertificateKind` test file drives, over a routing fetch serving each
 * declared subtype's endpoint from `harness.ts`'s cases. The routing core is the one zone-scoped subtype suites
 * share, in `../sync/zoneSubtypeKind.ts`, and the response primitives are the ones the whole-atlas sync tests
 * share, in `../sync/httpResponses.ts`; what is this kind's is the per-subtype wire override. A plain module, not
 * a `*.test.ts`, so no test registers twice. It was split out when the zone certificate sync suite became one
 * file per behaviour.
 */
import type Cloudflare from "cloudflare";

import type { CloudflareZoneCertificateSubtype } from "../../../../../atlas/cloudflare/projection/zoneCertificateDetail.js";
import { requestedPage } from "../requestedPage.js";
import { jsonResponse, listPage } from "../sync/httpResponses.js";
import { routedSubtypeClient } from "../sync/zoneSubtypeKind.js";
import { ALL_CASES, type Wire } from "./harness.js";

/** The success body for one subtype: a list serves its items on page 1 and an empty page after, a single its enveloped payload. */
function successBody({ wire, page }: { wire: Wire; page: number }): unknown {
  if (wire.shape === "single") {
    return { result: wire.result, success: true };
  }
  return listPage({ items: wire.items, page });
}

/**
 * A real client over a routing fetch serving each case's endpoint. Any subtype named in `denied` answers 403,
 * and any subtype named in `served` serves that wire instead of its case's own. An unrouted path answers 404
 * naming it, so a wrongly-wired endpoint fails loudly. Every requested pathname is pushed onto `requests`.
 *
 * @returns the client, and the list every requested pathname is pushed onto
 */
export function servedClient({
  denied = [],
  served: overrides = {},
}: {
  denied?: readonly CloudflareZoneCertificateSubtype[];
  served?: Partial<Record<CloudflareZoneCertificateSubtype, Wire>>;
}): { client: Cloudflare; requests: string[] } {
  return routedSubtypeClient({
    cases: ALL_CASES,
    denied,
    respond: ({ served, url }) => {
      const page = requestedPage({ url });
      const override = overrides[served.subtype];
      if (override !== undefined) {
        return jsonResponse({ body: successBody({ page, wire: override }), status: 200 });
      }
      return jsonResponse({ body: successBody({ page, wire: served.wire }), status: 200 });
    },
  });
}
