/**
 * The deferred-kind register: what it counts, what it refuses to call clear, and the order it prints in.
 *
 * Pure throughout — the sweep that reads a published generation is `cli/commands/atlas/backlogRun.ts`'s and
 * is exercised over a registry seam in `unit/cli/commands/atlas/backlogRun.test.ts`. What is asserted here
 * is the property the register exists for: an atlas the sweep could not read is neither counted nor called
 * clear, because those two sentences are what a reader acts on differently.
 */
import { describe, expect, it } from "vitest";

import { type AtlasDeferredRow, orderAtlasDeferred } from "../../../../atlas/kit/deferredBacklog.js";

/** One deferred cell, so a caller states only what the assertion is about. */
function cell({ platform, kind = "page" }: { platform: string; kind?: string }): AtlasDeferredRow {
  return {
    kind,
    platform,
    reason: `3 of 8 declared ${kind}(s) reached`,
    scope: `declared-${kind}s`,
    surface: "web-app",
  };
}

describe("ordering the deferred register", () => {
  it("puts the owner's nine first in their sequence, even when an unnamed atlas carries more cells", () => {
    const register = orderAtlasDeferred({
      rows: [
        cell({ platform: "xero" }),
        cell({ kind: "method", platform: "xero" }),
        cell({ kind: "entity", platform: "xero" }),
        cell({ platform: "cloudflare" }),
        cell({ platform: "datadog" }),
      ],
      unread: [],
    });
    expect(register.entries.map((entry) => entry.platform)).toEqual(["datadog", "cloudflare", "xero"]);
    expect(register.entries.map((entry) => entry.namedPosition)).toEqual([1, 7, null]);
    expect(register.deferredCount).toBe(5);
  });

  it("counts every cell, not every atlas, so a single atlas's whole walk is visible as debt", () => {
    const register = orderAtlasDeferred({
      rows: [cell({ platform: "vanta" }), cell({ kind: "method", platform: "vanta" })],
      unread: [],
    });
    expect(register.deferredCount).toBe(2);
    expect(register.entries.length).toBe(1);
    expect(register.entries[0]!.rows.map((row) => row.kind)).toEqual(["page", "method"]);
  });

  it("holds nothing at all for an empty sweep, and names all nine as clear", () => {
    const register = orderAtlasDeferred({ rows: [], unread: [] });
    expect(register.deferredCount).toBe(0);
    expect(register.entries).toEqual([]);
    expect(register.namedAndClear.length).toBe(9);
  });
});

describe("an atlas the sweep could not read", () => {
  it("is carried with the reader's own refusal, never as a zero", () => {
    const register = orderAtlasDeferred({
      rows: [cell({ platform: "datadog" })],
      unread: [{ because: "no xero generation has been published", platform: "xero" }],
    });
    expect(register.unread).toEqual([{ because: "no xero generation has been published", platform: "xero" }]);
    expect(register.deferredCount).toBe(1);
    expect(register.entries.map((entry) => entry.platform)).toEqual(["datadog"]);
  });

  it("is NOT called clear, which is the one sentence this register must never overstate", () => {
    const register = orderAtlasDeferred({
      rows: [],
      unread: [{ because: "the vanta atlas has a published generation it cannot read back", platform: "vanta" }],
    });
    expect(register.namedAndClear).toEqual([
      "datadog",
      "linear",
      "slack",
      "notion",
      "github",
      "cloudflare",
      "jumpcloud",
      "google-admin",
    ]);
    expect(register.namedAndClear.includes("vanta")).toBe(false);
  });
});
