/*
 * The records a queue card may name by a bare id, each with the address its chip opens: the ids a muted-monitor card and a leavers card name, such as `TTX-2` / `HRS-29`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { VantaEntity } from "../../../atlas/vanta/model.js";
import { monitorRecordFacts, recordReferenceFacts, vantaRecordFacts } from "../../../cli/recordReferenceFacts.js";
import type { CatalogueManifest } from "../../../datadog/detective/catalogue.js";

/** A census manifest whose only populated part is what the table reads: its site and its monitors. */
function manifest({ site, names }: { site: string; names: readonly string[] }): CatalogueManifest {
  return {
    builtAtIso: "2026-10-06T00:00:00.000Z",
    map: {
      dashboards: [],
      edges: [],
      entities: [],
      indexes: [],
      metricNamespaces: [],
      monitors: names.map((name, index) => ({ id: 50001 + index, name, query: "q", type: "log alert" })),
      pipelines: [],
      rumApplications: [],
    },
    notMeasured: [],
    products: [],
    retentionDays: null,
    rows: 0,
    schemaVersion: 1,
    services: [],
    site,
    window: { fromIso: "2026-10-05T00:00:00.000Z", toIso: "2026-10-06T00:00:00.000Z" },
  };
}

/** One Vanta entity as the atlas stores it, with the manage-api detail the table reads. */
function entity({
  kind,
  providerId,
  detail,
  sensitive = false,
}: {
  kind: "control" | "risk";
  providerId: string;
  detail: Record<string, unknown>;
  sensitive?: boolean;
}): VantaEntity {
  return {
    channels: {
      browser: null,
      "manage-api": {
        channel: "manage-api",
        detail,
        firstSeenAt: "2026-10-06T00:00:00.000Z",
        lastSeenAt: "2026-10-06T00:00:00.000Z",
        source: {
          artifacts: [],
          channel: "manage-api",
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: `/${kind}s`,
          observedAt: "2026-10-06T00:00:00.000Z",
        },
        state: "observed",
      },
    },
    financialDetail: null,
    id: `entity-${providerId}`,
    kind,
    providerId,
    sensitivity: sensitive ? { handleWithCare: true, providerMarkedSensitive: true } : null,
  };
}

describe("monitorRecordFacts", () => {
  it("links every mapped monitor on its site's console host, titled by its name", () => {
    expect(
      monitorRecordFacts({
        manifest: manifest({ names: ["[ERROR] {{service.name}}", ""], site: "ap1.datadoghq.com" }),
      }),
    ).toEqual([
      {
        id: "50001",
        kind: "datadog-monitor",
        title: "[ERROR] {{service.name}}",
        url: "https://ap1.datadoghq.com/monitors/50001",
      },
      { id: "50002", kind: "datadog-monitor", title: undefined, url: "https://ap1.datadoghq.com/monitors/50002" },
    ]);
  });

  it("links none when the census names a site no console is known for", () => {
    expect(monitorRecordFacts({ manifest: manifest({ names: ["a"], site: "example.com" }) })).toEqual([]);
  });
});

describe("vantaRecordFacts", () => {
  it("links a printed control to its own page and a printed risk to the register", () => {
    const facts = vantaRecordFacts({
      controls: [
        entity({
          detail: { externalId: "HRS-29", name: "Access revoked upon termination" },
          kind: "control",
          providerId: "access-revoked-termination-gdpr",
        }),
        entity({ detail: { externalId: "200", name: "a bare number" }, kind: "control", providerId: "bare" }),
      ],
      risks: [
        entity({ detail: { description: "Access Management & Account Lifecycle" }, kind: "risk", providerId: "TTX-2" }),
        entity({ detail: { description: "a sensitive one" }, kind: "risk", providerId: "TTX-3", sensitive: true }),
        entity({ detail: { description: "unprinted" }, kind: "risk", providerId: "risk-uuid-1" }),
      ],
      tenantSlug: "acme",
    });
    expect(facts).toEqual([
      {
        id: "HRS-29",
        kind: "vanta-control",
        title: "Access revoked upon termination",
        url: "https://app.vanta.com/c/acme/controls?controlId=access-revoked-termination-gdpr",
      },
      {
        id: "TTX-2",
        kind: "vanta-risk",
        title: "Access Management & Account Lifecycle",
        url: "https://app.vanta.com/c/acme/risk-management/risk-register",
      },
      {
        id: "TTX-3",
        kind: "vanta-risk",
        title: undefined,
        url: "https://app.vanta.com/c/acme/risk-management/risk-register",
      },
    ]);
  });
});

describe("recordReferenceFacts", () => {
  let home = "";

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("publishes none for a home with no census and no Vanta tenant", () => {
    home = mkdtempSync(join(tmpdir(), "record-facts-"));
    expect(recordReferenceFacts({ env: {}, home })).toEqual([]);
  });
});
