/*
 * `runAtlasRead`, the shell, over plain injected fakes: the platform refusals, the `--json` document, a store failure,
 * `--help`, and the exit-3 refusal of an empty selection the evidence never measured.
 */
import { describe, expect, it } from "vitest";

import type { AtlasPlatformRegistration } from "../../../../../../atlas/registry.js";
import { type AtlasReadDeps, runAtlasRead } from "../../../../../../cli/commands/atlas/readRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { FIXTURE_NOW_MS, snapshot } from "./harness.js";

/** A registration that hands back the fixture snapshot. */
function registration(): AtlasPlatformRegistration {
  return {
    catalogue: { doorRouted: false, example: "slopweaver atlas cloudflare read", summary: null },
    platform: "cloudflare",
    readDescriptor: async () => snapshot().descriptor,
    readSnapshot: async () => ok(snapshot()),
    verbs: [],
  };
}

/** Recording deps for `atlas read`. */
function readDeps(): AtlasReadDeps & { readonly out: string[]; readonly diag: string[] } {
  const out: string[] = [];
  const diag: string[] = [];
  return {
    diag,
    find: ({ platform }) => (platform === "cloudflare" ? registration() : null),
    nowMs: () => FIXTURE_NOW_MS,
    out,
    platforms: () => ["cloudflare", "slack", "vanta"],
    writeDiagnostic: (line) => diag.push(line),
    writeOut: (line) => out.push(line),
  };
}

describe("runAtlasRead", () => {
  it("refuses with no platform named and lists the ones that exist", async () => {
    const deps = readDeps();
    expect(await runAtlasRead({ deps, platform: undefined, rest: [] })).toBe(EXIT_USAGE);
    expect(deps.diag[0]).toBe("name an atlas: slopweaver atlas <platform> — this build has cloudflare, slack, vanta");
  });

  it("refuses an unknown platform with the known list", async () => {
    const deps = readDeps();
    expect(await runAtlasRead({ deps, platform: "clouflare", rest: [] })).toBe(EXIT_USAGE);
    expect(deps.diag[0]).toBe("no atlas for platform clouflare — this build has: cloudflare, slack, vanta");
  });

  // The platform is the third word, so the flag that used to carry it is not a flag at all. Refused by the
  // parser as unknown rather than accepted and ignored, which would have let two spellings disagree.
  it("refuses the platform as a flag", async () => {
    const deps = readDeps();
    expect(await runAtlasRead({ deps, platform: "cloudflare", rest: ["--platform", "cloudflare"] })).toBe(EXIT_USAGE);
    expect(deps.diag.join("\n")).toContain("--platform");
  });

  it("emits one JSON document whose page reports the census, not the page size", async () => {
    const deps = readDeps();
    expect(await runAtlasRead({ deps, platform: "cloudflare", rest: ["--json"] })).toBe(EXIT_OK);
    expect(deps.out.length).toBe(1);
    const parsed: unknown = JSON.parse(deps.out[0]!);
    expect((parsed as { page: { matched: number } }).page.matched).toBe(1);
    expect((parsed as { platform: string }).platform).toBe("cloudflare");
  });

  it("reports a store failure on stderr and exits non-zero", async () => {
    const deps = readDeps();
    const failing: AtlasReadDeps = {
      ...deps,
      find: () => ({
        catalogue: { doorRouted: false, example: "slopweaver atlas cloudflare read", summary: null },
        platform: "cloudflare",
        readDescriptor: async () => snapshot().descriptor,
        readSnapshot: async () =>
          err({
            code: "ATLAS_STORE_UNREADABLE" as const,
            message: "the cloudflare atlas could not be read: nothing published",
            platform: "cloudflare",
            reasons: ["nothing published"],
          }),
        verbs: [],
      }),
    };
    expect(await runAtlasRead({ deps: failing, platform: "cloudflare", rest: [] })).toBe(EXIT_ERROR);
    expect(deps.diag[0]).toBe("the cloudflare atlas could not be read: nothing published");
  });

  it("prints usage for --help without reading any atlas", async () => {
    const deps = readDeps();
    expect(await runAtlasRead({ deps, platform: "cloudflare", rest: ["--help"] })).toBe(EXIT_OK);
    expect(deps.out[0]?.startsWith("usage: slopweaver atlas <platform> read")).toBe(true);
  });

  // The measured witness, driven through the real shell rather than the assessment helper: the defect was
  // that both ENCODINGS dropped the qualification, so a test that stopped at the kit would have passed
  // while the verb kept answering zero.
  it("exits 3 rather than answering an empty selection the evidence never measured", async () => {
    const deps = readDeps();
    expect(await runAtlasRead({ deps, platform: "cloudflare", rest: ["--query", "nothing-matches-this"] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(deps.out[0]).toBe("cloudflare atlas — 0 matching STORED entities");
    expect(deps.out.some((line) => line.includes("A ZERO HERE WOULD PROVE NOTHING"))).toBe(true);
    expect(deps.out.some((line) => line.includes("slopweaver atlas <platform> read blocked because"))).toBe(true);
    expect(deps.out.some((line) => line.includes("--accept-unproven-empty"))).toBe(true);
  });

  it("emits a refusal document with NO success-shaped entities field on --json", async () => {
    const deps = readDeps();
    expect(
      await runAtlasRead({ deps, platform: "cloudflare", rest: ["--json", "--query", "nothing-matches-this"] }),
    ).toBe(EXIT_EXPECTED_EMPTY);
    const parsed = JSON.parse(deps.out[0]!) as Record<string, unknown>;
    expect(parsed["outcome"]).toBe("refused");
    expect(parsed["schemaVersion"]).toBe(2);
    expect(parsed["code"]).toBe("ATLAS_READ_EMPTY_UNPROVEN");
    expect(Object.keys(parsed).includes("entities")).toBe(false);
  });

  it("answers the same selection at exit 0 under the named escape hatch, carrying the refusal it passed", async () => {
    const deps = readDeps();
    expect(
      await runAtlasRead({
        deps,
        platform: "cloudflare",
        rest: ["--json", "--accept-unproven-empty", "--query", "nothing-matches-this"],
      }),
    ).toBe(EXIT_OK);
    const parsed = JSON.parse(deps.out[0]!) as Record<string, unknown>;
    expect(parsed["outcome"]).toBe("selection");
    expect((parsed["acceptedUnproven"] as { code: string }).code).toBe("ATLAS_READ_EMPTY_UNPROVEN");
    expect((parsed["page"] as { matched: number }).matched).toBe(0);
  });

  it("refuses an undeclared --surface as a usage mistake rather than answering its zero", async () => {
    const deps = readDeps();
    expect(await runAtlasRead({ deps, platform: "cloudflare", rest: ["--surface", "consoel"] })).toBe(EXIT_USAGE);
    expect(deps.out[0]).toBe("cloudflare declares no surface consoel — it declares: rest-api, dashboard");
  });
});
