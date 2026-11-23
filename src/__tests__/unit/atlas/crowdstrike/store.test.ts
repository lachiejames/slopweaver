import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { crowdstrikeKindFileSchema, crowdstrikeManifestSchema } from "../../../../atlas/crowdstrike/entities.js";
import { CROWDSTRIKE_KINDS } from "../../../../atlas/crowdstrike/model.js";
import {
  CROWDSTRIKE_STORE_SPEC,
  crowdstrikeAtlasPaths,
  publishCrowdstrikeAtlas,
} from "../../../../atlas/crowdstrike/store.js";
import { unwrapErr } from "../../../../lib/result.js";

const SOURCE = {
  artifacts: [],
  deepLink: "https://falcon.example-cloud.test/host-management/hosts",
  deepLinkStatus: "provider-provided" as const,
  endpoint: "/devices/entities/devices/v2",
  observedAt: "2026-09-04T00:00:00.000Z",
  surface: "falcon-api",
};

const HOST = {
  agentVersion: "7.20.1",
  firstSeenAt: "2026-09-04T00:00:00.000Z",
  firstSeenAtProvider: null,
  groupIds: [],
  hidden: false,
  hostname: "EXAMPLE-LAPTOP-1",
  id: "abc123",
  kernelVersion: null,
  lastLoginAccount: "example.person",
  lastLoginAt: null,
  lastSeenAt: null,
  macAddress: "00-11-22-33-44-55",
  onlineState: "online",
  osBuild: null,
  osVersion: "Sonoma (14.6)",
  platformName: "Mac",
  preventionPolicyApplied: true,
  preventionPolicyId: "p1",
  productTypeDesc: "Workstation",
  providerId: "aid-1",
  reducedFunctionalityMode: "no",
  rtrState: "unknown",
  sensorUpdatePolicyApplied: true,
  sensorUpdatePolicyId: "s1",
  serialNumber: "SERIAL-1",
  source: SOURCE,
  state: "observed" as const,
  status: "normal",
  systemManufacturer: "Example Inc.",
  systemProductName: "ExampleBook Pro",
};

/** What every kind file carries besides its own entities. */
const ENVELOPE = { coverage: [], gaps: [], schemaVersion: 1, updatedAt: "2026-09-04T00:00:00.000Z" } as const;

/** A manifest grading every declared kind — the shape the publish guard requires. */
function completeManifest(): unknown {
  const kinds: Record<string, unknown> = {};
  for (const kind of CROWDSTRIKE_KINDS) {
    kinds[kind] = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  }
  return { kinds, schemaVersion: 1, updatedAt: "2026-09-04T00:00:00.000Z" };
}

describe("crowdstrikeKindFileSchema", () => {
  it("accepts a host file carrying a projected host", () => {
    const parsed = crowdstrikeKindFileSchema.safeParse({ ...ENVELOPE, entities: [HOST], kind: "host" });
    expect(parsed.success).toBe(true);
  });

  it("refuses a detection stored in the hosts file", () => {
    const detection = { ...HOST, hostAid: "aid-1", severity: 70 };
    const parsed = crowdstrikeKindFileSchema.safeParse({ ...ENVELOPE, entities: [detection], kind: "host" });
    expect(parsed.success).toBe(false);
  });

  it("refuses a provider field nobody admitted", () => {
    const smuggled = { ...HOST, external_ip: "203.0.113.7" };
    const parsed = crowdstrikeKindFileSchema.safeParse({ ...ENVELOPE, entities: [smuggled], kind: "host" });
    expect(parsed.success).toBe(false);
  });

  it("refuses a file written by a different schema version", () => {
    const parsed = crowdstrikeKindFileSchema.safeParse({ ...ENVELOPE, entities: [], kind: "host", schemaVersion: 2 });
    expect(parsed.success).toBe(false);
  });

  it("requires a console request to say it is not callable", () => {
    const request = {
      callability: "executable",
      id: "r1",
      method: "GET",
      observedOnPages: [],
      paramNames: [],
      pathShape: "/api2/devices/queries/devices/v1",
      firstSeenAt: "2026-09-04T00:00:00.000Z",
      providerId: "GET /api2/devices/queries/devices/v1",
      responseFieldPaths: [],
      source: SOURCE,
      state: "observed" as const,
      statusCodes: [200],
    };
    const parsed = crowdstrikeKindFileSchema.safeParse({ ...ENVELOPE, entities: [request], kind: "console-request" });
    expect(parsed.success).toBe(false);
  });
});

