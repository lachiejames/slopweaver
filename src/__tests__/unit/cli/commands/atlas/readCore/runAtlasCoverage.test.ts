/*
 * `runAtlasCoverage`, the shell, over plain injected fakes: an unknown kind refused, exit 3 whenever the gate refuses
 * whatever the filter, and the `--json` document's surfaces and declared exclusions.
 */
import { describe, expect, it } from "vitest";

import type { AtlasExclusion } from "../../../../../../atlas/kit/contract.js";
import type { AtlasPlatformRegistration } from "../../../../../../atlas/registry.js";
import { type AtlasCoverageDeps, runAtlasCoverage } from "../../../../../../cli/commands/atlas/coverageRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { ok } from "../../../../../../lib/result.js";
import { refusedSnapshot, snapshot } from "./harness.js";

/** Recording deps for `atlas coverage`. */
function coverageDeps({ gated = false }: { gated?: boolean } = {}): AtlasCoverageDeps & {
  readonly out: string[];
  readonly diag: string[];
} {
  const out: string[] = [];
  const diag: string[] = [];
  const found: AtlasPlatformRegistration = {
    catalogue: { doorRouted: false, example: "slopweaver atlas cloudflare read", summary: null },
    platform: "cloudflare",
    readDescriptor: async () => snapshot().descriptor,
    readSnapshot: async () => ok(gated ? refusedSnapshot() : snapshot()),
    verbs: [],
  };
  return {
    diag,
    find: ({ platform }) => (platform === "cloudflare" ? found : null),
    out,
    platforms: () => ["cloudflare", "slack", "vanta"],
    writeDiagnostic: (line) => diag.push(line),
    writeOut: (line) => out.push(line),
  };
}

describe("runAtlasCoverage", () => {
  it("refuses an unknown kind rather than reporting it as empty coverage", async () => {
    const deps = coverageDeps();
    expect(await runAtlasCoverage({ deps, platform: "cloudflare", rest: ["--kind", "nope"] })).toBe(EXIT_USAGE);
    expect(deps.diag[0]).toBe("cloudflare has no kind nope — it declares: zone");
  });

  it("exits 3 when the gate refuses, and a narrowing filter cannot buy a green exit", async () => {
    const clean = coverageDeps();
    expect(await runAtlasCoverage({ deps: clean, platform: "cloudflare", rest: [] })).toBe(EXIT_OK);
    const gated = coverageDeps({ gated: true });
    expect(await runAtlasCoverage({ deps: gated, platform: "cloudflare", rest: [] })).toBe(EXIT_EXPECTED_EMPTY);
    const filtered = coverageDeps({ gated: true });
    // `--state synced` narrows the deferred cell out of the printed report; the exit must not move.
    expect(await runAtlasCoverage({ deps: filtered, platform: "cloudflare", rest: ["--state", "synced"] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(
      await runAtlasCoverage({ deps: coverageDeps({ gated: true }), platform: "cloudflare", rest: ["--json"] }),
    ).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("emits a JSON document carrying the surfaces and the declared exclusions", async () => {
    const deps = coverageDeps();
    expect(await runAtlasCoverage({ deps, platform: "cloudflare", rest: ["--json"] })).toBe(EXIT_OK);
    const parsed = JSON.parse(deps.out[0]!) as {
      surfaces: readonly { status: string }[];
      excludes: readonly AtlasExclusion[];
    };
    expect(parsed.surfaces.length).toBe(2);
    expect(parsed.surfaces[1]?.status).toBe("declared-unfilled");
    expect(parsed.excludes).toEqual([{ because: "any mutation", ground: "never-acted" }]);
  });
});
