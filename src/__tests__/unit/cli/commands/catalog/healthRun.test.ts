/**
 * `slopweaver catalog health`'s two pure halves — the argv parse and the specifier resolver the fold stands on.
 *
 * `resolveSpecifier` is tested here rather than through the verb because it is where two of the health
 * figures come from: an unresolved specifier shows up as a module no test reaches. The debt reader moved
 * out with its source — see `./healthDebt.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  CATALOG_HEALTH_FLAG_NAMES,
  floorSetsOf,
  parseCatalogHealthArgs,
  resolveSpecifier,
} from "../../../../../cli/commands/catalog/healthRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseCatalogHealthArgs", () => {
  it("defaults to the human table", () => {
    const parsed = parseCatalogHealthArgs({ rest: [] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).json).toBe(false);
  });

  it("takes --json", () => {
    const parsed = parseCatalogHealthArgs({ rest: ["--json"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).json).toBe(true);
  });

  it("refuses a flag it does not accept, naming it", () => {
    const parsed = parseCatalogHealthArgs({ rest: ["--yaml"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("--yaml");
  });

  it("declares every flag it accepts, so helpTruth compares behaviour rather than prose", () => {
    expect(CATALOG_HEALTH_FLAG_NAMES).toEqual(["--json"]);
  });
});

describe("resolveSpecifier", () => {
  it("resolves the #lib/ subpath, which a relative-only walk reports as untested forever", () => {
    expect(resolveSpecifier({ from: "src/__tests__/unit/x.test.ts", spec: "#lib/result.js" })).toBe(
      "src/lib/result.ts",
    );
  });

  it("resolves a relative specifier against the importing file's directory", () => {
    expect(resolveSpecifier({ from: "src/cli/commands/catalog/healthRun.ts", spec: "../../../canon/x.js" })).toBe(
      "src/canon/x.ts",
    );
  });

  it("reports a bare package specifier as outside this repo", () => {
    expect(resolveSpecifier({ from: "src/a.ts", spec: "node:fs" })).toBe(undefined);
  });
});

describe("floorSetsOf", () => {
  it("counts an offenders row as recorded and NOT as an exempt ceiling", () => {
    const sets = floorSetsOf({ baseline: { exempt: [], offenders: [{ codeLines: 400, path: "src/a.ts" }] } });
    expect([...sets.recorded]).toEqual(["src/a.ts"]);
    expect([...sets.exemptCeilings]).toEqual([]);
  });

  it("counts an exempt row as both recorded and an exempt ceiling", () => {
    const sets = floorSetsOf({ baseline: { exempt: [{ codeLines: 1859, path: "src/gen.ts" }], offenders: [] } });
    expect([...sets.recorded]).toEqual(["src/gen.ts"]);
    expect([...sets.exemptCeilings]).toEqual(["src/gen.ts"]);
  });

  it("calls a path standing in BOTH halves an exempt ceiling, the way the gate's tightest-floor read does", () => {
    const sets = floorSetsOf({
      baseline: {
        exempt: [{ codeLines: 571, path: "src/both.ts" }],
        offenders: [{ codeLines: 400, path: "src/both.ts" }],
      },
    });
    expect([...sets.recorded]).toEqual(["src/both.ts"]);
    expect([...sets.exemptCeilings]).toEqual(["src/both.ts"]);
  });

  it("records nothing from an empty floor, so no long file is called frozen", () => {
    const sets = floorSetsOf({ baseline: { exempt: [], offenders: [] } });
    expect(sets.recorded.size).toBe(0);
    expect(sets.exemptCeilings.size).toBe(0);
  });
});
