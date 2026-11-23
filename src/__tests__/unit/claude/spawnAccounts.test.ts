import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClaudeRotationErrors } from "../../../claude/errors.js";
import {
  ACCOUNTS_PATH,
  EMPTIED_SOURCE_PROBLEM,
  readAccountsFile,
  readSpawnAccounts,
} from "../../../claude/spawnAccounts.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../planRegisterFixture.js";

let home = "";

const makeHome = (): string => {
  home = mkdtempSync(join(tmpdir(), "spawn-accounts-"));
  mkdirSync(join(home, "claude-accounts"), { recursive: true });
  return home;
};

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  home = "";
});

/** Write the legacy accounts file — the SOURCE until a register is adopted, a generated projection after. */
const writeLegacy = ({ dir, text }: { dir: string; text: string }): void => {
  writeFileSync(join(dir, ACCOUNTS_PATH), text);
};

/** Write an adopted register, which outranks whatever the projection beside it happens to hold. */
const writeRegister = ({ dir, rows }: { dir: string; rows: readonly Readonly<Record<string, unknown>>[] }): void => {
  writeFileSync(stateHomePaths({ home: dir }).plansJson, JSON.stringify({ rows, version: 1 }));
};

const TWO_PLANS = JSON.stringify([
  { alias: "plan-one", storeDir: "/stores/plan-one" },
  { alias: "plan-two", storeDir: "/stores/plan-two" },
]);

describe("readSpawnAccounts reads the register and tells an unconfigured install from a broken one", () => {
  it("answers ok(undefined) when nothing at all is configured, which is a legitimate install", async () => {
    // The one case that still falls through to the ambient credential. An install without the fleet has
    // neither file and must boot exactly as it did before routing existed.
    const dir = makeHome();
    expect(unwrap(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() }))).toBe(undefined);
  });

  it("derives the configured plans in configured order from the legacy file when nothing is adopted", async () => {
    const dir = makeHome();
    writeLegacy({ dir, text: TWO_PLANS });
    const accounts = unwrap(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() }))!;
    expect(accounts.map((account) => account.alias)).toStrictEqual(["plan-one", "plan-two"]);
  });

  it("reads an ADOPTED register's Claude rows, and ignores its Codex rows entirely", async () => {
    const dir = makeHome();
    writeRegister({
      dir,
      rows: [
        { alias: "plan-six", provider: "codex", storeDir: "/codex/six" },
        { alias: "plan-one", provider: "claude", storeDir: "/stores/plan-one" },
        { alias: "plan-two", provider: "claude", storeDir: "/stores/plan-two" },
      ],
    });
    const accounts = unwrap(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() }))!;
    expect(accounts.map((account) => account.alias)).toStrictEqual(["plan-one", "plan-two"]);
    expect(accounts.map((account) => account.storeDir)).toStrictEqual(["/stores/plan-one", "/stores/plan-two"]);
  });

  it("answers ok(undefined) for an adopted register with only CODEX rows — registering Codex never breaks Claude", async () => {
    const dir = makeHome();
    writeRegister({ dir, rows: [{ alias: "plan-six", provider: "codex", storeDir: "/codex/six" }] });
    expect(unwrap(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() }))).toBe(undefined);
  });

  it("outranks a divergent projection: the register's rows are what a seat gets", async () => {
    const dir = makeHome();
    writeLegacy({ dir, text: JSON.stringify([{ alias: "stale-one", storeDir: "/stale/one" }]) });
    writeRegister({
      dir,
      rows: [
        { alias: "plan-one", provider: "claude", storeDir: "/stores/plan-one" },
        { alias: "plan-two", provider: "claude", storeDir: "/stores/plan-two" },
      ],
    });
    const accounts = unwrap(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() }))!;
    expect(accounts.map((account) => account.alias)).toStrictEqual(["plan-one", "plan-two"]);
  });

  it("refuses a configuration that is PRESENT and will not read, rather than reporting no plans", async () => {
    // This is the distinction that mattered. The old reader collapsed a permission error into the same empty
    // list an absent file produced, so the gate fell silently through to whatever credential was ambient — the
    // exact failure routing exists to prevent. A directory where the file belongs is the portable EISDIR.
    const dir = makeHome();
    mkdirSync(join(dir, ACCOUNTS_PATH), { recursive: true });
    const error = unwrapErr(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() }));
    expect(error.code).toBe("ACCOUNT_CONFIG_UNREADABLE");
    expect(error.message).toContain(ACCOUNTS_PATH);
  });

  it("refuses an unreadable REGISTER, not only an unreadable projection", async () => {
    const dir = makeHome();
    mkdirSync(stateHomePaths({ home: dir }).plansJson, { recursive: true });
    const error = unwrapErr(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() }));
    expect(error.code).toBe("ACCOUNT_CONFIG_UNREADABLE");
    expect(error.message).toContain("plans.json");
  });

  it("refuses a file holding malformed JSON", async () => {
    const dir = makeHome();
    writeLegacy({ dir, text: "{ truncated" });
    expect(unwrapErr(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() })).code).toBe(
      "ACCOUNT_CONFIG_INVALID",
    );
  });

  it("refuses an EMPTY legacy array, which is a SOURCE someone emptied and not an absent install", async () => {
    const dir = makeHome();
    writeLegacy({ dir, text: "[]" });
    const error = unwrapErr(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() }));
    expect(error).toStrictEqual(ClaudeRotationErrors.accountConfigInvalid({ problems: [EMPTIED_SOURCE_PROBLEM] }));
  });

  // Rotation does not need two plans — one plan runs the whole fleet.
  it("reads ONE plan from the legacy source as the whole fleet", async () => {
    const dir = makeHome();
    writeLegacy({ dir, text: JSON.stringify([{ alias: "plan-one", storeDir: "/stores/plan-one" }]) });
    const accounts = unwrap(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() }))!;
    expect(accounts.map((account) => [account.alias, account.storeDir])).toStrictEqual([
      ["plan-one", "/stores/plan-one"],
    ]);
  });

  it("reads ONE Claude row from an adopted register as the whole fleet", async () => {
    const dir = makeHome();
    writeRegister({ dir, rows: [{ alias: "plan-one", provider: "claude", storeDir: "/stores/plan-one" }] });
    const accounts = unwrap(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() }))!;
    expect(accounts.map((account) => account.alias)).toStrictEqual(["plan-one"]);
  });

  it("refuses rows missing a store directory", async () => {
    const dir = makeHome();
    writeLegacy({ dir, text: JSON.stringify([{ alias: "plan-one" }, { alias: "plan-two" }]) });
    expect(unwrapErr(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() })).code).toBe(
      "ACCOUNT_CONFIG_INVALID",
    );
  });

  it("reads under the home it was given, never an ambient one", async () => {
    const dir = makeHome();
    writeLegacy({ dir, text: TWO_PLANS });
    const elsewhere = mkdtempSync(join(tmpdir(), "spawn-accounts-other-"));
    expect(unwrap(await readSpawnAccounts({ home: elsewhere, port: memoryPlanRegisterPort() }))).toBe(undefined);
    rmSync(elsewhere, { force: true, recursive: true });
  });
});

