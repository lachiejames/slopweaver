/**
 * A manifest names every registry part exactly once, at its own file, media type and version — or is refused.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { checkPartAgainstEntry, parseStoreExportManifest } from "../../../../store/transfer/manifest.js";
import { STORE_EXPORT_PARTS } from "../../../../store/transfer/parts.js";

const SHA = "0".repeat(64);

/** A manifest listing every registry part with zero rows. */
function manifest({
  parts = STORE_EXPORT_PARTS.map((spec) => ({ ...entryFor({ kind: spec.kind }) })),
}: { parts?: readonly unknown[] } = {}): unknown {
  return {
    createdAtIso: "2026-10-31T00:00:00.000Z",
    kind: "slopweaver-store-export",
    parts,
    producer: { name: "slopweaver", version: "0.2.0" },
    schemaVersion: 1,
  };
}

/** The entry the registry fixes for one kind. */
function entryFor({ kind }: { kind: string }): Record<string, unknown> {
  const spec = STORE_EXPORT_PARTS.find((one) => one.kind === kind)!;
  return {
    bytes: 0,
    kind,
    mediaType: spec.mediaType,
    path: spec.file,
    rows: 0,
    schemaVersion: spec.exportSchemaVersion,
    sha256: SHA,
  };
}

describe("parseStoreExportManifest", () => {
  it("reads a complete manifest, its parts in registry order whatever order it lists them", () => {
    const reversed = STORE_EXPORT_PARTS.toReversed().map((spec) => entryFor({ kind: spec.kind }));
    const parsed = unwrap(parseStoreExportManifest({ value: manifest({ parts: reversed }) }));
    expect(parsed.parts.map((part) => part.kind)).toEqual(STORE_EXPORT_PARTS.map((spec) => spec.kind));
  });

  it("refuses a part listed twice", () => {
    const twice = [...STORE_EXPORT_PARTS.map((spec) => entryFor({ kind: spec.kind })), entryFor({ kind: "memories" })];
    expect(unwrapErr(parseStoreExportManifest({ value: manifest({ parts: twice }) })).message).toContain(
      "part memories is listed 2 times, not once",
    );
  });

  it("refuses a missing part", () => {
    const missing = STORE_EXPORT_PARTS.filter((spec) => spec.kind !== "steer-verdicts").map((spec) =>
      entryFor({ kind: spec.kind }),
    );
    expect(unwrapErr(parseStoreExportManifest({ value: manifest({ parts: missing }) })).message).toContain(
      "part steer-verdicts is listed 0 times",
    );
  });

  it("refuses a part version this build does not read", () => {
    const parts = STORE_EXPORT_PARTS.map((spec) =>
      spec.kind === "owner-directives"
        ? { ...entryFor({ kind: spec.kind }), schemaVersion: 1 }
        : entryFor({ kind: spec.kind }),
    );
    expect(unwrapErr(parseStoreExportManifest({ value: manifest({ parts }) })).message).toContain(
      "this build reads application/json v2",
    );
  });

  it("reads a steer part at v1, the version every export before v2 wrote, and refuses one at v3", () => {
    const at = ({ version }: { version: number }): unknown[] =>
      STORE_EXPORT_PARTS.map((spec) => ({
        ...entryFor({ kind: spec.kind }),
        ...(spec.kind === "steer-verdicts" ? { schemaVersion: version } : {}),
      }));
    const steerOf = ({ value }: { value: unknown }): number =>
      unwrap(parseStoreExportManifest({ value })).parts.find((part) => part.kind === "steer-verdicts")!.schemaVersion;
    expect(steerOf({ value: manifest({ parts: at({ version: 1 }) }) })).toBe(1);
    expect(steerOf({ value: manifest({ parts: at({ version: 2 }) }) })).toBe(2);
    expect(unwrapErr(parseStoreExportManifest({ value: manifest({ parts: at({ version: 3 }) }) })).message).toContain(
      "part steer-verdicts is application/x-ndjson v3; this build reads application/x-ndjson v1 or v2",
    );
  });

  it("refuses an unknown top-level field", () => {
    const extra = { ...(manifest() as Record<string, unknown>), note: "hi" };
    expect(unwrapErr(parseStoreExportManifest({ value: extra })).code).toBe("MANIFEST_INVALID");
  });
});

describe("checkPartAgainstEntry", () => {
  it("names rows when only the row count differs", () => {
    const entry = unwrap(parseStoreExportManifest({ value: manifest() })).parts[0]!;
    const refused = unwrapErr(checkPartAgainstEntry({ entry, measured: { bytes: 0, rows: 3, sha256: SHA } }));
    expect(refused.message).toBe("memories: the manifest promises rows 0 and the file holds 3");
  });
});
