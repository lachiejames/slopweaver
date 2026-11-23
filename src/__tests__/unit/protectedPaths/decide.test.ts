import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { isAtOrUnder, protectionHit, protectionHitAny } from "../../../protectedPaths/decide.js";
import type { ProtectedPath } from "../../../protectedPaths/registry.js";
import { parseProtectedPaths, renderProtectedPaths } from "../../../protectedPaths/registry.js";

/** Synthetic roots only: no real protected path of any install appears in a test. */
const READ_ONLY: ProtectedPath = {
  addedIso: "2026-01-01T00:00:00.000Z",
  mode: "read-only",
  path: "/Users/example/protected-state",
  why: "a synthetic read-only store",
};
const NO_ACCESS: ProtectedPath = {
  addedIso: "2026-01-01T00:00:00.000Z",
  mode: "no-access",
  path: "/Users/example/private",
  why: "a synthetic private folder",
};
const ENTRIES = [READ_ONLY, NO_ACCESS];

describe("isAtOrUnder", () => {
  it("contains by segment, never by prefix", () => {
    expect(isAtOrUnder({ path: "/Users/example/private/a.txt", root: "/Users/example/private" })).toBe(true);
    expect(isAtOrUnder({ path: "/Users/example/private", root: "/Users/example/private" })).toBe(true);
    expect(isAtOrUnder({ path: "/Users/example/privateer/a.txt", root: "/Users/example/private" })).toBe(false);
    expect(isAtOrUnder({ path: "/Users/example", root: "/Users/example/private" })).toBe(false);
  });

  it("folds case, as APFS does", () => {
    expect(isAtOrUnder({ path: "/USERS/Example/PRIVATE/x", root: "/Users/example/private" })).toBe(true);
  });
});

describe("protectionHit", () => {
  it("refuses a write under either mode", () => {
    expect(protectionHit({ access: "write", entries: ENTRIES, target: "/Users/example/protected-state/x" })).toBe(
      READ_ONLY,
    );
    expect(protectionHit({ access: "write", entries: ENTRIES, target: "/Users/example/private/x" })).toBe(NO_ACCESS);
  });

  it("refuses a read only under a no-access path", () => {
    expect(protectionHit({ access: "read", entries: ENTRIES, target: "/Users/example/protected-state/x" })).toBe(
      undefined,
    );
    expect(protectionHit({ access: "read", entries: ENTRIES, target: "/Users/example/private/x" })).toBe(NO_ACCESS);
  });

  it("refuses a search rooted above a no-access path, and allows one beside it", () => {
    expect(protectionHit({ access: "search", entries: ENTRIES, target: "/Users/example" })).toBe(NO_ACCESS);
    expect(protectionHit({ access: "search", entries: ENTRIES, target: "/" })).toBe(NO_ACCESS);
    expect(protectionHit({ access: "search", entries: ENTRIES, target: "/Users/example/work" })).toBe(undefined);
  });

  it("refuses a list at or under a no-access path, allows one above it, and ignores read-only", () => {
    expect(protectionHit({ access: "list", entries: ENTRIES, target: "/Users/example/private" })).toBe(NO_ACCESS);
    expect(protectionHit({ access: "list", entries: ENTRIES, target: "/Users/example/private/x" })).toBe(NO_ACCESS);
    expect(protectionHit({ access: "list", entries: ENTRIES, target: "/Users/example" })).toBe(undefined);
    expect(protectionHit({ access: "list", entries: ENTRIES, target: "/Users/example/protected-state/x" })).toBe(
      undefined,
    );
  });

  it("keeps a search above a no-access path refused, where a list above the same path is allowed", () => {
    // The pin on the two verbs' difference: only a walk that judges each child may ask `list`, so a search, which
    // reads in without that judgement, must still be refused at the ancestor.
    expect(protectionHit({ access: "search", entries: ENTRIES, target: "/Users/example" })).toBe(NO_ACCESS);
    expect(protectionHit({ access: "list", entries: ENTRIES, target: "/Users/example" })).toBe(undefined);
  });

  it("lets a no-access parent dominate a read-only child, whatever the order", () => {
    const child: ProtectedPath = { ...READ_ONLY, path: "/Users/example/private/notes" };
    expect(
      protectionHit({ access: "read", entries: [child, NO_ACCESS], target: "/Users/example/private/notes/a" }),
    ).toBe(NO_ACCESS);
  });

  it("never judges a relative target", () => {
    expect(protectionHit({ access: "write", entries: ENTRIES, target: "private/x" })).toBe(undefined);
  });

  it("judges every spelling of one path", () => {
    expect(
      protectionHitAny({ access: "read", entries: ENTRIES, targets: ["/tmp/link", "/Users/example/private/real"] }),
    ).toBe(NO_ACCESS);
  });
});

describe("parseProtectedPaths", () => {
  it("round-trips what renderProtectedPaths writes", () => {
    const registry = { paths: [NO_ACCESS, READ_ONLY], schemaVersion: 1 as const };
    const text = renderProtectedPaths({ registry });
    expect(unwrap(parseProtectedPaths({ file: "/h/protected-paths.json", text })).paths.map((e) => e.path)).toEqual([
      "/Users/example/private",
      "/Users/example/protected-state",
    ]);
  });

  it("refuses a relative path, an unknown mode and an unknown key, naming the file", () => {
    const relative = parseProtectedPaths({
      file: "/h/protected-paths.json",
      text: JSON.stringify({ paths: [{ ...READ_ONLY, path: "relative/dir" }], schemaVersion: 1 }),
    });
    expect(unwrapErr(relative).code).toBe("REGISTRY_MALFORMED");
    expect(unwrapErr(relative).message).toContain("/h/protected-paths.json");
    const mode = parseProtectedPaths({
      file: "/h/p.json",
      text: JSON.stringify({ paths: [{ ...READ_ONLY, mode: "hidden" }], schemaVersion: 1 }),
    });
    expect(unwrapErr(mode).code).toBe("REGISTRY_MALFORMED");
    const extra = parseProtectedPaths({
      file: "/h/p.json",
      text: JSON.stringify({ paths: [{ ...READ_ONLY, extra: 1 }], schemaVersion: 1 }),
    });
    expect(unwrapErr(extra).code).toBe("REGISTRY_MALFORMED");
  });

  it("refuses two entries for the same path, case folded", () => {
    const twice = parseProtectedPaths({
      file: "/h/p.json",
      text: JSON.stringify({
        paths: [READ_ONLY, { ...NO_ACCESS, path: "/USERS/example/protected-state" }],
        schemaVersion: 1,
      }),
    });
    expect(unwrapErr(twice).message).toContain("more than once");
  });

  it("refuses text that is not JSON", () => {
    expect(unwrapErr(parseProtectedPaths({ file: "/h/p.json", text: "{" })).code).toBe("REGISTRY_MALFORMED");
  });
});
