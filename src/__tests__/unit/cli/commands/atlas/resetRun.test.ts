import { describe, expect, it } from "vitest";

import type { AtlasPlatformReset } from "../../../../../atlas/kit/reset.js";
import { type AtlasResetCommandDeps, runAtlasResetCommand } from "../../../../../cli/commands/atlas/resetRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ok } from "../../../../../lib/result.js";

/** One call the fake shared verb received. */
interface RunResetCall {
  readonly argv: readonly string[];
  readonly platform: string;
  readonly reset: AtlasPlatformReset;
  readonly usage: string;
}

/** A reset that is never invoked by the dispatch under test; only its identity is compared. */
const ALPHA_RESET: AtlasPlatformReset = () => ok({ archiveId: "archive-alpha", archivedTo: "/archive/alpha" });

/**
 * Plain fakes over a two-platform registry: `alpha` declares a reset, `bravo` does not.
 *
 * @returns the dependencies and what each observed
 */
function fakeDeps({ runResetCode }: { runResetCode: number }): {
  readonly deps: AtlasResetCommandDeps;
  readonly errors: string[];
  readonly found: string[];
  readonly runs: RunResetCall[];
} {
  const errors: string[] = [];
  const found: string[] = [];
  const runs: RunResetCall[] = [];
  return {
    deps: {
      error: ({ msg }) => {
        errors.push(msg);
      },
      find: ({ platform }) => {
        found.push(platform);
        if (platform === "alpha") {
          return { readReset: async () => ALPHA_RESET };
        }
        return {};
      },
      platforms: () => ["alpha", "bravo"],
      runReset: (call) => {
        runs.push(call);
        return runResetCode;
      },
    },
    errors,
    found,
    runs,
  };
}

describe("runAtlasResetCommand", () => {
  it("refuses an argv with no platform, listing every platform the build has", async () => {
    const fake = fakeDeps({ runResetCode: 0 });
    expect(await runAtlasResetCommand({ argv: ["node", "slopweaver", "atlas"], deps: fake.deps })).toBe(EXIT_USAGE);
    expect(fake.errors).toEqual([
      'slopweaver atlas reset: unknown platform "undefined"',
      "every platform this build has: alpha, bravo",
    ]);
    expect(fake.found).toEqual([]);
    expect(fake.runs).toEqual([]);
  });

  it("refuses a platform the registry does not carry, without looking up a registration", async () => {
    const fake = fakeDeps({ runResetCode: 0 });
    const code = await runAtlasResetCommand({
      argv: ["node", "slopweaver", "atlas", "charlie", "reset"],
      deps: fake.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(fake.errors).toEqual([
      'slopweaver atlas reset: unknown platform "charlie"',
      "every platform this build has: alpha, bravo",
    ]);
    expect(fake.found).toEqual([]);
  });

  it("refuses a known platform whose registration declares no reset, naming the missing verb", async () => {
    const fake = fakeDeps({ runResetCode: 0 });
    const code = await runAtlasResetCommand({
      argv: ["node", "slopweaver", "atlas", "bravo", "reset"],
      deps: fake.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(fake.errors).toEqual(['slopweaver atlas bravo has no verb "reset"']);
    expect(fake.found).toEqual(["bravo"]);
    expect(fake.runs).toEqual([]);
  });

  it("hands a reset-capable platform's own reset to the shared verb once and returns its code", async () => {
    const fake = fakeDeps({ runResetCode: 9 });
    const argv = ["node", "slopweaver", "atlas", "alpha", "reset", "--confirm", "archive"];
    expect(await runAtlasResetCommand({ argv, deps: fake.deps })).toBe(9);
    expect(fake.runs).toEqual([
      {
        argv,
        platform: "alpha",
        reset: ALPHA_RESET,
        usage: "usage: slopweaver atlas alpha reset --confirm archive [--json] [--home <dir>]",
      },
    ]);
    expect(fake.runs[0]!.reset).toBe(ALPHA_RESET);
    expect(fake.errors).toEqual([]);
  });
});
