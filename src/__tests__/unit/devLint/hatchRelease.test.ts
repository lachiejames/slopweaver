import { describe, expect, it } from "vitest";
import { hatchEnvAliases, isScannablePath, scanHatchRelease } from "../../../devLint/hatchRelease.js";

/** The alias the real defect went through, so every case here reads like the code that shipped. */
const ALIASES: ReadonlySet<string> = new Set(["ALLOW_SPENT_PLAN_ENV"]);

describe("the hatch-release gate", () => {
  it("refuses the exact line that shipped — a hatch alias read as a parameter default", () => {
    // The original defect, verbatim in shape: `cmux spawn` passed `allowSpentPlan` explicitly, so this
    // default never ran and SLOPWEAVER_ALLOW_SPENT_PLAN released nothing on the one verb naming it.
    const hits = scanHatchRelease({
      aliases: ALIASES,
      content: [
        "export function productionSpawnDeps({",
        '  allowSpentPlan = process.env[ALLOW_SPENT_PLAN_ENV] === "1",',
        "}: { allowSpentPlan?: boolean } = {}): SpawnDeps {",
        "  return build(allowSpentPlan);",
        "}",
      ].join("\n"),
      path: "src/cmux/spawn.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(2);
    expect(hits[0]!.path).toBe("src/cmux/spawn.ts");
    expect(hits[0]!.message).toContain("ALLOW_SPENT_PLAN_ENV is read as a PARAMETER DEFAULT");
  });

  it("accepts the fix — the same read OR'd into a local inside the body", () => {
    expect(
      scanHatchRelease({
        aliases: ALIASES,
        content: [
          "export function productionSpawnDeps({ allowSpentPlan = false }: Opts = {}): SpawnDeps {",
          "  const open = spentPlanHatchOpen({ env: process.env[ALLOW_SPENT_PLAN_ENV], flag: allowSpentPlan });",
          "  return build(open);",
          "}",
        ].join("\n"),
        path: "src/cmux/spawn.ts",
      }),
    ).toEqual([]);
  });

  it("refuses a hatch spelled as a literal, with no alias in play", () => {
    const hits = scanHatchRelease({
      aliases: new Set(),
      content: 'function send({ allow = process.env["SLOPWEAVER_ALLOW_WALL"] === "1" }: Opts): void {}',
      path: "src/outbound/send.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toContain("SLOPWEAVER_ALLOW_WALL is read as a PARAMETER DEFAULT");
  });

  it("refuses the door override list read the same way", () => {
    const hits = scanHatchRelease({
      aliases: new Set(),
      content: "function send({ waived = process.env.SLOPWEAVER_DOOR_OVERRIDE }: Opts): void {}",
      path: "src/admit/send.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toContain("SLOPWEAVER_DOOR_OVERRIDE is read as a PARAMETER DEFAULT");
  });

  it("reaches a default nested inside a parameter's object literal", () => {
    // The hazard is the POSITION, not the depth: a default that builds an options object out of the
    // variable is skipped by an explicit argument exactly as a bare one is.
    const hits = scanHatchRelease({
      aliases: ALIASES,
      content: 'function boot({ opts = { allow: process.env[ALLOW_SPENT_PLAN_ENV] === "1" } }: Opts): void {}',
      path: "src/cmux/boot.ts",
    });
    expect(hits.length).toBe(1);
  });

  it("leaves an ordinary environment read in a parameter default alone", () => {
    // `home` is not an escape hatch: there an explicit argument SHOULD win over the ambient value, which is
    // the whole reason the criterion is the hatch family rather than `process.env` everywhere.
    expect(
      scanHatchRelease({
        aliases: ALIASES,
        content: 'function store({ home = process.env["SLOPWEAVER_HOME"] }: Opts): void {}',
        path: "src/corpus/store.ts",
      }),
    ).toEqual([]);
  });

  it("leaves a hatch read in a variable declaration alone", () => {
    expect(
      scanHatchRelease({
        aliases: ALIASES,
        content: 'const allow = process.env[ALLOW_SPENT_PLAN_ENV] === "1";',
        path: "src/cmux/spawn.ts",
      }),
    ).toEqual([]);
  });

  it("finds nothing in an empty file", () => {
    expect(scanHatchRelease({ aliases: ALIASES, content: "", path: "src/empty.ts" })).toEqual([]);
  });
});

describe("hatchEnvAliases", () => {
  it("collects the identifier a module binds to a hatch variable name", () => {
    expect(
      hatchEnvAliases({
        content: 'export const ALLOW_SPENT_PLAN_ENV = "SLOPWEAVER_ALLOW_SPENT_PLAN";',
        path: "src/claude/spawnStore.ts",
      }),
    ).toEqual(["ALLOW_SPENT_PLAN_ENV"]);
  });

  it("ignores a constant bound to something that is not a hatch", () => {
    expect(hatchEnvAliases({ content: 'const HOME_ENV = "SLOPWEAVER_HOME";', path: "src/config.ts" })).toEqual([]);
  });

  it("collects the owner's ALLOW_FABLE_OVERRIDE, a hatch named outside the SLOPWEAVER_ALLOW_ family", () => {
    expect(
      hatchEnvAliases({
        content: 'export const FABLE_OVERRIDE_ENV = "ALLOW_FABLE_OVERRIDE";',
        path: "src/cmux/modelPin.ts",
      }),
    ).toEqual(["FABLE_OVERRIDE_ENV"]);
  });

  it("refuses an out-of-family override read as a parameter default", () => {
    const hits = scanHatchRelease({
      aliases: new Set(),
      content:
        'export function pick({ open = process.env.ACME_POLICY_OVERRIDE === "1" }: { open?: boolean } = {}): boolean {\n  return open;\n}',
      path: "src/a.ts",
    });
    expect(hits.map((hit) => hit.line)).toEqual([1]);
    expect(hits[0]!.message).toContain("ACME_POLICY_OVERRIDE is read as a PARAMETER DEFAULT");
  });

  it("collects the door override name too", () => {
    expect(
      hatchEnvAliases({
        content: 'const DOOR = "SLOPWEAVER_DOOR_OVERRIDE";',
        path: "src/admit/door.ts",
      }),
    ).toEqual(["DOOR"]);
  });
});

describe("the gate's scope", () => {
  it("scans the source trees", () => {
    expect(isScannablePath({ path: "src/cmux/spawn.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/pretooluse.ts" })).toBe(true);
    expect(isScannablePath({ path: "desktop/src/fleetHealth.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/feature/Break.tsx" })).toBe(true);
  });

  it("skips its own files, so its examples are not its own violations", () => {
    expect(isScannablePath({ path: "src/devLint/hatchRelease.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/hatchRelease.entry.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/unit/devLint/hatchRelease.test.ts" })).toBe(false);
  });

  it("still scans a file elsewhere that only shares the gate's name, so a name cannot buy an exemption", () => {
    expect(isScannablePath({ path: "desktop/src/hatchRelease.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/hatch/hatchRelease.ts" })).toBe(true);
  });

  it("skips a path outside the source trees", () => {
    expect(isScannablePath({ path: "docs/toolchain.md" })).toBe(false);
  });
});
