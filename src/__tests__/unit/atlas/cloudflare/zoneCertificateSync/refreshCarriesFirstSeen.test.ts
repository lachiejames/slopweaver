/*
 * How `syncZoneCertificateKind` refreshes an entity an earlier run stored: it keeps the stored first-seen
 * instant and takes this run's last-seen instant and detail. It was split out when the zone certificate sync
 * suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncZoneCertificateKind } from "../../../../../atlas/cloudflare/zoneCertificateSync.js";
import { unwrap } from "../../../../../lib/result.js";
import { ACCOUNT_ID, AT, CASES, STORED_AT, ZONE_ID } from "./harness.js";
import { servedClient } from "./servedClient.js";
import { storedFile } from "./zoneView.js";

describe("syncZoneCertificateKind", () => {
  it("carries a refreshed entity's stored firstSeenAt while taking this run's lastSeenAt and detail", async () => {
    const { client } = servedClient({});
    const stored = storedFile({ entities: [CASES["universal-ssl-setting"].stored({ zoneId: ZONE_ID })] });

    const folded = unwrap(
      await syncZoneCertificateKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
    );

    const setting = folded.file.entities.find((entity) => entity.providerId === "universal-ssl-setting")!;
    expect({
      detail: setting.detail,
      firstSeenAt: setting.firstSeenAt,
      lastSeenAt: setting.lastSeenAt,
      observedAt: setting.source.observedAt,
    }).toEqual({
      detail: { enabled: true, kind: "zone-certificate", subtype: "universal-ssl-setting" },
      firstSeenAt: STORED_AT,
      lastSeenAt: AT,
      observedAt: AT,
    });
  });
});
