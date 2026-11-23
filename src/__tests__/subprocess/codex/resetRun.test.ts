/**
 * `slopweaver codex reset` end to end — the real verb, the real `tclsh` exchange and the real claims journal,
 * against a fake app-server, never a real Codex. The fake's behaviour is chosen by the store's own directory
 * name, and it appends every consume it receives to `consumed.jsonl` in that store so a test can count what
 * reached the "provider".
 *
 * The property that costs a real reset when broken is the retry: an exchange whose answer is lost must leave
 * an open intent, and the next run must send the SAME idempotency key rather than a fresh one.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCodexResetAtLimit } from "../../../cli/commands/codex/resetFleetRun.js";
import { type ResetOneDeps, resetOne } from "../../../cli/commands/codex/resetOne.js";
import { runCodexResetOver } from "../../../cli/commands/codex/resetRun.js";
import { sendAndSettle } from "../../../cli/commands/codex/resetSend.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { APP_SERVER_ENV, readCodexAccountsLive } from "../../../codex/accountLive.js";
import { RESET_RUN_BUDGET_MS, takeCodexResetLock } from "../../../codex/resetLock.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { memoryCodexSignInPort } from "../../codexSignInFixture.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../doorLedgerFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../planRegisterFixture.js";

/** The fake app-server: reads, and consumes, in the manner its store's directory name asks for. */
const FAKE_APP_SERVER = `#!/usr/bin/env node
const { basename, join } = require("node:path");
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const home = process.env.CODEX_HOME;
const statePath = join(home, "state.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const mode = state.mode || basename(home);
const say = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const full = mode !== "open" && mode !== "depleted";
const used = state.used === undefined ? (full ? 100 : 10) : state.used;
const resetsAt = state.resetsAt === undefined ? 4102444800 : state.resetsAt;
const codex = { limitId: "codex", primary: { resetsAt, usedPercent: used, windowDurationMins: 10080 }, secondary: null, rateLimitReachedType: mode === "depleted" ? "workspace_member_credits_depleted" : null };
const listed = [{ expiresAt: 4102444800, id: "credit-1", status: mode === "spent1" ? "redeemed" : "available" }, { expiresAt: 4000000000, id: "credit-2", status: "available" }];
const credits = mode === "none" ? { availableCount: 0, credits: [] } : { availableCount: 2, credits: listed };
let buffered = "";
process.stdin.on("data", (chunk) => {
  buffered += String(chunk);
  const lines = buffered.split("\\n");
  buffered = lines.pop();
  for (const line of lines) {
    if (line.trim() === "") continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") say({ id: message.id, result: { codexHome: home } });
    if (message.method === "account/rateLimits/read") say({ id: message.id, result: { accountId: state.accountId || "acct-" + basename(home), rateLimitResetCredits: credits, rateLimits: codex, rateLimitsByLimitId: { codex } } });
    if (message.method === "account/read") say({ id: message.id, result: { account: { email: mode + "@example.com", planType: "pro", type: "chatgpt" } } });
    if (message.method === "account/rateLimitResetCredit/consume") {
      appendFileSync(join(home, "consumed.jsonl"), JSON.stringify(message.params) + "\\n");
      if (mode === "lost") process.exit(0);
      if (mode === "nothing") {
        say({ id: message.id, result: { outcome: "nothingToReset" } });
        continue;
      }
      // A reset restarts the week: the window empties and reopens seven days on.
      writeFileSync(statePath, JSON.stringify({ ...state, mode: "open", resetsAt: resetsAt + 604800, used: 0 }));
      say({ id: message.id, result: { outcome: "reset" } });
    }
  }
});
`;

const NOW = "2026-09-29T09:00:00.000Z";

/** The Codex bars a register naming none decodes to — what every seeded register in this file holds. */
const THRESHOLDS = DEFAULT_THRESHOLDS.codex;

let root = "";
let home = "";
/** The register every run in one test reads — one in-memory store, so a seeded plan is still there next run. */
let port: PlanRegisterPort = memoryPlanRegisterPort();
let previousAppServer: string | undefined;
let previousEarly: string | undefined;
/** Whether this test has adopted the register yet — adoption happens once, before the first store is added. */
let adopted = false;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sw-reset-"));
  home = join(root, "home");
  mkdirSync(home, { recursive: true });
  port = memoryPlanRegisterPort();
  adopted = false;
  const fake = join(root, "fake-app-server.cjs");
  writeFileSync(fake, FAKE_APP_SERVER, "utf8");
  chmodSync(fake, 0o755);
  previousAppServer = process.env[APP_SERVER_ENV];
  process.env[APP_SERVER_ENV] = fake;
  previousEarly = process.env["SLOPWEAVER_ALLOW_EARLY_CODEX_RESET"];
  delete process.env["SLOPWEAVER_ALLOW_EARLY_CODEX_RESET"];
});

