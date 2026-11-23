import { describe, expect, it } from "vitest";

import {
  assembleJumpcloudKindFile,
  emptyJumpcloudKindFile,
  initialJumpcloudManifest,
  type JumpcloudEntity,
} from "../../../../atlas/jumpcloud/entities.js";
import { JUMPCLOUD_KINDS } from "../../../../atlas/jumpcloud/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-04T10:00:00.000Z";

function entity({ kind }: { kind: JumpcloudEntity["kind"] }): JumpcloudEntity {
  return {
    channels: {
      "admin-console": null,
      "directory-api": { detail: { a: 1 }, firstSeenAt: AT, lastSeenAt: AT, source: null, state: "observed" },
    },
    id: "id-1",
    kind,
    providerId: "p-1",
  };
}

describe("assembleJumpcloudKindFile", () => {
  it("refuses an entity of another kind rather than writing it and reading it back forever as this one", () => {
    const assembled = assembleJumpcloudKindFile({
      at: AT,
      coverage: [],
      entities: [entity({ kind: "policies" })],
      gaps: [],
      kind: "systems",
      readEpoch: null,
    });
    expect(assembled.isErr()).toBe(true);
    expect(unwrapErr(assembled)[0]).toContain("entity/entities of another kind");
  });

  it("carries the read epoch, so a comparison can tell overlap from series", () => {
    const file = unwrap(
      assembleJumpcloudKindFile({
        at: AT,
        coverage: [],
        entities: [entity({ kind: "systems" })],
        gaps: [],
        kind: "systems",
        readEpoch: { endedAt: AT, startedAt: "2026-09-04T09:00:00.000Z" },
      }),
    );
    expect(file.readEpoch).toEqual({ endedAt: AT, startedAt: "2026-09-04T09:00:00.000Z" });
  });

  it("refuses a document the store schema would not hold", () => {
    const assembled = assembleJumpcloudKindFile({
      at: "not an instant",
      coverage: [],
      entities: [],
      gaps: [],
      kind: "systems",
      readEpoch: null,
    });
    expect(unwrapErr(assembled)).toEqual([
      "the systems file this run assembled is not storable — updatedAt: Invalid ISO datetime",
    ]);
  });
});

describe("emptyJumpcloudKindFile", () => {
  it("records that the kind has never been read, rather than stamping an epoch it did not have", () => {
    expect(emptyJumpcloudKindFile({ kind: "systems", updatedAt: AT }).readEpoch).toBe(null);
  });
});

describe("initialJumpcloudManifest", () => {
  it("grades every declared kind, so a kind cannot be silently absent from a generation", () => {
    expect(Object.keys(initialJumpcloudManifest({ updatedAt: AT }).kinds).toSorted()).toEqual(
      [...JUMPCLOUD_KINDS].toSorted(),
    );
  });

  it("grades each of them as never attempted", () => {
    const manifest = initialJumpcloudManifest({ updatedAt: AT });
    expect(manifest.kinds.systems).toEqual({ digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null });
  });
});
