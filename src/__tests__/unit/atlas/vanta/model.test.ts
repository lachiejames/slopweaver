import { describe, expect, it } from "vitest";

import {
  emptyVantaKindFile,
  initialVantaManifest,
  VANTA_ATLAS_PLATFORM,
  VANTA_ATLAS_SCHEMA_VERSION,
  VANTA_KINDS,
  vantaEntitySchema,
  vantaKindFileSchema,
  vantaManifestSchema,
} from "../../../../atlas/vanta/model.js";

describe("initialVantaManifest", () => {
  it("stamps every kind as never-synced", () => {
    const manifest = initialVantaManifest({ updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(VANTA_KINDS.every((kind) => manifest.kinds[kind].lastSuccessAt === null)).toBe(true);
  });

  it("parses as a valid manifest", () => {
    const manifest = initialVantaManifest({ updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(vantaManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("stamps the current schema version and platform", () => {
    const manifest = initialVantaManifest({ updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(manifest.schemaVersion).toBe(VANTA_ATLAS_SCHEMA_VERSION);
    expect(manifest.platform).toBe(VANTA_ATLAS_PLATFORM);
  });
});

describe("emptyVantaKindFile", () => {
  it("is empty of entities, coverage, gaps and disagreements", () => {
    const file = emptyVantaKindFile({ kind: "control", updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(file.entities).toEqual([]);
    expect(file.coverage).toEqual([]);
    expect(file.gaps).toEqual([]);
  });

  it("parses as a valid kind file", () => {
    const file = emptyVantaKindFile({ kind: "vendor", updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(vantaKindFileSchema.safeParse(file).success).toBe(true);
  });

  it("carries the requested kind", () => {
    const file = emptyVantaKindFile({ kind: "risk", updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(file.kind).toBe("risk");
  });
});

describe("vantaEntitySchema", () => {
  const validEntity = {
    channels: {
      browser: null,
      "manage-api": {
        channel: "manage-api" as const,
        detail: { any: "thing" },
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        source: {
          artifacts: [],
          channel: "manage-api" as const,
          deepLink: null,
          deepLinkStatus: "unavailable" as const,
          endpoint: "/controls",
          observedAt: "2026-01-01T00:00:00.000Z",
        },
        state: "observed" as const,
      },
    },
    financialDetail: null,
    id: "abc123",
    kind: "control" as const,
    providerId: "control-1",
    sensitivity: null,
  };

  it("accepts a well-formed entity", () => {
    expect(vantaEntitySchema.safeParse(validEntity).success).toBe(true);
  });

  it("rejects an entity with an unrecognised extra field", () => {
    expect(vantaEntitySchema.safeParse({ ...validEntity, extra: "nope" }).success).toBe(false);
  });

  it("rejects an entity missing its id", () => {
    const { id: _id, ...withoutId } = validEntity;
    expect(vantaEntitySchema.safeParse(withoutId).success).toBe(false);
  });
});