afterEach(() => {
  process.env[APP_SERVER_ENV] = previousAppServer;
  process.env["SLOPWEAVER_ALLOW_EARLY_CODEX_RESET"] = previousEarly;
  rmSync(root, { force: true, recursive: true });
});

/** Register one Codex plan whose store's directory name picks the fake's behaviour; returns the store. */
async function registerStore({ mode }: { mode: string }): Promise<string> {
  const storeDir = join(root, "stores", mode);
  mkdirSync(storeDir, { recursive: true });
  const add = {
    kind: "add",
    row: {
      alias: `plan-${mode}`,
      allowance: { kind: "weekly-window" },
      provider: "codex",
      storeDir,
      usageLimitPercent: 100,
    },
  } as const;
  const mutations = adopted ? [add] : [{ kind: "adopt" } as const, add];
  adopted = true;
  for (const mutation of mutations) {
    const written = await port.write({ home, mutation, nowIso: NOW });
    expect(written.isOk()).toBe(true);
  }
  return storeDir;
}

/** Change what one store's fake app-server answers from now on, by the mode name it would otherwise take from its directory. */
function answerAs({ mode, storeDir }: { mode: string; storeDir: string }): void {
  writeFileSync(join(storeDir, "state.json"), JSON.stringify({ mode }), "utf8");
}

/** Set everything one store's fake app-server answers from now on: its mode, fullness, window and account. */
function answerWith({ state, storeDir }: { state: Record<string, unknown>; storeDir: string }): void {
  writeFileSync(join(storeDir, "state.json"), JSON.stringify(state), "utf8");
}

/** The stores a run reaches, all in memory but the plan register this test seeds. */
function deps(): ResetOneDeps {
  return {
    doorLedger: memoryDoorLedger().port,
    fleetCap: memoryCodexFleetCapPort(),
    port,
    signInPort: memoryCodexSignInPort(),
  };
}

/** Run the verb as the router would, with argv's first four slots the node/cli/noun/verb prefix. */
async function reset({ args }: { args: readonly string[] }): Promise<number> {
  return runCodexResetOver({
    argv: ["node", "slopweaver", "codex", "reset", ...args, "--home", home],
    deps: deps(),
  });
}

