/*
 * How `syncApiGatewayKind` treats stored gaps when one subtype is refused: a succeeding subtype's stored gap
 * closes in the same run the refused subtype's stays open. It was split out when the API Gateway sync suite
 * became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncApiGatewayKind } from "../../../../../atlas/cloudflare/apiGatewaySync.js";
import { unwrap } from "../../../../../lib/result.js";
import { gapLifecycle } from "../sync/zoneSubtypeKind.js";
import { ACCOUNT_ID, AT, KIND_SCOPE, ZONE_ID } from "./harness.js";
import { servedClient } from "./servedClient.js";
import { storedFile, storedGap } from "./zoneView.js";

describe("syncApiGatewayKind", () => {
  it("closes a succeeding subtype's stored gap in the same run another subtype is refused", async () => {
    const { client } = servedClient({ denied: ["operation"] });
    const stored = storedFile({
      entities: [],
      gaps: [
        storedGap({ condition: "pagination-incomplete", subtype: "label" }),
        storedGap({ condition: "permission-refused", subtype: "operation" }),
      ],
    });

    const folded = unwrap(await syncApiGatewayKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }));

    expect(gapLifecycle({ file: folded.file })).toEqual([
      { condition: "pagination-incomplete", lastCheckedAt: AT, scope: `${KIND_SCOPE}/label`, status: "closed" },
      { condition: "permission-refused", lastCheckedAt: AT, scope: `${KIND_SCOPE}/operation`, status: "open" },
    ]);
    expect(folded.outcome.complete).toBe(false);
  });
});