describe("a register failure reaches the caller in the rotation vocabulary, said once", () => {
  it("forwards an invalid register's PROBLEMS, so the two not-usable preambles do not nest", async () => {
    const dir = makeHome();
    writeLegacy({ dir, text: "{ truncated" });
    const error = unwrapErr(await readSpawnAccounts({ home: dir, port: memoryPlanRegisterPort() }));
    expect(error.message.startsWith("the configured Claude accounts are not usable: ")).toBe(true);
    expect(error.message).not.toContain("the plan register is not usable");
    expect(error.message).toContain("the Claude accounts file is not JSON");
  });

  it("names a store OUTAGE as an outage, never as an invalid configuration", async () => {
    // A register that cannot be reached says nothing about the plans in it, so relabelling it as invalid JSON
    // would send an operator to repair a file that is fine.
    const dir = makeHome();
    writeLegacy({ dir, text: TWO_PLANS });
    const error = unwrapErr(await readSpawnAccounts({ home: dir, port: unavailablePlanRegisterPort() }));
    expect(error.code).toBe("ACCOUNT_CONFIG_STORE_UNAVAILABLE");
    expect(error.message).toContain("ECONNREFUSED");
  });
});

describe("readSpawnAccounts reads the store's row once it holds one", () => {
  it("serves the second read from the row the first one imported, not from plans.json", async () => {
    const dir = makeHome();
    writeRegister({
      dir,
      rows: [
        { alias: "plan-one", provider: "claude", storeDir: "/stores/plan-one" },
        { alias: "plan-two", provider: "claude", storeDir: "/stores/plan-two" },
      ],
    });
    const port = memoryPlanRegisterPort();
    unwrap(await readSpawnAccounts({ home: dir, port }));
    writeRegister({ dir, rows: [{ alias: "stale-one", provider: "claude", storeDir: "/stale/one" }] });
    const accounts = unwrap(await readSpawnAccounts({ home: dir, port }))!;
    expect(accounts.map((account) => account.alias)).toStrictEqual(["plan-one", "plan-two"]);
  });
});

// `claude rotate` and `claude signin` read the file directly, so an emptied one has to refuse HERE
// too, now that no count rule refuses it by accident.
describe("readAccountsFile — the accounts file a verb reads without the register", () => {
  it("accepts one plan", () => {
    const dir = makeHome();
    writeLegacy({ dir, text: JSON.stringify([{ alias: "plan-one", storeDir: "/stores/plan-one" }]) });
    expect(unwrap(readAccountsFile({ home: dir })).map((account) => account.alias)).toStrictEqual(["plan-one"]);
  });

  it("refuses an emptied file by name, never as a valid zero-plan fleet", () => {
    const dir = makeHome();
    writeLegacy({ dir, text: "[]" });
    expect(unwrapErr(readAccountsFile({ home: dir }))).toStrictEqual(
      ClaudeRotationErrors.accountConfigInvalid({ problems: [EMPTIED_SOURCE_PROBLEM] }),
    );
  });

  it("refuses an absent file as the parser does, which is not the emptied refusal", () => {
    const error = unwrapErr(readAccountsFile({ home: makeHome() }));
    expect(error.code).toBe("ACCOUNT_CONFIG_INVALID");
    expect(error.message).toBe("the configured Claude accounts are not usable: the account list is not an array");
  });
});
