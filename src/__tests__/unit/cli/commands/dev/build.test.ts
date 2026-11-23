/**
 * The `dev build` shell's decided-before-anything-spawns paths.
 *
 * Deliberately spawn-free, the same shape as `profile.test.ts` beside it: what this verb DOES is run
 * esbuild and then the entrypoint it emitted, which is the `build-cli` CI job's subject rather than a unit
 * test's. What it decides before spawning is pure, and it is where every operator mistake lands. The pure
 * half — the argv, the manifest re-rooting and the verdict — is `buildCore.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { devBuildCommand, runDevBuildWithDeps } from "../../../../../cli/commands/dev/build.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { Logger } from "../../../../../lib/logger.js";

/** A logger that records what the verb printed, by stream. */
function captureLogger(): { log: Pick<Logger, "error" | "out">; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return {
    errs,
    log: {
      error: ({ msg }) => {
        errs.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
    },
    out,
  };
}

/** `slopweaver dev build <tail>` — the tail starts at argv index 4. */
const run = ({ tail, log }: { tail: readonly string[]; log: Pick<Logger, "error" | "out"> }): Promise<number> =>
  runDevBuildWithDeps({ argv: ["node", "slopweaver", "dev", "build", ...tail], log });

describe("runDevBuildWithDeps", () => {
  it("prints usage on --help and spawns nothing", async () => {
    const { log, out } = captureLogger();
    expect(await run({ log, tail: ["--help"] })).toBe(EXIT_OK);
    expect(out[0]).toContain("usage: slopweaver dev build");
  });

  it("takes -h as the same request", async () => {
    const { log, out } = captureLogger();
    expect(await run({ log, tail: ["-h"] })).toBe(EXIT_OK);
    expect(out[0]).toContain("usage: slopweaver dev build");
  });

  it("refuses an unknown flag before spawning anything, and prints the usage with it", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--nope"] })).toBe(EXIT_USAGE);
    expect(errs[0]).toBe("unknown flag: --nope");
    expect(errs[1]).toContain("usage: slopweaver dev build");
  });

  it("refuses --out with no directory after it", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--out"] })).toBe(EXIT_USAGE);
    expect(errs[0]).toContain("--out");
  });
});

describe("the manifest-selected handler", () => {
  it("is the run function itself, carrying no metadata of its own", () => {
    expect(Object.hasOwn(devBuildCommand, "meta")).toBe(false);
  });
});
