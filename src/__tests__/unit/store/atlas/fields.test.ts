/**
 * The four field readers both halves of the atlas projection share, and the error factory they refuse with.
 *
 * These are small on purpose and the rules they encode are decisions rather than conveniences: a blank
 * string is ABSENT, an absent LIST is an empty one, and an instant that is present and unreadable is
 * REFUSED rather than defaulted. Each of those is a place the two halves could otherwise diverge, which is
 * why they live in one module and are asserted here rather than only through their callers.
 *
 * Fixtures come from the domain's own factory (`.claude/rules/error-handling.md`), so a factory that stops
 * matching its own type fails here.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { AtlasImportErrors } from "../../../../store/atlas/errors.js";
import {
  instant,
  numberField,
  optionalInstant,
  stringArrayField,
  stringField,
} from "../../../../store/atlas/fields.js";

describe("stringField", () => {
  it("reads a non-empty string", () => {
    expect(stringField({ from: { kind: "control" }, key: "kind" })).toBe("control");
  });

  it("treats a blank string as absent, because a kind of spaces is not a kind", () => {
    expect(stringField({ from: { kind: "   " }, key: "kind" })).toBe(null);
  });

  it("treats a non-string as absent rather than coercing it", () => {
    expect(stringField({ from: { kind: 7 }, key: "kind" })).toBe(null);
  });

  it("answers null for a key that is not there", () => {
    expect(stringField({ from: {}, key: "kind" })).toBe(null);
  });
});

describe("numberField", () => {
  it("reads a finite number, zero included", () => {
    expect(numberField({ from: { schemaVersion: 0 }, key: "schemaVersion" })).toBe(0);
    expect(numberField({ from: { schemaVersion: 3 }, key: "schemaVersion" })).toBe(3);
  });

  it("refuses a non-finite number rather than storing it", () => {
    expect(numberField({ from: { schemaVersion: Number.NaN }, key: "schemaVersion" })).toBe(null);
    expect(numberField({ from: { schemaVersion: Number.POSITIVE_INFINITY }, key: "schemaVersion" })).toBe(null);
  });

  it("does not read a numeric string as a number", () => {
    expect(numberField({ from: { schemaVersion: "3" }, key: "schemaVersion" })).toBe(null);
  });
});

describe("stringArrayField", () => {
  it("keeps every string member in order", () => {
    expect(stringArrayField({ from: { surfaces: ["directory-api", "browser"] }, key: "surfaces" })).toEqual([
      "directory-api",
      "browser",
    ]);
  });

  it("reads an absent list as empty, because a gap without one says the same thing", () => {
    expect(stringArrayField({ from: {}, key: "surfaces" })).toEqual([]);
  });

  it("drops a non-string member rather than storing it in a text[] column", () => {
    expect(stringArrayField({ from: { surfaces: ["browser", 7, null] }, key: "surfaces" })).toEqual(["browser"]);
  });
});

describe("instant", () => {
  const where = { lineNumber: 2, path: "/atlas/p/a.jsonl" };

  it("reads an ISO string as an instant", () => {
    expect(unwrap(instant({ ...where, field: "firstSeenAt", value: "2026-09-19T00:47:21.989Z" })).toISOString()).toBe(
      "2026-09-19T00:47:21.989Z",
    );
  });

  it("names the field when the value is absent", () => {
    const refused = instant({ ...where, field: "firstSeenAt", value: undefined });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("MISSING_FIELD");
  });

  it("refuses an unreadable instant rather than defaulting it", () => {
    const refused = instant({ ...where, field: "firstSeenAt", value: "the day before yesterday" });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("UNREADABLE_INSTANT");
  });
});

describe("optionalInstant", () => {
  const where = { lineNumber: 1, path: "/atlas/p/a.jsonl" };

  it("reads an absent value as null rather than refusing", () => {
    expect(unwrap(optionalInstant({ ...where, field: "lastSuccessAt", value: undefined }))).toBe(null);
    expect(unwrap(optionalInstant({ ...where, field: "lastSuccessAt", value: null }))).toBe(null);
  });

  it("still refuses a value that is present and unreadable", () => {
    const refused = optionalInstant({ ...where, field: "lastSuccessAt", value: "soon" });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("UNREADABLE_INSTANT");
  });
});

describe("AtlasImportErrors", () => {
  it("names the file and line on an unreadable line", () => {
    const refusal = AtlasImportErrors.unreadableLine({ lineNumber: 4, path: "/atlas/p/a.jsonl" });
    expect(refusal.code).toBe("UNREADABLE_LINE");
    expect(refusal.message).toBe("/atlas/p/a.jsonl line 4 is not a JSON object");
  });

  it("carries both platforms on a mismatch, so a reader can see which tree it is in", () => {
    const refusal = AtlasImportErrors.platformMismatch({
      declared: "cloudflare",
      directory: "vanta",
      path: "/atlas/vanta/a.jsonl",
    });
    expect(refusal.code).toBe("PLATFORM_MISMATCH");
    expect(refusal.declared).toBe("cloudflare");
    expect(refusal.directory).toBe("vanta");
  });

  it("says where a channel name was looked for, since the estate has none that lack one", () => {
    const refusal = AtlasImportErrors.unnamedChannel({ lineNumber: 2, path: "/atlas/p/a.jsonl" });
    expect(refusal.code).toBe("UNNAMED_CHANNEL");
    expect(refusal.message).toContain("source.channel or source.surface");
  });

  it("carries the unreadable value itself, not just the field name", () => {
    const refusal = AtlasImportErrors.unreadableInstant({
      field: "firstSeenAt",
      lineNumber: 2,
      path: "/atlas/p/a.jsonl",
      value: "soon",
    });
    expect(refusal.value).toBe("soon");
    expect(refusal.message).toContain("unreadable firstSeenAt: soon");
  });

  it("names what is wrong with an envelope rather than only that it is wrong", () => {
    const refusal = AtlasImportErrors.unusableEnvelope({ field: "it names no kind", path: "/atlas/p/a.jsonl" });
    expect(refusal.code).toBe("UNUSABLE_ENVELOPE");
    expect(refusal.message).toBe("/atlas/p/a.jsonl line 1 is not a usable envelope — it names no kind");
  });

  it("names the missing field on an entity", () => {
    const refusal = AtlasImportErrors.missingField({ field: "providerId", lineNumber: 9, path: "/atlas/p/a.jsonl" });
    expect(refusal.code).toBe("MISSING_FIELD");
    expect(refusal.field).toBe("providerId");
  });
});
