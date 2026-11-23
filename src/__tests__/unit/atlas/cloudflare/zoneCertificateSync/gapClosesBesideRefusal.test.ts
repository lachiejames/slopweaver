/*
 * How `syncZoneCertificateKind` treats stored subtype gaps when one subtype is refused: a succeeding subtype's
 * gap closes in the same run the refused subtype's stays open. It was split out when the zone certificate sync
 * suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncZoneCertificateKind } from "../../../../../atlas/cloudflare/zoneCertificateSync.js";
import { unwrap } from "../../../../../lib/result.js";
import { gapLifecycle } from "../sync/zoneSubtypeKind.js";
import { ACCOUNT_ID, AT, KIND_SCOPE, ZONE_ID } from "./harness.js";
import { servedClient } from "./servedClient.js";
import { storedFile, storedGap } from "./zoneView.js";

describe("syncZoneCertificateKind", () => {
  it("closes a succeeding subtype's stored gap in the same run another subtype is refused", async () => {
    const { client } = servedClient({ denied: ["custom-hostname"] });
    const stored = storedFile({
      entities: [],
      gaps: [
        storedGap({ condition: "pagination-incomplete", subtype: "certificate-pack" }),
        storedGap({ condition: "permission-refused", subtype: "custom-hostname" }),
      ],
    });

    const folded = unwrap(
      await syncZoneCertificateKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
    );

    expect(gapLifecycle({ file: folded.file })).toEqual([
      {
        condition: "pagination-incomplete",
        lastCheckedAt: AT,
        scope: `${KIND_SCOPE}/certificate-pack`,
        status: "closed",
      },
      { condition: "permission-refused", lastCheckedAt: AT, scope: `${KIND_SCOPE}/custom-hostname`, status: "open" },
    ]);
    expect(folded.outcome.complete).toBe(false);
  });
});
