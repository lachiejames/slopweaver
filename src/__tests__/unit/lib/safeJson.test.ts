/**
 * The measured JSON seam. Pure, no IO: every case builds its own payload and asserts the exact behaviour at
 * the boundary — under the warn line, over the refuse line, and the abort that makes a stringify guard
 * possible at all.
 */
import { describe, expect, it } from "vitest";
import { JSON_REFUSE_BYTES, JSON_WARN_BYTES, safeJsonParse, safeJsonStringify } from "../../../lib/safeJson.js";

/** A payload whose serialised size is dominated by one long string, so its size is predictable. */
const payloadOf = ({ bytes }: { bytes: number }): { blob: string } => ({ blob: "x".repeat(bytes) });

describe("thresholds", () => {
  it("sits the warn line at 32 MiB and the refuse line at 100 MiB", () => {
    expect(JSON_WARN_BYTES).toBe(33554432);
    expect(JSON_REFUSE_BYTES).toBe(104857600);
  });

  it("keeps the warn line below the refuse line, so warning always precedes refusing", () => {
    expect(JSON_WARN_BYTES).toBeLessThan(JSON_REFUSE_BYTES);
  });
});

describe("safeJsonParse", () => {
  it("parses an ordinary payload unchanged", () => {
    expect(safeJsonParse({ label: "a dispatch record", text: '{"ok":true,"n":3}' })).toEqual({ n: 3, ok: true });
  });

  it("parses an empty object and an empty array", () => {
    expect(safeJsonParse({ label: "empty", text: "{}" })).toEqual({});
    expect(safeJsonParse({ label: "empty", text: "[]" })).toEqual([]);
  });

  it("refuses a text over the cap, naming the payload and the streaming route", () => {
    const text = `"${"x".repeat(JSON_REFUSE_BYTES)}"`;

    expect(() => safeJsonParse({ label: "the door ledger", text })).toThrow(/refusing the door ledger/);
    expect(() => safeJsonParse({ label: "the door ledger", text })).toThrow(/readJsonlLines/);
  });

  it("names the size it saw, in MiB, so the message says how far over the caller was", () => {
    const text = `"${"x".repeat(JSON_REFUSE_BYTES * 2)}"`;

    expect(() => safeJsonParse({ label: "a bronze window", text })).toThrow(/~200 MiB/);
  });

  it("still throws a SyntaxError on invalid JSON under the cap — the guard adds a check, it replaces none", () => {
    expect(() => safeJsonParse({ label: "a corrupt row", text: "{not json" })).toThrow(SyntaxError);
  });
});

describe("safeJsonStringify", () => {
  it("serialises an ordinary value exactly as JSON.stringify would", () => {
    const value = { ok: true, rows: [1, 2, 3], who: "ada" };

    expect(safeJsonStringify({ label: "a report", value })).toBe(JSON.stringify(value));
  });

  it("passes `space` through, so a pretty-printed file stays pretty-printed", () => {
    const value = { a: 1 };

    expect(safeJsonStringify({ label: "a config", space: 2, value })).toBe(JSON.stringify(value, null, 2));
  });

  it("preserves a nested shape rather than flattening it through the replacer", () => {
    const value = { outer: { inner: [{ deep: "yes" }] } };

    expect(safeJsonStringify({ label: "nested", value })).toBe('{"outer":{"inner":[{"deep":"yes"}]}}');
  });

  it("refuses a value over the cap, naming the payload", () => {
    const value = payloadOf({ bytes: JSON_REFUSE_BYTES + 1024 });

    expect(() => safeJsonStringify({ label: "the cross-ref graph", value })).toThrow(/refusing the cross-ref graph/);
  });

  it("ABORTS rather than completing — the refusal fires before the whole string exists", () => {
    // Two long strings, each just over half the cap: the first alone is under, the pair is over. A guard
    // that only measured the finished output could not tell these apart, and would have built it first.
    const half = Math.ceil(JSON_REFUSE_BYTES / 2) + 1024;
    const value = { a: "x".repeat(half), b: "y".repeat(half) };

    expect(() => safeJsonStringify({ label: "two halves", value })).toThrow(/over the 100 MiB cap/);
  });

  it("throws a named error rather than returning undefined for a non-serialisable value", () => {
    expect(() => safeJsonStringify({ label: "a bare undefined", value: undefined })).toThrow(/not serialisable/);
  });

  it("serialises a value just under the cap without refusing it", () => {
    const value = payloadOf({ bytes: JSON_WARN_BYTES - 1024 });

    expect(safeJsonStringify({ label: "a large but legal artifact", value }).length).toBeGreaterThan(0);
  });
});

describe("the cap is exact, not the estimate's opinion", () => {
  // MEASURED on the real `atlas/cloudflare/pages-project.json`: the counting replacer reached
  // about 40 MiB against a finished string of well over 100 MiB, because it cannot see `space` indentation. This is that
  // shape in miniature — a deeply-nested value whose bytes are almost all indentation, so the replacer's
  // estimate stays far under the cap while the pretty-printed output runs past it.
  it("refuses a pretty-printed payload the counting replacer alone would let through", () => {
    // One leaf object, referenced 350,000 times: the array costs pointers, so the only large allocation is
    // the string being refused. Pretty-prints to 116.2 MiB while the replacer's estimate reaches 34.9 MiB —
    // a 3.3x gap, the same shape as the real artifact's about fourfold.
    const leaf = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
    const value = { rows: Array.from({ length: 350_000 }, () => leaf) };

    let estimate = 0;
    JSON.stringify(value, (key: string, held: unknown): unknown => {
      estimate += key.length === 0 ? 0 : key.length + 3;
      estimate += typeof held === "number" ? 8 : 0;
      return held;
    });
    expect(estimate).toBeLessThan(JSON_REFUSE_BYTES);

    expect(() => safeJsonStringify({ label: "a pretty atlas artifact", space: 10, value })).toThrow(
      /over the 100 MiB cap/,
    );
  });

  it("still returns a pretty-printed payload that finishes under the cap", () => {
    const value = { rows: Array.from({ length: 1000 }, () => ({ a: 1, b: 2 })) };

    expect(safeJsonStringify({ label: "a small pretty artifact", space: 2, value })).toBe(
      JSON.stringify(value, null, 2),
    );
  });
});
