/*
 * How `syncApiGatewayKind` treats a stored gap at the kind's own scope when every subtype is refused: it stays
 * open, because this kind makes no read there. It was split out when the API Gateway sync suite became one file
 * per behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncApiGatewayKind } from "../../../../../atlas/cloudflare/apiGatewaySync.js";
import { openCloudflareGap } from "../../../../../atlas/cloudflare/gaps.js";
import { CLOUDFLARE_API_GATEWAY_SUBTYPES } from "../../../../../atlas/cloudflare/projection/apiGateway.js";
import { unwrap } from "../../../../../lib/result.js";
import { ACCOUNT_ID, AT, KIND_SCOPE, STORED_AT, ZONE_ID } from "./harness.js";
import { servedClient } from "./servedClient.js";
import { storedFile } from "./zoneView.js";

describe("syncApiGatewayKind", () => {
  // This kind makes no read at its own scope, so a run where every subtype is refused proves nothing there.
  it("leaves a stored gap at the kind scope open when every subtype is refused", async () => {
    const { client } = servedClient({ denied: [...CLOUDFLARE_API_GATEWAY_SUBTYPES] });
    const kindGap = openCloudflareGap({
      at: STORED_AT,
      condition: "permission-refused",
      kind: "api-gateway",
      reason: "stored",
      scope: KIND_SCOPE,
    });
    const stored = storedFile({ entities: [], gaps: [kindGap] });

    const folded = unwrap(await syncApiGatewayKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }));

    expect(folded.file.gaps.filter((gap) => gap.scope === KIND_SCOPE)).toEqual([kindGap]);
    expect(folded.outcome.complete).toBe(false);
  });
});