describe("CROWDSTRIKE_STORE_SPEC.guardPublish", () => {
  it("admits a manifest grading every declared kind", () => {
    const manifest = crowdstrikeManifestSchema.parse(completeManifest());
    const guarded = CROWDSTRIKE_STORE_SPEC.guardPublish!({ next: manifest, prior: null });
    expect(guarded.isOk()).toBe(true);
  });

  // The count check moved to `kit/store.ts` — it is a property of the partial-set publish protocol rather
  // than of this atlas — so it is asserted here through the real publish path, which is where a CrowdStrike
  // caller meets it. `src/__tests__/unit/atlas/kit/storeCoherence.test.ts` is where the kit's own falsifiers
  // live.
  it("REFUSES a count that describes a file the generation never wrote, through the kit", () => {
    const root = mkdtempSync(join(tmpdir(), "crowdstrike-store-"));
    const claimed = completeManifest() as { kinds: Record<string, unknown> };
    claimed.kinds["host"] = { digest: null, entityCount: 161, lastAttempt: null, lastSuccessAt: null };
    const problems = unwrapErr(
      publishCrowdstrikeAtlas({
        files: {},
        manifest: crowdstrikeManifestSchema.parse(claimed),
        paths: crowdstrikeAtlasPaths({ home: root }),
        derivedFrom: null,
      }),
    );
    expect(problems[0]).toContain("host is graded with 161 entities but carries no file digest");
    expect(problems[1]).toBe("nothing was written — this generation is not published");
    expect(existsSync(crowdstrikeAtlasPaths({ home: root }).manifest)).toBe(false);
    rmSync(root, { force: true, recursive: true });
  });

  it("REFUSES a success that can never be graded for freshness", () => {
    const claimed = completeManifest() as { kinds: Record<string, unknown> };
    claimed.kinds["vulnerability"] = {
      digest: "d",
      entityCount: 0,
      lastAttempt: { at: "2026-09-04T00:00:00.000Z", outcome: "ok", reasons: [] },
      lastSuccessAt: null,
    };
    const manifest = crowdstrikeManifestSchema.parse(claimed);
    const problems = unwrapErr(CROWDSTRIKE_STORE_SPEC.guardPublish!({ next: manifest, prior: null }));
    expect(problems[0]).toContain("vulnerability records a successful attempt but no success time");
  });

  it("refuses an ungradable success through the kit with every line, the unpublished line printed twice", () => {
    const root = mkdtempSync(join(tmpdir(), "crowdstrike-store-"));
    const claimed = completeManifest() as { kinds: Record<string, unknown> };
    claimed.kinds["vulnerability"] = {
      digest: null,
      entityCount: 0,
      lastAttempt: { at: "2026-09-04T00:00:00.000Z", outcome: "ok", reasons: [] },
      lastSuccessAt: null,
    };
    const problems = unwrapErr(
      publishCrowdstrikeAtlas({
        derivedFrom: null,
        files: {},
        manifest: crowdstrikeManifestSchema.parse(claimed),
        paths: crowdstrikeAtlasPaths({ home: root }),
      }),
    );
    expect(problems).toEqual([
      "vulnerability records a successful attempt but no success time, so its freshness can never be graded",
      "nothing was written — this generation is not published",
      "nothing was written — this generation is not published",
    ]);
    expect(existsSync(crowdstrikeAtlasPaths({ home: root }).manifest)).toBe(false);
    rmSync(root, { force: true, recursive: true });
  });

  it("the SCHEMA, not the guard, is what refuses a manifest missing a declared kind", () => {
    const partial = completeManifest() as { kinds: Record<string, unknown> };
    delete partial.kinds["detection"];
    expect(crowdstrikeManifestSchema.safeParse(partial).success).toBe(false);
  });
});

describe("crowdstrikeAtlasPaths", () => {
  it("puts every declared kind under the platform directory", () => {
    const paths = crowdstrikeAtlasPaths({ home: "/var/example-state" });
    expect(paths.directory).toBe("/var/example-state/atlas/crowdstrike");
    expect(paths.kinds.host).toBe("/var/example-state/atlas/crowdstrike/hosts.jsonl");
    expect(Object.keys(paths.kinds).toSorted()).toEqual([...CROWDSTRIKE_KINDS].toSorted());
  });

  it("archives a superseded generation outside the platform directory", () => {
    const paths = crowdstrikeAtlasPaths({ home: "/var/example-state" });
    expect(paths.superseded).toBe("/var/example-state/atlas/_superseded/crowdstrike");
  });
});
