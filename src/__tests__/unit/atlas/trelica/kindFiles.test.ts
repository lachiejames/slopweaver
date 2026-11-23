/**
 * The kind-file plumbing a sync publishes through: the manifest stamp (a deferred kind keeps its last success),
 * the stored-or-empty read, the closed file-name register, and the page shape every list read is admitted by.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { trelicaPageSchema, unreadTrelicaKeys } from "../../../../atlas/trelica/boundaryShapes.js";
import { TRELICA_KIND_FILES } from "../../../../atlas/trelica/kindFileNames.js";
import { storedTrelicaKindFile, trelicaSyncManifest } from "../../../../atlas/trelica/kindFiles.js";
import { trelicaKindRecord } from "../../../../atlas/trelica/kindRecord.js";
import {
  emptyTrelicaKindFile,
  initialTrelicaManifest,
  TRELICA_ATLAS_KINDS,
  type TrelicaAtlasManifest,
} from "../../../../atlas/trelica/model.js";

const PRIOR = "2026-10-01T00:00:00.000Z";
const AT = "2026-10-15T00:00:00.000Z";

/** A manifest whose every kind last succeeded at {@link PRIOR}. */
function priorManifest(): TrelicaAtlasManifest {
  const base = initialTrelicaManifest({ updatedAt: PRIOR });
  return {
    ...base,
    kinds: trelicaKindRecord({
      of: () => ({ digest: "d", entityCount: 4, lastAttempt: null, lastSuccessAt: PRIOR }),
    }),
  };
}

describe("trelicaSyncManifest", () => {
  it("stamps a kind read whole as a success, a deferred one as a failed attempt keeping its last success", () => {
    const manifest = trelicaSyncManifest({
      at: AT,
      deferred: new Map([["workflow-run", "1 run(s) hold their status and no step-by-step evidence"]]),
      files: {
        person: emptyTrelicaKindFile({ kind: "person", updatedAt: AT }),
        "workflow-run": emptyTrelicaKindFile({ kind: "workflow-run", updatedAt: AT }),
      },
      manifest: priorManifest(),
    });

    expect(manifest.updatedAt).toBe(AT);
    expect(manifest.kinds.person).toEqual({
      digest: null,
      entityCount: 0,
      lastAttempt: { at: AT, outcome: "ok", reasons: [] },
      lastSuccessAt: AT,
    });
    expect(manifest.kinds["workflow-run"]).toEqual({
      digest: null,
      entityCount: 0,
      lastAttempt: { at: AT, outcome: "failed", reasons: ["1 run(s) hold their status and no step-by-step evidence"] },
      lastSuccessAt: PRIOR,
    });
    expect(manifest.kinds.page).toEqual({ digest: "d", entityCount: 4, lastAttempt: null, lastSuccessAt: PRIOR });
  });

  it("starts a first publish from never-synced, so a deferred kind has no last success at all", () => {
    const manifest = trelicaSyncManifest({
      at: AT,
      deferred: new Map([["device", "the device list answered 403"]]),
      files: { device: emptyTrelicaKindFile({ kind: "device", updatedAt: AT }) },
      manifest: null,
    });

    expect(manifest.kinds.device.lastSuccessAt).toBe(null);
    expect(manifest.kinds.team).toEqual({ digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null });
  });
});

describe("storedTrelicaKindFile", () => {
  it("answers an empty file for a kind the generation does not hold", () => {
    const snapshot = {
      files: trelicaKindRecord({ of: () => null }),
      manifest: null,
      mismatched: [],
      missing: [],
      superseded: [],
      unpublished: [],
    };

    expect(storedTrelicaKindFile({ at: AT, kind: "contract", snapshot })).toEqual(
      emptyTrelicaKindFile({ kind: "contract", updatedAt: AT }),
    );
  });
});

describe("TRELICA_KIND_FILES", () => {
  it("gives every kind its own .jsonl file", () => {
    const names = TRELICA_ATLAS_KINDS.map((kind) => TRELICA_KIND_FILES[kind]);

    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !name.endsWith(".jsonl"))).toEqual([]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("trelicaPageSchema", () => {
  it("admits a declared-unread key on a record and refuses an undeclared key on the page", () => {
    const schema = trelicaPageSchema({
      item: z.strictObject({ id: z.string(), ...unreadTrelicaKeys({ keys: ["noted"] }) }),
    });

    expect(schema.safeParse({ items: [{ id: "x", noted: 1 }], resultsTruncated: false, total: 1 }).success).toBe(true);
    expect(
      schema
        .safeParse({ cursor: "c", items: [], resultsTruncated: false, total: 0 })
        .error!.issues.map((issue) => issue.code),
    ).toEqual(["unrecognized_keys"]);
  });
});
