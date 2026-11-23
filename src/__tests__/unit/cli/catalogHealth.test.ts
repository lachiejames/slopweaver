/**
 * `catalog health`'s human table, checked on the labels that can lie.
 *
 * The fold is tested in `canon/codebaseHealth.test.ts`; what is tested here is the LABEL a figure is printed
 * under, which is this module's whole reason for existing separately. The length cell is the live case: the owner's
 * bar and `file-size-ratchet`'s cap became the same number, so a table that prints both reads as a
 * stutter, and one that prints only one would be wrong the moment either moves.
 */
import { describe, expect, it } from "vitest";

import { codebaseHealth } from "../../../canon/codebaseHealth.js";
import type { HealthModule } from "../../../canon/codeShape.js";
import type { GateCensus } from "../../../canon/treeHealth.js";
import { renderCodebaseHealth, renderCodebaseHealthJson } from "../../../cli/catalogHealth.js";

/**
 * A module fixture with every counter at zero unless overridden.
 *
 * @param over the fields this case cares about
 * @returns the module row
 */
const mod = (over: Partial<HealthModule> & { path: string }): HealthModule => ({
  codeLines: 10,
  exempt: false,
  libAliasImports: 0,
  libRelativeImports: 0,
  recorded: true,
  ...over,
});

/**
 * Fold one long module against a named gate cap.
 *
 * @param fileLineCap what `file-size-ratchet` refuses at in this case
 * @returns the rendered human table
 */
const tableWith = ({ fileLineCap }: { fileLineCap: number }): string => {
  const gates: GateCensus = { declared: 58, fileLineCap, localLane: 5, registered: 64 };
  return renderCodebaseHealth({
    health: codebaseHealth({
      debtLists: [],
      gates,
      modules: [mod({ codeLines: 400, path: "src/cli/a.ts" }), mod({ path: "src/cli/b.ts" })],
      observedAtIso: "2026-09-20T00:00:00Z",
      rules: [],
      testReach: [],
    }),
  });
};

describe("renderCodebaseHealth", () => {
  it("prints one length figure once the gate adopts the owner's bar, rather than the same number twice", () => {
    expect(tableWith({ fileLineCap: 300 })).toContain(
      "  length:  1 over the owner's 300-line bar, every one frozen on file-size-ratchet's baseline — 1 as debt · 0 exempt ceilings",
    );
  });

  it("prints both figures while the bar and the cap disagree, because then there is a gap to close", () => {
    expect(tableWith({ fileLineCap: 560 })).toContain(
      "  length:  1 over the owner's 300-line bar — 1 as debt · 0 exempt ceilings · 0 over the 560-line cap that refuses today",
    );
  });

  it("splits an exempt ceiling out of the debt, so the cell never calls an unmeasured file frozen", () => {
    const gates: GateCensus = { declared: 58, fileLineCap: 300, localLane: 5, registered: 64 };
    const table = renderCodebaseHealth({
      health: codebaseHealth({
        debtLists: [],
        gates,
        modules: [
          mod({ codeLines: 400, path: "src/cli/a.ts" }),
          mod({ codeLines: 1859, exempt: true, path: "src/atlas/slackApi/browser.ts" }),
        ],
        observedAtIso: "2026-09-20T00:00:00Z",
        rules: [],
        testReach: [],
      }),
    });
    expect(table).toContain(
      "  length:  2 over the owner's 300-line bar, every one frozen on file-size-ratchet's baseline — 1 as debt · 1 exempt ceilings",
    );
  });

  it("drops the all-frozen claim entirely when one file has no row, rather than printing both", () => {
    const gates: GateCensus = { declared: 58, fileLineCap: 300, localLane: 5, registered: 64 };
    const table = renderCodebaseHealth({
      health: codebaseHealth({
        debtLists: [],
        gates,
        modules: [mod({ codeLines: 2000, exempt: true, path: "src/atlas/newGenerated.ts", recorded: false })],
        observedAtIso: "2026-09-20T00:00:00Z",
        rules: [],
        testReach: [],
      }),
    });
    expect(table).toContain(
      "  length:  1 over the owner's 300-line bar — 0 as debt · 0 exempt ceilings · 1 on no baseline row",
    );
    expect(table).not.toContain("every one frozen");
  });

  it("ends on the command that recomputes every figure above it — the owner's own requirement", () => {
    expect(tableWith({ fileLineCap: 300 }).split("\n").at(-1)).toBe(
      "Recompute any figure above with `slopweaver catalog health --json`.",
    );
  });
});

describe("renderCodebaseHealthJson", () => {
  it("round-trips the fold, so the page and the table read one document", () => {
    const health = codebaseHealth({
      debtLists: [],
      gates: { declared: 58, fileLineCap: 300, localLane: 5, registered: 64 },
      modules: [mod({ codeLines: 400, path: "src/cli/a.ts" })],
      observedAtIso: "2026-09-20T00:00:00Z",
      rules: [],
      testReach: [],
    });
    expect(JSON.parse(renderCodebaseHealthJson({ health }))).toEqual(JSON.parse(JSON.stringify(health)));
  });
});
