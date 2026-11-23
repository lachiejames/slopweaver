/**
 * What every captured-turn projection shares — a body checked storable and measured — and the `owner_capture`
 * table's shape: the identity a re-import relies on, the sources it admits, and a write batch inside postgres's
 * bind-parameter ceiling.
 */
import { createHash } from "node:crypto";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { CaptureImportErrors } from "../../../../store/fleet/captureImportErrors.js";
import { captureBody, isJsonObject, stringField } from "../../../../store/fleet/ownerCapture.js";
import { driftedCaptures, OWNER_CAPTURE_INSERT_BATCH } from "../../../../store/fleet/ownerCaptureStore.js";
import { type NewOwnerCaptureRecord, ownerCaptureTable } from "../../../../store/schema/ownerCapture.js";

/** Postgres's limit on bind parameters in one statement. */
const POSTGRES_MAX_BIND_PARAMETERS = 65_535;

/** One projected dictation row, its body measured the way the projector measures it. */
function dictation({ sourceId, body }: { sourceId: string; body: string }): NewOwnerCaptureRecord {
  return {
    ...unwrap(captureBody({ body, path: `/rec/${sourceId}/meta.json` })),
    saidAt: new Date("2026-06-03T02:06:31.000Z"),
    source: "superwhisper",
    sourceId,
  };
}

describe("driftedCaptures", () => {
  const old = dictation({ body: "OLD", sourceId: "1780452391" });
  // Every field the row left unset is stored as null, so this also holds an unset field and a stored null to be alike.
  const stored = [
    {
      bodySha256: old.bodySha256,
      codexSurface: null,
      codexThreadSource: null,
      cwd: null,
      durationMs: null,
      saidAt: old.saidAt,
      source: old.source,
      sourceId: old.sourceId,
      targetApplication: null,
      threadId: null,
    },
  ];

  it("names a same-body, same-instant row under one key recorded with another app or length", () => {
    const slack = { ...old, durationMs: 100, targetApplication: "Slack" };
    const terminal = { ...old, durationMs: 200, targetApplication: "Terminal" };

    expect(driftedCaptures({ rows: [slack], stored })).toEqual([slack]);
    expect(driftedCaptures({ rows: [slack, terminal], stored: [] })).toEqual([terminal]);
  });

  it("names a key already stored with a different body", () => {
    const changed = dictation({ body: "NEW", sourceId: "1780452391" });

    expect(driftedCaptures({ rows: [changed, dictation({ body: "SECOND", sourceId: "1780452392" })], stored })).toEqual(
      [changed],
    );
  });

  it("passes a key stored with the same body, which the insert then skips", () => {
    expect(driftedCaptures({ rows: [dictation({ body: "OLD", sourceId: "1780452391" })], stored })).toEqual([]);
  });

  it("names the second of two offered rows that share a key with different bodies, and passes an identical repeat", () => {
    const first = dictation({ body: "FIRST", sourceId: "a/b/c/d" });
    const second = dictation({ body: "SECOND", sourceId: "a/b/c/d" });

    expect(driftedCaptures({ rows: [first, second], stored: [] })).toEqual([second]);
    expect(driftedCaptures({ rows: [first, first], stored: [] })).toEqual([]);
  });

  it("names a same-body row under one key said at another instant, stored or offered earlier", () => {
    const later = {
      ...dictation({ body: "OLD", sourceId: "1780452391" }),
      saidAt: new Date("2026-06-03T02:06:32.000Z"),
    };

    expect(driftedCaptures({ rows: [later], stored })).toEqual([later]);
    expect(driftedCaptures({ rows: [old, later], stored: [] })).toEqual([later]);
  });

  it("does not match the same id under another source", () => {
    const codex = { ...dictation({ body: "NEW", sourceId: "1780452391" }), source: "codex" };

    expect(driftedCaptures({ rows: [codex], stored })).toEqual([]);
  });
});

describe("captureBody", () => {
  it("keeps the text verbatim with its UTF-8 size and sha-256", () => {
    expect(unwrap(captureBody({ body: "café", path: "/r/meta.json" }))).toEqual({
      body: "café",
      bodySha256: createHash("sha256").update("café", "utf8").digest("hex"),
      byteLength: 5,
    });
  });

  it("refuses an empty body and a NUL, naming the record", () => {
    expect(unwrapErr(captureBody({ body: "", path: "/r/meta.json" }))).toEqual(
      CaptureImportErrors.unstorableOwnerCapture({ path: "/r/meta.json", reason: "its text is empty" }),
    );
    expect(unwrapErr(captureBody({ body: "a\u0000b", path: "/r/meta.json" })).message).toBe(
      "/r/meta.json cannot be stored as the owner's captured words: its text contains a NUL, which a Postgres text column cannot hold",
    );
  });

  it("refuses a lone surrogate, which UTF-8 would store as U+FFFD, and keeps a real surrogate pair", () => {
    expect(unwrapErr(captureBody({ body: JSON.parse('"\\ud800"') as string, path: "/r/meta.json" })).message).toBe(
      "/r/meta.json cannot be stored as the owner's captured words: its text contains a lone surrogate, which has no UTF-8 encoding",
    );
    expect(unwrap(captureBody({ body: "ok 👍", path: "/r/meta.json" })).byteLength).toBe(7);
  });
});

describe("stringField and isJsonObject", () => {
  it("read a string field and nothing else", () => {
    expect(stringField({ key: "result", record: { result: "Merge it." } })).toBe("Merge it.");
    expect(stringField({ key: "duration", record: { duration: 4210 } })).toBe(undefined);
  });

  it("accept a plain object and refuse an array or null", () => {
    expect([isJsonObject({}), isJsonObject([]), isJsonObject(null)]).toEqual([true, false, false]);
  });
});

describe("the owner_capture table", () => {
  it("is keyed by its source's own id, so a re-import writes nothing twice", () => {
    const unique = getTableConfig(ownerCaptureTable).indexes.find(
      (index) => index.config.name === "uq_owner_capture_source_id",
    )!;

    const columnNames = unique.config.columns.flatMap((column) => ("name" in column ? [column.name] : []));

    expect(unique.config.unique).toBe(true);
    expect(unique.config.columns).toHaveLength(2);
    expect(columnNames).toEqual(["source", "source_id"]);
  });

  it("writes a whole batch inside postgres's bind-parameter ceiling", () => {
    const columns = getTableConfig(ownerCaptureTable).columns.length;

    expect(columns).toBe(15);
    expect(columns * OWNER_CAPTURE_INSERT_BATCH).toBeLessThan(POSTGRES_MAX_BIND_PARAMETERS);
  });
});
