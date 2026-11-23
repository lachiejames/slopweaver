/**
 * `proof yarn-why` — every case here is a parse, a usage line, or a refusal reached BEFORE the verb opens
 * a real Terminal window. The real capture path needs a live macOS Terminal.app, which is not what a unit
 * test does — see the handover doc's own proof section (and this repo's PR) for that live evidence.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { proofYarnWhyCommand, runProofYarnWhy } from "../../../../../cli/commands/proof/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { ok } from "../../../../../lib/result.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

/** Build an argv the router would hand this verb: `[node, cli, noun, verb, …rest]`. */
function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "proof", "yarn-why", ...rest];
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("proof yarn-why", () => {
  it("prints usage on --help without touching the filesystem", async () => {
    expect(await proofYarnWhyCommand(argv({ rest: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses with EXIT_USAGE when required flags are missing", async () => {
    expect(await proofYarnWhyCommand(argv({ rest: [] }))).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag with EXIT_USAGE", async () => {
    expect(await proofYarnWhyCommand(argv({ rest: ["--dependency", "left-pad"] }))).toBe(EXIT_USAGE);
  });

  it("refuses with EXIT_ERROR when --before names a path that does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "proof-run-test-"));
    fixtureDirs.push(dir);

    const exitCode = await proofYarnWhyCommand(
      argv({
        rest: [
          "--dep",
          "left-pad",
          "--before",
          join(dir, "does-not-exist"),
          "--after",
          dir,
          "--out",
          join(dir, "out.png"),
        ],
      }),
    );

    expect(exitCode).toBe(EXIT_ERROR);
  });

  it("refuses with EXIT_ERROR when --after names a path that does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "proof-run-test-"));
    fixtureDirs.push(dir);

    const exitCode = await proofYarnWhyCommand(
      argv({
        rest: [
          "--dep",
          "left-pad",
          "--before",
          dir,
          "--after",
          join(dir, "does-not-exist"),
          "--out",
          join(dir, "out.png"),
        ],
      }),
    );

    expect(exitCode).toBe(EXIT_ERROR);
  });
});

describe("proof yarn-why's output placement", () => {
  /** A run over real before/after directories, a fake capture that records every call, and captured output. */
  async function runAt({ cwd, out }: { cwd: string; out: string }): Promise<{
    code: number;
    builds: string[];
    errors: string[];
  }> {
    const builds: string[] = [];
    const errors: string[] = [];
    const code = await runProofYarnWhy({
      deps: {
        build: async ({ outPath }) => {
          builds.push(outPath);
          return ok(undefined);
        },
        cwd,
        env: {},
        home: join(cwd, "no-such-home"),
        log: {
          error: ({ msg }) => {
            errors.push(msg);
          },
          out: () => undefined,
        },
      },
      rest: ["--dep", "left-pad", "--before", cwd, "--after", cwd, "--out", out],
    });
    return { builds, code, errors };
  }

  it("refuses an --out inside a git checkout before any capture starts", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "proof-run-test-")));
    fixtureDirs.push(dir);
    gitInTemp({ args: ["init", "-q"], cwd: dir });

    const { code, builds, errors } = await runAt({ cwd: dir, out: "packages/x/proof/yarn-why.png" });

    expect(code).toBe(EXIT_ERROR);
    expect(builds).toEqual([]);
    expect(errors[0]).toBe(
      `proof yarn-why: ${join(dir, "packages/x/proof/yarn-why.png")} is inside the git checkout ${dir}, where a commit can carry it into a pull request; nothing was captured`,
    );
  });

  it("captures to an --out outside every checkout", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "proof-run-test-")));
    fixtureDirs.push(dir);

    const { code, builds } = await runAt({ cwd: dir, out: "yarn-why.png" });

    expect(code).toBe(EXIT_OK);
    expect(builds).toEqual(["yarn-why.png"]);
  });
});
