/*
 * How `syncApiGatewayKind` refreshes an entity an earlier run stored: it keeps the stored first-seen instant
 * and takes this run's last-seen instant and detail. It was split out when the API Gateway sync suite became one
 * file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncApiGatewayKind } from "../../../../../atlas/cloudflare/apiGatewaySync.js";
import { unwrap } from "../../../../../lib/result.js";
import { ACCOUNT_ID, AT, CASES, STORED_AT, ZONE_ID } from "./harness.js";
import { servedClient } from "./servedClient.js";
import { storedFile } from "./zoneView.js";

describe("syncApiGatewayKind", () => {
  it("carries a refreshed entity's stored firstSeenAt while taking this run's lastSeenAt and detail", async () => {
    const { client } = servedClient({});
    const stored = storedFile({ entities: [CASES.settings.stored({ zoneId: ZONE_ID })] });

    const folded = unwrap(await syncApiGatewayKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }));

    const settings = folded.file.entities.find((entity) => entity.providerId === "settings")!;
    expect({
      detail: settings.detail,
      firstSeenAt: settings.firstSeenAt,
      lastSeenAt: settings.lastSeenAt,
      observedAt: settings.source.observedAt,
    }).toEqual({
      detail: {
        kind: "api-gateway",
        subtype: "settings",
        validationDefaultMitigationAction: "log",
        validationOverrideMitigationAction: null,
      },
      firstSeenAt: STORED_AT,
      lastSeenAt: AT,
      observedAt: AT,
    });
  });
});
