import { describe, expect, it } from "vitest";
import { ALL_KEEP_KEYS } from "../cassetteRedactConfig.js";
import { assertRecordTimeTripwire, findUnsafeValues, isProvablySafe } from "../cassetteTripwire.js";

const safe = ({ key, value }: { key: string | undefined; value: unknown }): boolean =>
  isProvablySafe({ allKeepKeys: ALL_KEEP_KEYS, key, value });

// Assembled at runtime so this committed test file stays hygiene-clean.
const rawSlackId = `U${"0000001A"}`;
const uuid = `${"12345678"}-1234-4234-9234-123456789abc`;
const email = `person${"@"}example.org`;

describe("isProvablySafe", () => {
  it("passes non-strings, placeholders, synthetic ids, timestamps, numbers, and safe urls", () => {
    expect(safe({ key: "count", value: 42 })).toBe(true);
    expect(safe({ key: "active", value: true })).toBe(true);
    expect(safe({ key: "text", value: "[REDACTED]" })).toBe(true);
    expect(safe({ key: "user", value: "id_7" })).toBe(true);
    expect(safe({ key: "next_cursor", value: "cursor_7" })).toBe(true);
    expect(safe({ key: "updatedAt", value: "2026-07-25T01:02:03Z" })).toBe(true);
    expect(safe({ key: "ts", value: "1720000000.000100" })).toBe(true);
    expect(safe({ key: "url", value: "https://github.com/[REDACTED]" })).toBe(true);
    expect(safe({ key: "url", value: "https://redacted.invalid/[REDACTED]" })).toBe(true);
  });

  it("passes a short enum-ish value under an allowlisted key", () => {
    expect(safe({ key: "state", value: "OPEN" })).toBe(true);
    expect(safe({ key: "mimetype", value: "image/png" })).toBe(true);
  });

  it("fails an email, a UUID, and a raw workspace id — even under an allowlisted key", () => {
    expect(safe({ key: "email", value: email })).toBe(false);
    expect(safe({ key: "id", value: uuid })).toBe(false);
    expect(safe({ key: "state", value: rawSlackId })).toBe(false);
  });

  it("fails a cursor that kept its real value, and a placeholder that only looks synthetic", () => {
    expect(safe({ key: "next_cursor", value: "dXNlcjpVMDYxTkZUVDI=" })).toBe(false);
    expect(safe({ key: "next_cursor", value: "cursor_" })).toBe(false);
    expect(safe({ key: "next_cursor", value: "cursor_7x" })).toBe(false);
  });

  it("fails free prose and a url with a non-allowlisted host", () => {
    expect(safe({ key: "state", value: "the quarterly launch is delayed" })).toBe(false);
    expect(safe({ key: "url", value: "https://acmecorp.slack.com/[REDACTED]" })).toBe(false);
    expect(safe({ key: "name", value: "Jane Doe" })).toBe(false);
  });
});

describe("findUnsafeValues", () => {
  it("returns [] for a fully-safe body", () => {
    const body = { messages: [{ text: "[REDACTED]", ts: "1720000000.0001", user: "id_1" }], ok: true };
    expect(findUnsafeValues({ allKeepKeys: ALL_KEEP_KEYS, value: body })).toEqual([]);
  });

  it("flags exactly the unsafe leaf with its path/key/value", () => {
    const body = { messages: [{ author: "Jane Doe", text: "[REDACTED]" }] };
    const hits = findUnsafeValues({ allKeepKeys: ALL_KEEP_KEYS, value: body });
    expect(hits).toEqual([{ key: "author", path: "$.messages[0].author", value: "Jane Doe" }]);
  });
});

describe("assertRecordTimeTripwire", () => {
  it("throws when a known-sensitive literal survives", () => {
    expect(() =>
      assertRecordTimeTripwire({ denylist: [], knownValues: ["Acme Corp"], text: "note about Acme Corp here" }),
    ).toThrow(/known-sensitive value survived/);
  });

  it("throws when a hygiene leak class survives", () => {
    expect(() => assertRecordTimeTripwire({ denylist: [], knownValues: [], text: `path /${"Users"}/bob/x` })).toThrow(
      /leak class/,
    );
  });

  it("does not throw on a clean text", () => {
    expect(() =>
      assertRecordTimeTripwire({ denylist: ["acme"], knownValues: ["widget"], text: "id_1 [REDACTED] ok" }),
    ).not.toThrow();
  });
});
