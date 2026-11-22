/**
 * A fresh install registering its Claude plans one at a time, over the shipped verbs and a throwaway home.
 *
 * Two defects this holds down. `plans adopt` once registered the ambient Codex home on an empty install — a plan
 * the user never offered (plans come only from the user's own sign-in), so adopt now writes
 * down nothing a Codex login on the machine could add. And the very next `plans add --provider claude` exited 1,
 * because the write path refused a projection holding one Claude row; one Claude plan is a whole fleet, so the first add must land and route on its own.
 *
 * The register lives in the store, and no lane has one, so the sequence runs the shipped verb body
 * (`runPlansVerb` over the production deps) with the store swapped for an in-memory row — and the shipped
 * BINARY is spawned once, to prove the other half: with no store selected, `plans adopt` refuses and writes no
 * file, rather than falling back to one.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { plansDepsOver, runPlansVerb } from "../../../../../cli/commands/plans/run.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { PlanRegisterPort } from "../../../../../plans/port.js";
import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";
import { memoryPlanRegisterPort } from "../../../../planRegisterFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

const homes: string[] = [];
let previousCodexHome: string | undefined;

beforeEach(() => {
  previousCodexHome = process.env["CODEX_HOME"];
});

afterEach(() => {
  if (previousCodexHome === undefined) {
    delete process.env["CODEX_HOME"];
  } else {
    process.env["CODEX_HOME"] = previousCodexHome;
  }
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway home, with the ambient Codex home pointed inside it too. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "first-claude-plan-"));
  homes.push(home);
  process.env["CODEX_HOME"] = join(home, "codex");
  return home;
}

/** Run one plans verb's shipped body against one home over `port`, recording what it said on stderr. */
async function run({
  args,
  home,
  port,
}: {
  args: readonly string[];
  home: string;
  port: PlanRegisterPort;
}): Promise<{ status: number; diagnostics: readonly string[] }> {
  const diagnostics: string[] = [];
  const [verb, ...rest] = args;
  const status = await runPlansVerb({
    deps: {
      ...plansDepsOver({ port }),
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: () => undefined,
    },
    rest: [...rest, "--home", home],
    verb: verb!,
  });
  return { diagnostics, status };
}

/** Every registered row as `provider:alias`, in order, read off the generated `plans.json` projection. */
function registeredRows({ home }: { home: string }): readonly string[] {
  const register = JSON.parse(readFileSync(join(home, "plans.json"), "utf8")) as {
    rows: readonly { provider: string; alias: string }[];
  };
  return register.rows.map((row) => `${row.provider}:${row.alias}`);
}

describe("a fresh install's first Claude plans", () => {
  it("adopts, then adds the first Claude plan, then the second", async () => {
    const home = freshHome();
    const port = memoryPlanRegisterPort();

    // A Codex login sits in the ambient `$CODEX_HOME`; the user never offered it, so adopt registers nothing.
    mkdirSync(join(home, "codex"), { recursive: true });
    writeFileSync(join(home, "codex", "auth.json"), "{}", "utf8");
    expect((await run({ args: ["adopt"], home, port })).status).toBe(EXIT_OK);
    expect(registeredRows({ home })).toStrictEqual([]);

    const first = await run({
      args: [
        "add",
        "--provider",
        "claude",
        "--plan",
        "plan-one",
        "--store-dir",
        join(home, "store-one"),
        "--email",
        "someone@example.com",
      ],
      home,
      port,
    });
    expect(first.diagnostics).toStrictEqual([]);
    expect(first.status).toBe(EXIT_OK);
    expect(registeredRows({ home })).toStrictEqual(["claude:plan-one"]);

    const second = await run({
      args: ["add", "--provider", "claude", "--plan", "plan-two", "--store-dir", join(home, "store-two")],
      home,
      port,
    });
    expect(second.status).toBe(EXIT_OK);
    expect(registeredRows({ home })).toStrictEqual(["claude:plan-one", "claude:plan-two"]);
  });

  it("refuses `plans adopt` from the shipped binary when no store is selected, and writes no file", () => {
    const home = freshHome();
    const result = spawnSync(BIN, ["plans", "adopt", "--home", home], {
      encoding: "utf8",
      // No SLOPWEAVER_STORE_URL and no `secrets/store-url` under the throwaway home: nothing is selected.
      env: {
        ...accountSandboxChildEnv(),
        CODEX_HOME: join(home, "codex"),
        HOME: process.env["HOME"]!,
        PATH: process.env["PATH"]!,
        // Pin the launcher to THIS checkout, so an ambient plugin root cannot route the run into another tree.
        SLOPWEAVER_CLI_DIR: repoRoot,
        TMPDIR: process.env["TMPDIR"]!,
      },
      maxBuffer: 4 * 1024 * 1024,
    });

    expect(result.status).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("the plan register lives in the store, and the store could not be opened");
    expect(existsSync(join(home, "plans.json"))).toBe(false);
  });
});
