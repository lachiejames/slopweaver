import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { projectClaudeRows, projectionDivergence, registerProjectionDivergence } from "../../../plans/projection.js";
import { parsePlanRegister } from "../../../plans/register.js";
import type { PlanRegisterDocument } from "../../../plans/types.js";

const mixed = (): PlanRegisterDocument =>
  unwrap(
    parsePlanRegister({
      value: {
        rows: [
          { alias: "plan-one", pinned: null, provider: "claude", storeDir: "/c1" },
          { alias: "codex-work", pinned: true, provider: "codex", storeDir: "/x1" },
          { alias: "plan-two", email: "second@example.com", provider: "claude", storeDir: "/c2" },
        ],
        version: 1,
      },
    }),
  ).document;

describe("projectClaudeRows", () => {
  it("emits exactly the Claude rows, in register order, with the discriminator dropped", () => {
    expect(projectClaudeRows({ document: mixed() })).toStrictEqual([
      { alias: "plan-one", pinned: null, storeDir: "/c1" },
      { alias: "plan-two", email: "second@example.com", storeDir: "/c2" },
    ]);
  });

  it("emits an empty array for a Codex-only register", () => {
    const codexOnly = unwrap(
      parsePlanRegister({
        value: { rows: [{ alias: "codex-work", provider: "codex", storeDir: "/x1" }], version: 1 },
      }),
    ).document;
    expect(projectClaudeRows({ document: codexOnly })).toStrictEqual([]);
  });

  it("keeps an unrelated field an older or newer writer put on a Claude row", () => {
    const withExtra = unwrap(
      parsePlanRegister({
        value: {
          rows: [{ alias: "plan-one", provider: "claude", storeDir: "/c1", tomorrowsField: 7 }],
          version: 1,
        },
      }),
    ).document;
    expect(projectClaudeRows({ document: withExtra })).toStrictEqual([
      { alias: "plan-one", storeDir: "/c1", tomorrowsField: 7 },
    ]);
  });

  it("carries a Claude row's recorded lapse into the accounts copy, and no Codex row's", () => {
    const lapsing = unwrap(
      parsePlanRegister({
        value: {
          rows: [
            { alias: "plan-one", lapsesAtIso: "2026-11-17T00:00:00Z", provider: "claude", storeDir: "/c1" },
            { alias: "codex-work", lapsesAtIso: "2026-11-18T00:00:00Z", provider: "codex", storeDir: "/x1" },
          ],
          version: 1,
        },
      }),
    ).document;
    expect(projectClaudeRows({ document: lapsing })).toStrictEqual([
      { alias: "plan-one", lapsesAtIso: "2026-11-17T00:00:00Z", storeDir: "/c1" },
    ]);
  });
});

describe("projectionDivergence", () => {
  it("reports nothing when the file on disk is what the register implies", () => {
    const document = mixed();
    expect(projectionDivergence({ document, onDisk: projectClaudeRows({ document }) })).toBe(undefined);
  });

  it("reports divergence when an older checkout's writer paused a row in the copy", () => {
    const document = mixed();
    const edited = [
      {
        alias: "plan-one",
        paused: { reason: "by an old seat", sinceIso: "2026-09-21T00:00:00.000Z" },
        pinned: null,
        storeDir: "/c1",
      },
      { alias: "plan-two", email: "second@example.com", storeDir: "/c2" },
    ];
    const note = projectionDivergence({ document, onDisk: edited });
    expect(note?.code).toBe("PROJECTION_DIVERGED");
    expect(note?.message).toContain("plans validate --repair-projection");
    expect(note?.message).toContain("The register is authoritative");
  });

  it("reports divergence on a field a typed reading would have dropped", () => {
    const document = mixed();
    const stripped = projectClaudeRows({ document }).map((row) =>
      Object.fromEntries(Object.entries(row).filter(([name]) => name !== "pinned")),
    );
    expect(projectionDivergence({ document, onDisk: stripped })?.code).toBe("PROJECTION_DIVERGED");
  });

  it("reports divergence when the copy is missing entirely", () => {
    expect(projectionDivergence({ document: mixed(), onDisk: undefined })?.code).toBe("PROJECTION_DIVERGED");
  });

  it("reads a copy whose keys only came back in another order — as jsonb returns them — as NOT diverged", () => {
    const reordered = [
      { storeDir: "/c1", pinned: null, alias: "plan-one" },
      { storeDir: "/c2", email: "second@example.com", alias: "plan-two" },
    ];
    expect(projectionDivergence({ document: mixed(), onDisk: reordered })).toBe(undefined);
  });

  it("still reads a copy with its ROWS reordered as diverged, because row order is routing order", () => {
    const document = mixed();
    const swapped = [...projectClaudeRows({ document })].toReversed();
    expect(projectionDivergence({ document, onDisk: swapped })!.code).toBe("PROJECTION_DIVERGED");
  });
});

describe("registerProjectionDivergence", () => {
  it("reads a plans.json holding the row's document with its keys reordered as NOT diverged", () => {
    const document = mixed();
    const reordered = {
      version: 1,
      rows: document.rows.map((row) => Object.fromEntries(Object.entries(row).toReversed())),
    };
    expect(registerProjectionDivergence({ document, onDisk: reordered })).toBe(undefined);
  });

  it("reports a plans.json that no longer holds the row's document, naming the store row as authoritative", () => {
    const note = registerProjectionDivergence({ document: mixed(), onDisk: { rows: [], version: 1 } });
    expect(note!.code).toBe("PROJECTION_DIVERGED");
    expect(note!.message).toContain("The store row is authoritative");
  });

  it("reports a missing plans.json as diverged", () => {
    expect(registerProjectionDivergence({ document: mixed(), onDisk: undefined })!.code).toBe("PROJECTION_DIVERGED");
  });
});
