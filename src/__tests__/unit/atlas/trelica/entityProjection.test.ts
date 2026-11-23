/**
 * The person, integration, contract and device projections over answers the real boundaries admit, each carrying
 * a canary in a key the boundary declares and never reads — an account's `externalId`, a connection's
 * configuration, a contract's documents, a device source's `externalId`. Each case asserts both halves: the
 * parsed input carries the canary and the held detail does not.
 */
import { describe, expect, it } from "vitest";

import { trelicaDevicesBoundary } from "../../../../atlas/trelica/assuranceBoundaries.js";
import {
  trelicaConnections,
  trelicaContractDetail,
  trelicaDeviceDetail,
  trelicaIntegrationDetail,
  trelicaPersonDetail,
} from "../../../../atlas/trelica/entityProjection.js";
import { trelicaContractsBoundary, trelicaIntegrationsBoundary } from "../../../../atlas/trelica/estateBoundaries.js";
import { trelicaPeopleBoundary } from "../../../../atlas/trelica/peopleBoundaries.js";
import { TRELICA_PROVIDER_TEXT_WITHHELD } from "../../../../atlas/trelica/providerText.js";
import { unwrap } from "../../../../lib/result.js";

const CANARY = "canary-declared-never-read";

/** One page of the given records, as every list read answers. */
function page({ items }: { items: readonly unknown[] }): unknown {
  return { items, resultsTruncated: false, total: items.length };
}

/** An owner or assignee, as Trelica embeds one. */
const OWNER = { email: "owner@example.test", id: CANARY, name: "Owner", personType: "Employee", terminated: false };

describe("trelicaPersonDetail", () => {
  it("holds each account's state and source, and never the source's own account key", () => {
    const [record] = unwrap(
      trelicaPeopleBoundary.parse({
        value: page({
          items: [
            {
              applicationCount: 3,
              deleted: false,
              id: "p1",
              isTrelicaUser: false,
              name: "Ada Leaver",
              personProviders: [
                {
                  externalId: CANARY,
                  isLifecycle: true,
                  isSuspended: false,
                  providerTitle: { "en-US": "Google Workspace" },
                  providerType: "Identity",
                },
              ],
              removedDate: "2026-09-30",
              status: "Terminated",
              statusFlags: { changingTeam: false, leaver: true, newStarter: false },
              teams: [{ name: "Ops", teamId: CANARY }],
            },
          ],
        }),
      }),
    ).items;
    const held = trelicaPersonDetail({ record: record! });

    expect(JSON.stringify(record)).toContain(CANARY);
    expect(JSON.stringify(held)).not.toContain(CANARY);
    expect(held.accounts).toEqual([
      {
        deleted: null,
        deletedAt: null,
        externalStatus: null,
        instance: null,
        lifecycle: true,
        organizationalUnit: null,
        providerType: "Identity",
        source: "Google Workspace",
        suspended: false,
        suspendedAt: null,
      },
    ]);
    expect([held.status, held.leaver, held.removedDate, held.teams]).toEqual([
      "Terminated",
      true,
      "2026-09-30",
      ["Ops"],
    ]);
  });
});

describe("trelicaIntegrationDetail", () => {
  it("holds one entry per connection with its last sync, scrubs its last error, and holds no configuration", () => {
    const counts = {
      failedAppCount: 0,
      failedAssetCount: 0,
      failedUserCount: 2,
      newUserCount: 1,
      sourceAppCount: 4,
      sourceAssetCount: 0,
      sourceUserCount: 40,
    };
    const providers = unwrap(
      trelicaIntegrationsBoundary.parse({
        value: page({
          items: [
            {
              applicationName: "Unconnected",
              supportsDeprovision: false,
              supportsProvisioning: false,
              supportsRevoke: false,
            },
            {
              applicationName: "Google Workspace",
              clients: CANARY,
              integrations: [
                {
                  app: { name: "Google Workspace", url: CANARY },
                  authorisedUserInfo: { email: "admin@example.test", userId: CANARY },
                  enabled: true,
                  id: "i1",
                  issueCount: 1,
                  lastErrorFriendlyMessage: "upstream said Bearer abcdefghijklmnopqrstuv",
                  lastResult: counts,
                  lastSyncDate: "2026-10-14T00:00:00Z",
                  needsReconnect: false,
                  parameters: { secret: CANARY },
                  postConnectFormData: CANARY,
                  status: "Warning",
                },
              ],
              parameters: CANARY,
              supportsDeprovision: true,
              supportsProvisioning: true,
              supportsRevoke: true,
            },
          ],
        }),
      }),
    ).items;
    const held = trelicaConnections({ providers }).map((entry) => trelicaIntegrationDetail({ entry }));

    expect(JSON.stringify(providers)).toContain(CANARY);
    expect(JSON.stringify(held)).not.toContain(CANARY);
    expect(held.map((entry) => [entry.provider, entry.status, entry.lastError, entry.authorisedBy.email])).toEqual([
      ["Google Workspace", "Warning", TRELICA_PROVIDER_TEXT_WITHHELD, "admin@example.test"],
    ]);
    expect(held[0]!.lastSync.failedUsers).toBe(2);
  });
});

describe("trelicaContractDetail", () => {
  it("holds the contract's terms and owners, and never its documents", () => {
    const [record] = unwrap(
      trelicaContractsBoundary.parse({
        value: page({
          items: [
            {
              agreementDate: "2026-01-01",
              annualContractValue: 1200,
              documents: [{ url: CANARY }],
              id: "c1",
              isCurrent: true,
              isOverdue: false,
              isRolling: false,
              mainCustomerAppName: "Example App",
              name: "Example App 2026",
              noticeDays: 30,
              owners: [OWNER],
              paymentMethod: "Card",
              startDate: "2026-01-01",
              status: "Active",
              totalContractValue: 1200,
              vendorName: "Example Vendor",
            },
          ],
        }),
      }),
    ).items;
    const held = trelicaContractDetail({ record: record! });

    expect(JSON.stringify(record)).toContain(CANARY);
    expect(JSON.stringify(held)).not.toContain(CANARY);
    expect([held.vendor, held.annualValue, held.renewalDate, held.owners]).toEqual([
      "Example Vendor",
      1200,
      null,
      [{ email: "owner@example.test", name: "Owner", terminated: false }],
    ]);
  });
});

describe("trelicaDeviceDetail", () => {
  it("holds who a device is assigned to and its sources, and never a source's own device key", () => {
    const [record] = unwrap(
      trelicaDevicesBoundary.parse({
        value: page({
          items: [
            {
              assetTypeName: { "en-US": "Laptop" },
              assignedTo: OWNER,
              id: "d1",
              isEncrypted: true,
              lastSyncDtm: "2026-10-14T00:00:00Z",
              manufacturerVendorName: "Example Maker",
              modelName: "Model 1",
              providers: [{ externalId: CANARY, providerName: "Example MDM", status: "Active" }],
              status: "InUse",
            },
          ],
        }),
      }),
    ).items;
    const held = trelicaDeviceDetail({ record: record! });

    expect(JSON.stringify(record)).toContain(CANARY);
    expect(JSON.stringify(held)).not.toContain(CANARY);
    expect([held.encrypted, held.assignedTo]).toEqual([
      true,
      { email: "owner@example.test", name: "Owner", terminated: false },
    ]);
  });
});
