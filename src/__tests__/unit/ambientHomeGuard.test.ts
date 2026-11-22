import { existsSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { accountDefaultHome } from "../../homeDir.js";
import { accountHomeSandboxTokens, accountSandboxChildEnv } from "../accountHomeSandboxChild.js";
import { ambientHomeRefusal } from "../ambientHomeGuard.js";

/** What the account home answered while this test module's own body ran, before any hook. */
const accountHomeAtModuleScope = accountDefaultHome();

/** The guard's path exactly as every lane config must spell it. */
const SETUP = "./src/__tests__/setup-ambient-home.ts";

/** The temp-root sandbox's path, which every lane must load AHEAD of the guard. */
const TEMP_ROOT_SETUP = "./src/__tests__/setup-temp-root.ts";

/** The TypeScript lifecycle teardown, which every lane loads after the guard. */
const TYPESCRIPT_LIFECYCLE_SETUP = "./src/__tests__/setup-typescript-lifecycle.ts";

/** Its run-level sweep, which rides `globalSetup` rather than `setupFiles`. */
const TEMP_ROOT_GLOBAL = "./src/__tests__/global-temp-root.ts";

/** Read one repo file as text. The lane configs live outside `rootDir`, so they are read, not imported. */
function repoText({ path }: { path: string }): string {
  return readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");
}

describe("the account-home sandbox the guard installs", () => {
  it("answers a sandbox, never the account's real ~/.slopweaver, already at this file's module scope", () => {
    expect(accountHomeAtModuleScope === join(userInfo().homedir, ".slopweaver")).toBe(false);
    expect(accountDefaultHome()).toBe(accountHomeAtModuleScope);
  });

  it("is installed at module scope, reinstalled after each test and cleared after the file", () => {
    const text = repoText({ path: "src/__tests__/setup-ambient-home.ts" });
    // Unindented is module scope; indented two spaces is inside a hook body.
    expect(text).toContain("\ninstallAccountHomeSandbox({ home: accountSandbox });\n");
    expect(text).toContain("\n  installAccountHomeSandbox({ home: accountSandbox });\n");
    expect(text).toContain("afterAll(() => {\n  clearAccountHomeSandbox();\n");
  });

  it("rides NODE_OPTIONS as exactly one preload naming this file's sandbox, for every child to inherit", () => {
    const tokens = accountHomeSandboxTokens({ value: process.env["NODE_OPTIONS"] });
    expect(tokens.length).toBe(1);
    const carried = new URL(tokens[0]!.slice("--import=".length)).searchParams.get("home");
    expect(carried).toBe(accountHomeAtModuleScope);
    expect(accountSandboxChildEnv()).toEqual({ NODE_OPTIONS: tokens[0] });
  });

  it("is owned and restored like the other moved keys, so a reused fork never stacks two preloads", () => {
    const text = repoText({ path: "src/__tests__/setup-ambient-home.ts" });
    expect(text).toContain('names: [HOME_VAR, APP_SERVER_VAR, "SLOPWEAVER_STORE_URL", NODE_OPTIONS_VAR],');
    expect(text).toContain("\nprocess.env[NODE_OPTIONS_VAR] = accountHomeSandboxNodeOptions({\n");
  });
});

describe("ambientHomeRefusal", () => {
  it("says nothing when the sandbox home stayed empty", () => {
    expect(ambientHomeRefusal({ writes: [] })).toBe(undefined);
  });

  it("names every written path, sorted, and the remedy", () => {
    const refusal = ambientHomeRefusal({ writes: ["secrets/slack-bot-token", "ledgers/door.jsonl"] });

    expect(refusal).toBe(
      [
        "this test wrote 2 path(s) under the ambient $SLOPWEAVER_HOME:",
        "  ledgers/door.jsonl",
        "  secrets/slack-bot-token",
        "On a developer's machine that variable is unset, so these went to the REAL ~/.slopweaver and corrupted",
        "its ledgers. Pass an explicit home to the verb under test — `--home <dir>` for a CLI runner, " +
          "`{ home }` for a store — built with `mkdtempSync(join(tmpdir(), ...))` and removed in an " +
          "`afterEach`, the way `github/stackAdoptRun.test.ts` does it.",
      ].join("\n"),
    );
  });

  it("counts a single write on the same header line", () => {
    expect(ambientHomeRefusal({ writes: ["ledgers/door.jsonl"] })!.split("\n")[0]).toBe(
      "this test wrote 1 path(s) under the ambient $SLOPWEAVER_HOME:",
    );
  });
});

/** The store selector `store/config.ts` reads ahead of the sandbox home's own `secrets/store-url`. */
const STORE_URL_VAR = "SLOPWEAVER_STORE_URL";

describe("the ambient store selector never reaches a test", () => {
  it("clears it at module scope, before any test module's own body runs", () => {
    const setup = repoText({ path: SETUP.slice(2) });
    const moduleScopeClear = `Reflect.deleteProperty(process.env, STORE_URL_VAR);\n\n/** This test file's sandbox home`;

    expect(setup).toContain(`const STORE_URL_VAR = "${STORE_URL_VAR}";`);
    expect(setup).toContain(moduleScopeClear);
  });

  // The pair below is order-dependent on purpose: vitest runs one file's cases in declaration order, so the
  // second case reads the environment the guard's `afterEach` left behind the first.
  it("lets a test set it for its own body", () => {
    process.env[STORE_URL_VAR] = "postgresql://127.0.0.1:1/never-reached";
    expect(process.env[STORE_URL_VAR]).toBe("postgresql://127.0.0.1:1/never-reached");
  });

  it("has cleared it again before the next test", () => {
    expect(STORE_URL_VAR in process.env).toBe(false);
  });
});

describe("every lane loads the guard", () => {
  it("the path each config names is a file that exists", () => {
    expect(existsSync(fileURLToPath(new URL(`../../../${SETUP.slice(2)}`, import.meta.url)))).toBe(true);
  });

  it("the temp-root sandbox is a file too, and the base config names it first", () => {
    const base = repoText({ path: "config/vitest/base.ts" });

    expect(existsSync(fileURLToPath(new URL(`../../../${TEMP_ROOT_SETUP.slice(2)}`, import.meta.url)))).toBe(true);
    expect(base).toContain(`export const TEMP_ROOT_SETUP = "${TEMP_ROOT_SETUP}";`);
  });

  // The run-level sweep is the half that survives a skipped file and a dead worker, and it rides
  // `globalSetup` rather than `setupFiles` precisely so a lane declaring its own setup array cannot drop it.
  it("the base config declares the run-level sweep as globalSetup", () => {
    const base = repoText({ path: "config/vitest/base.ts" });

    expect(existsSync(fileURLToPath(new URL(`../../../${TEMP_ROOT_GLOBAL.slice(2)}`, import.meta.url)))).toBe(true);
    expect(base).toContain(`export const TEMP_ROOT_GLOBAL = "${TEMP_ROOT_GLOBAL}";`);
    expect(base).toContain("globalSetup: [TEMP_ROOT_GLOBAL],");
  });

  it("no lane overrides globalSetup, so all three inherit the sweep through the spread", () => {
    for (const lane of ["unit", "subprocess", "integration"]) {
      expect(repoText({ path: `config/vitest/${lane}.ts` }).includes("globalSetup")).toBe(false);
    }
  });

  it("the base config declares it, and defines the constant the others import", () => {
    const base = repoText({ path: "config/vitest/base.ts" });

    expect(base).toContain(`export const AMBIENT_HOME_SETUP = "${SETUP}";`);
    expect(base).toContain("setupFiles: [TEMP_ROOT_SETUP, AMBIENT_HOME_SETUP, TYPESCRIPT_LIFECYCLE_SETUP],");
  });

  // The TypeScript lifecycle teardown rides the same array, so it is dropped by the same replacement.
  it("the TypeScript lifecycle teardown is a file too, and the base config declares it", () => {
    const base = repoText({ path: "config/vitest/base.ts" });

    expect(existsSync(fileURLToPath(new URL(`../../../${TYPESCRIPT_LIFECYCLE_SETUP.slice(2)}`, import.meta.url)))).toBe(
      true,
    );
    expect(base).toContain(`export const TYPESCRIPT_LIFECYCLE_SETUP = "${TYPESCRIPT_LIFECYCLE_SETUP}";`);
  });

  it("the integration lane keeps the guard and the teardown beside its own Polly setup rather than replacing them", () => {
    expect(repoText({ path: "config/vitest/integration.ts" })).toContain(
      'setupFiles: [TEMP_ROOT_SETUP, AMBIENT_HOME_SETUP, "./src/__tests__/setup-polly.ts", TYPESCRIPT_LIFECYCLE_SETUP],',
    );
  });

  // A lane declaring its own `setupFiles` REPLACES the base array rather than extending it, so these two
  // inherit the guard only for as long as they declare none. This is the assertion that reddens the day
  // someone adds one — the guard would otherwise be dropped silently, with a green suite.
  it("the unit lane declares no setupFiles of its own", () => {
    expect(repoText({ path: "config/vitest/unit.ts" }).includes("setupFiles")).toBe(false);
  });

  it("the subprocess lane declares no setupFiles of its own", () => {
    expect(repoText({ path: "config/vitest/subprocess.ts" }).includes("setupFiles")).toBe(false);
  });
});

// The unit lane reuses one fork across files, so the setup files' declared order and their per-file env restore
// are what keep one file's sandbox from leaking into the next; the other two lanes stay on fresh processes.
describe("only the unit lane reuses a fork, and every lane runs its setup files in the order written", () => {
  it("the base runs setup files as a list and isolates by default", () => {
    const base = repoText({ path: "config/vitest/base.ts" });

    expect(base).toContain('sequence: { setupFiles: "list" },');
    expect(base).toContain("isolate: true,");
  });

  it("the integration lane spreads the base sequence rather than replacing it", () => {
    expect(repoText({ path: "config/vitest/integration.ts" })).toContain(
      "sequence: { ...baseVitestConfig.test?.sequence, concurrent: false },",
    );
  });

  it("the unit lane narrows isolation and the other two lanes never mention it", () => {
    expect(repoText({ path: "config/vitest/unit.ts" })).toContain("isolate: false,");
    expect(repoText({ path: "config/vitest/integration.ts" }).includes("isolate")).toBe(false);
    expect(repoText({ path: "config/vitest/subprocess.ts" }).includes("isolate")).toBe(false);
  });

  it("both env-moving setup files restore what they own at module scope AND in afterAll", () => {
    // Twice, because a previous file whose tests all skipped never reached its afterAll.
    for (const setupFile of ["src/__tests__/setup-temp-root.ts", "src/__tests__/setup-ambient-home.ts"]) {
      expect(repoText({ path: setupFile }).split("restoreEnvironment({ snapshot: owned });").length - 1).toBe(2);
    }
  });

  it("the first setup file puts the browser-sniff globals back at module scope AND in afterAll", () => {
    const text = repoText({ path: "src/__tests__/setup-temp-root.ts" });

    expect(text.split("restoreGlobals({ snapshot: ownedGlobals });").length - 1).toBe(2);
  });
});

/** The `<n>_000` literal a lane config declares for one timeout setting, in milliseconds. */
function declaredTimeoutMs({ lane, setting }: { lane: string; setting: string }): number {
  const found = new RegExp(`${setting}: ([0-9_]+),`).exec(repoText({ path: `config/vitest/${lane}.ts` }));
  return Number(found![1]!.replaceAll("_", ""));
}

// Vitest budgets a test from `testTimeout` and a `beforeAll`/`afterAll` from `hookTimeout`, a SEPARATE
// setting defaulting to 10s. A lane that raises only the first hands its tightest budget to its most
// expensive work, because hoisting a costly fixture into a `beforeAll` is the standard remedy for a slow
// suite — measured on the two datadog atlas suites, which say in their own comments that they hoisted a
// 1,735-entity sync out of a 20s budget and thereby into a 10s one. Text, not an import: these configs live
// outside `rootDir`, exactly as the assertions above read them.
describe("no lane raises testTimeout without raising hookTimeout with it", () => {
  it("the unit lane budgets a hook exactly as it budgets a test", () => {
    expect(declaredTimeoutMs({ lane: "unit", setting: "hookTimeout" })).toBe(20_000);
    expect(declaredTimeoutMs({ lane: "unit", setting: "testTimeout" })).toBe(20_000);
  });

  it("the subprocess lane budgets a hook exactly as it budgets a test", () => {
    expect(declaredTimeoutMs({ lane: "subprocess", setting: "hookTimeout" })).toBe(60_000);
    expect(declaredTimeoutMs({ lane: "subprocess", setting: "testTimeout" })).toBe(60_000);
  });

  it("the integration lane, which already spelled both, still does", () => {
    expect(declaredTimeoutMs({ lane: "integration", setting: "hookTimeout" })).toBe(60_000);
    expect(declaredTimeoutMs({ lane: "integration", setting: "testTimeout" })).toBe(60_000);
  });
});
