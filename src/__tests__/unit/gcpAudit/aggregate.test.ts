import { describe, expect, it } from "vitest";

import { agentFamily, startCount } from "../../../gcpAudit/aggregate.js";
import type { TrimmedGcpAuditEntry } from "../../../gcpAudit/trim.js";

const entry = (over: Partial<TrimmedGcpAuditEntry> = {}): TrimmedGcpAuditEntry => ({
  authorization: [{ granted: true, permission: "secretmanager.versions.access", resource: "s" }],
  callerIp: "1.2.3.4",
  eventId: "id-1",
  eventIdSource: "insert-id",
  logKind: "data_access",
  methodName: "AccessSecretVersion",
  origin: "projects/platform-secrets",
  principal: "a@x.com",
  resourceName: "s",
  serviceName: "secretmanager.googleapis.com",
  statusCode: null,
  timestamp: "2026-01-01T00:00:00Z",
  userAgent: "google-cloud-sdk gcloud/500",
  ...over,
});

describe("agentFamily", () => {
  it("names each family off a real user agent, first match winning", () => {
    expect(agentFamily({ agent: "google-cloud-sdk gcloud/500.0.0 command/gcloud.projects.list" })).toBe("gcloud");
    expect(agentFamily({ agent: "Terraform/1.9 google-api-go/0.1" })).toBe("terraform");
    expect(agentFamily({ agent: "google-api-nodejs-client/9.15.1 gl-node/24" })).toBe("google-api-nodejs");
    expect(agentFamily({ agent: "Mozilla/5.0 (Macintosh)" })).toBe("browser");
    expect(agentFamily({ agent: "something-else" })).toBe("other");
    expect(agentFamily({ agent: null })).toBe("none");
  });
});

describe("startCount", () => {
  it("counts an entry seen through two containers once", () => {
    const counter = startCount();
    counter.add({ entry: entry() });
    counter.add({ entry: entry() });
    const summary = counter.result();
    expect(summary.unique).toBe(1);
    expect(summary.duplicates).toBe(1);
    expect(summary.calls[0]!.count).toBe(1);
  });

  it("folds calls by principal, service and method, with failures, window, kinds and agents", () => {
    const counter = startCount();
    counter.add({ entry: entry({ eventId: "1", timestamp: "2026-01-02T00:00:00Z" }) });
    counter.add({ entry: entry({ eventId: "2", statusCode: 7, timestamp: "2026-01-01T00:00:00Z", userAgent: null }) });
    expect(counter.result().calls).toEqual([
      {
        agents: ["gcloud", "none"],
        callerIps: ["1.2.3.4"],
        count: 2,
        failed: 1,
        firstSeen: "2026-01-01T00:00:00Z",
        kinds: { data_access: 2 },
        lastSeen: "2026-01-02T00:00:00Z",
        methodName: "AccessSecretVersion",
        origins: ["projects/platform-secrets"],
        principal: "a@x.com",
        serviceName: "secretmanager.googleapis.com",
      },
    ]);
  });

  it("keeps a granted and a denied use of one permission apart", () => {
    const counter = startCount();
    counter.add({ entry: entry({ eventId: "1" }) });
    counter.add({
      entry: entry({
        authorization: [{ granted: false, permission: "secretmanager.versions.access", resource: "s" }],
        eventId: "2",
      }),
    });
    expect(counter.result().uses.map((use) => [use.permission, use.granted, use.count])).toEqual([
      ["secretmanager.versions.access", true, 1],
      ["secretmanager.versions.access", false, 1],
    ]);
  });

  it("counts one event checking a permission on two resources as one use", () => {
    const counter = startCount();
    counter.add({
      entry: entry({
        authorization: [
          { granted: true, permission: "p", resource: "r1" },
          { granted: true, permission: "p", resource: "r2" },
        ],
      }),
    });
    expect(counter.result().uses.map((use) => [use.permission, use.count])).toEqual([["p", 1]]);
  });

  it("counts an entry with no authorization rows, which no plan can be read against", () => {
    const counter = startCount();
    counter.add({ entry: entry({ authorization: [] }) });
    expect(counter.result().withoutAuthorization).toBe(1);
  });
});