/** Every consume the fake received, in order. */
function consumed({ storeDir }: { storeDir: string }): readonly Record<string, unknown>[] {
  const path = join(storeDir, "consumed.jsonl");
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The claims journal's rows, parsed. */
function journal(): readonly Record<string, unknown>[] {
  return readFileSync(stateHomePaths({ home }).codexResetClaimsJsonl, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("codex reset", () => {
  it("redeems a held reset on a store at its limit and journals intent then outcome under one key", async () => {
    const storeDir = await registerStore({ mode: "held" });

    expect(await reset({ args: ["--plan", "plan-held"] })).toBe(EXIT_OK);

    const sent = consumed({ storeDir });
    expect(sent.length).toBe(1);
    const rows = journal();
    expect(rows.map((row) => row["kind"])).toEqual(["intent", "outcome"]);
    expect(rows[0]!["idempotencyKey"]).toBe(sent[0]!["idempotencyKey"]);
    expect(rows[1]!["idempotencyKey"]).toBe(sent[0]!["idempotencyKey"]);
    expect(rows[1]!["outcome"]).toBe("reset");
  }, 30_000);

  it("re-sends the SAME key after an answer was lost, and settles that attempt", async () => {
    const storeDir = await registerStore({ mode: "lost" });

    expect(await reset({ args: ["--plan", "plan-lost"] })).toBe(EXIT_DEFERRED);
    expect(await reset({ args: ["--plan", "plan-lost"] })).toBe(EXIT_DEFERRED);

    const keys = consumed({ storeDir }).map((params) => params["idempotencyKey"]);
    expect(keys.length).toBe(2);
    expect(keys[1]).toBe(keys[0]);
    expect(journal().map((row) => row["kind"])).toEqual(["intent"]);
  }, 30_000);

  it("closes the lost attempt once the store is no longer at a limit, sending nothing, so the next cap mints a fresh key", async () => {
    const storeDir = await registerStore({ mode: "lost" });

    expect(await reset({ args: ["--plan", "plan-lost"] })).toBe(EXIT_DEFERRED);
    answerAs({ mode: "open", storeDir });
    expect(await reset({ args: ["--plan", "plan-lost"] })).toBe(EXIT_OK);
    expect(consumed({ storeDir }).length).toBe(1);
    answerAs({ mode: "held", storeDir });
    expect(await reset({ args: ["--plan", "plan-lost"] })).toBe(EXIT_OK);

    const keys = consumed({ storeDir }).map((params) => params["idempotencyKey"]);
    expect(keys.length).toBe(2);
    expect(keys[1]).not.toBe(keys[0]);
    expect(journal().map((row) => row["kind"])).toEqual(["intent", "closed", "intent", "outcome"]);
  }, 30_000);

  it("sends nothing in the run that closes an attempt, even with the early hatch set (case 1)", async () => {
    const storeDir = await registerStore({ mode: "lost" });
    process.env["SLOPWEAVER_ALLOW_EARLY_CODEX_RESET"] = "1";

    expect(await reset({ args: ["--plan", "plan-lost"] })).toBe(EXIT_DEFERRED);
    answerAs({ mode: "open", storeDir });
    expect(await reset({ args: ["--plan", "plan-lost"] })).toBe(EXIT_OK);

    expect(consumed({ storeDir }).length).toBe(1);
    expect(journal().map((row) => row["kind"])).toEqual(["intent", "closed"]);
  }, 30_000);

  it("sends nothing when an attempt's own credit reads spent while the store is still at a limit (case 2)", async () => {
    const storeDir = await registerStore({ mode: "lost" });

    expect(await reset({ args: ["--plan", "plan-lost", "--credit", "credit-1"] })).toBe(EXIT_DEFERRED);
    answerAs({ mode: "spent1", storeDir });
    expect(await reset({ args: ["--plan", "plan-lost"] })).toBe(EXIT_OK);

    expect(consumed({ storeDir }).length).toBe(1);
    expect(journal().map((row) => row["reason"])).toEqual([
      undefined,
      "the store no longer lists credit-1 as available",
    ]);
  }, 30_000);

  it("retries an open attempt with ITS credit, whatever --credit the retry names", async () => {
    const storeDir = await registerStore({ mode: "lost" });

    expect(await reset({ args: ["--plan", "plan-lost", "--credit", "credit-1"] })).toBe(EXIT_DEFERRED);
    expect(await reset({ args: ["--plan", "plan-lost", "--credit", "credit-2"] })).toBe(EXIT_DEFERRED);

    expect(consumed({ storeDir }).map((params) => params["creditId"])).toEqual(["credit-1", "credit-1"]);
  }, 30_000);

  it("refuses a store whose windows have room even though its credits read depleted, sending nothing", async () => {
    const storeDir = await registerStore({ mode: "depleted" });

    expect(await reset({ args: ["--plan", "plan-depleted"] })).toBe(EXIT_ERROR);

    expect(consumed({ storeDir })).toEqual([]);
  }, 30_000);

  it("refuses a store with room left, sending nothing and journalling nothing", async () => {
    const storeDir = await registerStore({ mode: "open" });

    expect(await reset({ args: ["--plan", "plan-open"] })).toBe(EXIT_ERROR);

    expect(consumed({ storeDir })).toEqual([]);
    expect(existsSync(stateHomePaths({ home }).codexResetClaimsJsonl)).toBe(false);
  }, 30_000);

  it("spends early only through the named hatch", async () => {
    const storeDir = await registerStore({ mode: "open" });
    process.env["SLOPWEAVER_ALLOW_EARLY_CODEX_RESET"] = "1";

    expect(await reset({ args: ["--plan", "plan-open", "--credit", "credit-1"] })).toBe(EXIT_OK);

    expect(consumed({ storeDir })[0]!["creditId"]).toBe("credit-1");
  }, 30_000);

  it("sends exactly the key and credit it is handed and journals only the outcome — the sender never mints one", async () => {
    const storeDir = await registerStore({ mode: "held" });

    const result = await sendAndSettle({
      attempt: { creditId: "credit-2", idempotencyKey: "k-handed" },
      fleetCap: memoryCodexFleetCapPort(),
      ledger: memoryDoorLedger().port,
      port,
      signInPort: memoryCodexSignInPort(),
      target: { alias: "plan-held", codexHome: storeDir, home, startedMs: Date.now(), thresholds: THRESHOLDS },
    });

    expect(result.kind).toBe("settled");
    expect(consumed({ storeDir })).toEqual([{ creditId: "credit-2", idempotencyKey: "k-handed" }]);
    expect(journal().map((row) => [row["kind"], row["idempotencyKey"]])).toEqual([["outcome", "k-handed"]]);
  }, 30_000);

  it("sends nothing and fails the claim when the store cannot record the door decision", async () => {
    const storeDir = await registerStore({ mode: "held" });

    const result = await sendAndSettle({
      attempt: { creditId: "credit-2", idempotencyKey: "k-unrecorded" },
      fleetCap: memoryCodexFleetCapPort(),
      ledger: unreachableDoorLedger(),
      port,
      signInPort: memoryCodexSignInPort(),
      target: { alias: "plan-held", codexHome: storeDir, home, startedMs: Date.now(), thresholds: THRESHOLDS },
    });

    expect(result.kind).toBe("failed");
    expect(consumed({ storeDir })).toEqual([]);
  }, 30_000);

  it("reports nothing to redeem on a store that holds no reset, sending nothing", async () => {
    const storeDir = await registerStore({ mode: "none" });

    expect(await reset({ args: ["--plan", "plan-none"] })).toBe(EXIT_EXPECTED_EMPTY);

    expect(consumed({ storeDir })).toEqual([]);
  }, 30_000);

  it("refuses with an operational error, sending nothing, when the register store cannot be read", async () => {
    const storeDir = await registerStore({ mode: "held" });
    port = unavailablePlanRegisterPort();

    expect(await reset({ args: ["--plan", "plan-held"] })).toBe(EXIT_ERROR);

    expect(consumed({ storeDir })).toEqual([]);
    expect(existsSync(stateHomePaths({ home }).codexResetClaimsJsonl)).toBe(false);
  }, 30_000);

  it("refuses an alias the register does not carry as a usage error, never the ambient home", async () => {
    await registerStore({ mode: "held" });

    expect(await reset({ args: ["--plan", "plan-elsewhere"] })).toBe(EXIT_USAGE);

    expect(existsSync(stateHomePaths({ home }).codexResetClaimsJsonl)).toBe(false);
  }, 30_000);

  it("claims at the 99% bar with the soonest-expiring reset, journalling the store before and after under one key", async () => {
    const storeDir = await registerStore({ mode: "held" });
    answerWith({ state: { mode: "held", used: 99 }, storeDir });

    expect(await reset({ args: ["--plan", "plan-held"] })).toBe(EXIT_OK);

    expect(consumed({ storeDir }).map((params) => params["creditId"])).toEqual(["credit-2"]);
    const [intent, outcome] = journal() as readonly Record<string, Record<string, unknown>>[];
    expect(intent!["idempotencyKey"]).toBe(outcome!["idempotencyKey"]);
    expect(intent!["before"]!["atLimit"]).toBe(true);
    expect(intent!["before"]!["windows"]).toEqual([
      {
        label: "weekly",
        limitId: "codex",
        resetAtIso: "2100-01-01T00:00:00.000Z",
        slot: "primary",
        usedPercent: 99,
        windowMinutes: 10080,
      },
    ]);
    expect(outcome!["after"]!["atLimit"]).toBe(false);
    expect(outcome!["after"]!["windows"]).toEqual([
      {
        label: "weekly",
        limitId: "codex",
        resetAtIso: "2100-01-08T00:00:00.000Z",
        slot: "primary",
        usedPercent: 0,
        windowMinutes: 10080,
      },
    ]);
  }, 30_000);

  it("--at-limit claims each store at its limit and leaves one below the bar alone", async () => {
    const held = await registerStore({ mode: "held" });
    const open = await registerStore({ mode: "open" });

    expect(await reset({ args: ["--at-limit"] })).toBe(EXIT_OK);

    expect(consumed({ storeDir: held }).length).toBe(1);
    expect(consumed({ storeDir: open })).toEqual([]);
  }, 30_000);

  it("--at-limit claims one account once, however many registered stores sign into it", async () => {
    const first = await registerStore({ mode: "shared-a" });
    const second = await registerStore({ mode: "shared-b" });
    answerWith({ state: { accountId: "acct-one", mode: "held" }, storeDir: first });
    answerWith({ state: { accountId: "acct-one", mode: "held" }, storeDir: second });

    expect(await reset({ args: ["--at-limit"] })).toBe(EXIT_OK);

    expect([consumed({ storeDir: first }).length, consumed({ storeDir: second }).length]).toEqual([1, 0]);
  }, 30_000);

  it("--at-limit fails the run when the provider answers nothingToReset, and journals that answer", async () => {
    await registerStore({ mode: "nothing" });

    expect(await reset({ args: ["--at-limit"] })).toBe(EXIT_ERROR);

    expect(journal().map((row) => [row["kind"], row["outcome"]])).toEqual([
      ["intent", undefined],
      ["outcome", "nothingToReset"],
    ]);
  }, 30_000);

  it("--at-limit with nothing at its limit sends nothing, journals nothing and exits 0", async () => {
    const open = await registerStore({ mode: "open" });

    expect(await runCodexResetAtLimit({ deps: deps(), home, startedMs: Date.now() })).toBe(EXIT_OK);

    expect(consumed({ storeDir: open })).toEqual([]);
    expect(existsSync(stateHomePaths({ home }).codexResetClaimsJsonl)).toBe(false);
  }, 30_000);

  it("--at-limit claims at the register's own pause bar — a store at 96% is left alone at 99 and claimed at 95", async () => {
    const storeDir = await registerStore({ mode: "held" });
    answerWith({ state: { mode: "held", used: 96 }, storeDir });

    expect(await runCodexResetAtLimit({ deps: deps(), home, startedMs: Date.now() })).toBe(EXIT_OK);
    expect(consumed({ storeDir })).toEqual([]);

    const lowered = await port.write({
      home,
      mutation: { change: { provider: "codex", reset: [], set: { pauseAtPercent: 95 } }, kind: "set-thresholds" },
      nowIso: NOW,
    });
    expect(lowered.isOk()).toBe(true);

    expect(await runCodexResetAtLimit({ deps: deps(), home, startedMs: Date.now() })).toBe(EXIT_OK);
    expect(consumed({ storeDir }).length).toBe(1);
  }, 30_000);

  it("defers and sends nothing while another reset run holds the lock", async () => {
    const storeDir = await registerStore({ mode: "held" });
    const lock = takeCodexResetLock({ home, nowIso: new Date().toISOString() });
    expect(lock.isOk()).toBe(true);

    expect(await reset({ args: ["--plan", "plan-held"] })).toBe(EXIT_DEFERRED);
    lock._unsafeUnwrap().release();

    expect(consumed({ storeDir })).toEqual([]);
  }, 30_000);

  it("refuses --at-limit beside --plan as a usage error", async () => {
    await registerStore({ mode: "held" });

    expect(await reset({ args: ["--at-limit", "--plan", "plan-held"] })).toBe(EXIT_USAGE);
  }, 30_000);

  it("refuses a store below its limit before any intent is journalled, so the claim never started", async () => {
    const codexHome = await registerStore({ mode: "open" });
    const [live] = readCodexAccountsLive({ codexHomes: [codexHome], readAtIso: new Date().toISOString() });

    const result = await resetOne({
      deps: deps(),
      live: live!,
      requestedCredit: undefined,
      target: { alias: "plan-open", codexHome, home, startedMs: Date.now(), thresholds: THRESHOLDS },
    });

    expect([result.kind, (result as { claimStarted: boolean }).claimStarted]).toEqual(["failed", false]);
    expect(existsSync(stateHomePaths({ home }).codexResetClaimsJsonl)).toBe(false);
  }, 30_000);

  it("defers a fresh claim once the run has spent its lock budget, minting no key and sending nothing", async () => {
    const storeDir = await registerStore({ mode: "held" });
    const [live] = readCodexAccountsLive({ codexHomes: [storeDir], readAtIso: new Date().toISOString() });

    const result = await resetOne({
      deps: deps(),
      live: live!,
      requestedCredit: undefined,
      target: {
        alias: "plan-held",
        codexHome: storeDir,
        home,
        startedMs: Date.now() - RESET_RUN_BUDGET_MS - 1000,
        thresholds: THRESHOLDS,
      },
    });

    expect(result.kind).toBe("deferred");
    expect(consumed({ storeDir })).toEqual([]);
    expect(existsSync(stateHomePaths({ home }).codexResetClaimsJsonl)).toBe(false);
  }, 30_000);

  it("--plan defers and sends nothing while another plan's attempt is open — it may be the same account", async () => {
    await registerStore({ mode: "lost" });
    const held = await registerStore({ mode: "held" });
    expect(await reset({ args: ["--plan", "plan-lost"] })).toBe(EXIT_DEFERRED);

    expect(await reset({ args: ["--plan", "plan-held"] })).toBe(EXIT_DEFERRED);

    expect(consumed({ storeDir: held })).toEqual([]);
  }, 30_000);

  it("--at-limit sends no later fresh claim once an earlier claim in the same run lost its answer", async () => {
    const lost = await registerStore({ mode: "lost" });
    const held = await registerStore({ mode: "held" });

    expect(await reset({ args: ["--at-limit"] })).toBe(EXIT_DEFERRED);

    expect([consumed({ storeDir: lost }).length, consumed({ storeDir: held }).length]).toEqual([1, 0]);
  }, 30_000);
});
