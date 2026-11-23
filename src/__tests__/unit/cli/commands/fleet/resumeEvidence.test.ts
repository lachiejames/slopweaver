/**
 * What the recovery pass reads off the machine about a seat: the plan register and each plan's cached email, a
 * session id that no live process carries, and the sign-in guard laid over the reseat routing gate.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../../../claude/contracts.js";
import { ACCOUNTS_PATH } from "../../../../../claude/spawnAccounts.js";
import {
  accountNames,
  accountsOf,
  bootAliasOf,
  chairReoriented,
  guardedDeps,
  liveRecordFor,
} from "../../../../../cli/commands/fleet/resumeEvidence.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { ReseatPlan } from "../../../../../sessions/reseat.js";
import { ReseatErrors } from "../../../../../sessions/reseatErrors.js";
import { memoryFleetPort, unavailableFleetPort } from "../../../../fleetStoreFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";
import { fakeClient, fakeDeps, makeHome, workspace } from "./fleetKit.js";

/** A session id no live process on any machine carries. */
const UNUSED_SESSION = "00000000-0000-4000-8000-00000000dead";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write the Claude accounts file the register reads when nothing is adopted. */
function writeAccounts({ rows }: { rows: readonly Readonly<Record<string, unknown>>[] }): void {
  mkdirSync(join(home, "claude-accounts"), { recursive: true });
  writeFileSync(join(home, ACCOUNTS_PATH), JSON.stringify(rows));
}

/** A relaunch plan in one workspace; only its workspace id matters to the guard. */
function planIn({ workspaceId }: { workspaceId: string }): ReseatPlan {
  return {
    chair: false,
    cwd: "/w",
    effort: undefined,
    envPrefix: "",
    launch: { kind: "resume", sessionId: UNUSED_SESSION },
    model: "opus",
    modelSource: "argv",
    pluginDir: undefined,
    prior: { kind: "live", pid: 1 },
    sessionId: UNUSED_SESSION,
    templateSuffix: "",
    workspace: workspace({ id: workspaceId }),
  };
}

describe("accountsOf", () => {
  it("is empty when no plan register exists, so a pass relaunches on spawn's own rules", async () => {
    expect(unwrap(await accountsOf({ home, port: memoryPlanRegisterPort() }))).toEqual([]);
  });

  it("lists the configured plans in order", async () => {
    writeAccounts({
      rows: [
        { alias: "plan-one", storeDir: "/stores/one" },
        { alias: "plan-two", storeDir: "/stores/two" },
      ],
    });
    const accounts = unwrap(await accountsOf({ home, port: memoryPlanRegisterPort() }));
    expect(accounts.map((account) => account.alias)).toEqual(["plan-one", "plan-two"]);
  });

  it("reads a one-plan register as the whole fleet", async () => {
    writeAccounts({ rows: [{ alias: "only-one", storeDir: "/stores/one" }] });
    const accounts = unwrap(await accountsOf({ home, port: memoryPlanRegisterPort() }));
    expect(accounts.map((account) => account.alias)).toEqual(["only-one"]);
  });

  it("refuses a register that is present and unusable, rather than reading it as no plans", async () => {
    writeAccounts({ rows: [{ alias: "UPPER", storeDir: "/stores/one" }] });
    const error = unwrapErr(await accountsOf({ home, port: memoryPlanRegisterPort() }));
    expect(error.code).toBe("ACCOUNT_CONFIG_INVALID");
  });

  it("refuses a register whose store is unreachable, rather than reading it as no plans", async () => {
    writeAccounts({
      rows: [
        { alias: "plan-one", storeDir: "/stores/one" },
        { alias: "plan-two", storeDir: "/stores/two" },
      ],
    });
    const error = unwrapErr(await accountsOf({ home, port: unavailablePlanRegisterPort() }));
    expect(error.code).toBe("ACCOUNT_CONFIG_STORE_UNAVAILABLE");
  });
});

describe("accountNames", () => {
  const accounts: readonly ClaudeAccount[] = [
    { alias: "plan-one", email: "one@example.com", storeDir: "/stores/one" },
    { alias: "plan-two", storeDir: "/stores/two" },
  ];

  it("answers a plan's cached email, and nothing for a plan with none", () => {
    const names = accountNames({ accounts, home });
    expect(names.emailFor({ alias: "plan-one" })).toBe("one@example.com");
    expect(names.emailFor({ alias: "plan-two" })).toBeUndefined();
  });

  it("answers nothing for a plan the register does not hold", () => {
    expect(accountNames({ accounts, home }).emailFor({ alias: "plan-nine" })).toBeUndefined();
  });
});

describe("live session reads", () => {
  it("finds no live record for a session id no process carries", () => {
    expect(liveRecordFor({ sessionId: UNUSED_SESSION })).toBeUndefined();
  });

  it("reads no boot plan for a session that is not live", () => {
    const accounts: readonly ClaudeAccount[] = [{ alias: "plan-one", storeDir: "/stores/one" }];
    expect(bootAliasOf({ accounts, sessionId: UNUSED_SESSION })).toBeUndefined();
  });

  it("reads a chair with no live process as not reoriented, whatever the journal says", async () => {
    const fleet = memoryFleetPort();
    unwrap(
      await fleet.appendResumeEvent({
        event: {
          atIso: "2026-10-04T05:01:00.000Z",
          attemptId: "att",
          chairSessionId: UNUSED_SESSION,
          kind: "chair-reoriented",
          schemaVersion: 1,
        },
        home,
      }),
    );
    expect(await chairReoriented({ fleet, home, sessionId: UNUSED_SESSION })).toBe(false);
  });

  it("reads a chair as not reoriented when the store cannot be reached", async () => {
    expect(await chairReoriented({ fleet: unavailableFleetPort(), home, sessionId: UNUSED_SESSION })).toBe(false);
  });
});

describe("guardedDeps", () => {
  const signedOutDir = "/stores/definitely-not-in-the-keychain-fleet-test";
  const accounts: readonly ClaudeAccount[] = [
    { alias: "plan-one", storeDir: signedOutDir },
    { alias: "plan-two", storeDir: "/stores/two" },
  ];

  it("refuses a routed store with no setup token whose own login is signed out, naming the plan", async () => {
    const signedOut = new Map<string, string>();
    const base = fakeDeps({ client: fakeClient({}), ownWorkspaceId: undefined });
    const guarded = guardedDeps({
      accounts,
      base: { ...base, routeCredential: () => Promise.resolve(ok({ storeDir: signedOutDir })) },
      signedOut,
    });
    const routed = await guarded.routeCredential({ plan: planIn({ workspaceId: "w1" }) });
    const error = unwrapErr(routed);
    expect(error.code).toBe("STORE_REFUSED");
    expect(error.message).toBe(
      "plan-one has no setup token and its own login is signed out, so a relaunch on it would wall again — nothing was stopped",
    );
    expect([...signedOut]).toEqual([["w1", "plan-one"]]);
  });

  it("passes a token-routed credential through untouched", async () => {
    const signedOut = new Map<string, string>();
    const base = fakeDeps({ client: fakeClient({}), ownWorkspaceId: undefined });
    const guarded = guardedDeps({
      accounts,
      base: { ...base, routeCredential: () => Promise.resolve(ok({ tokenPath: "/t/token" })) },
      signedOut,
    });
    const routed = await guarded.routeCredential({ plan: planIn({ workspaceId: "w1" }) });
    expect(unwrap(routed)).toEqual({ tokenPath: "/t/token" });
    expect(signedOut.size).toBe(0);
  });

  it("passes a routing refusal that is not the unreadable-plan wall through untouched", async () => {
    const signedOut = new Map<string, string>();
    const refusal = ReseatErrors.storeRefused({ reason: "spent", refusalKind: "spent-plan" });
    const base = fakeDeps({ client: fakeClient({}), ownWorkspaceId: undefined });
    const guarded = guardedDeps({
      accounts,
      base: { ...base, routeCredential: () => Promise.resolve(err(refusal)) },
      signedOut,
    });
    const routed = await guarded.routeCredential({ plan: planIn({ workspaceId: "w1" }) });
    expect(unwrapErr(routed)).toBe(refusal);
    expect(signedOut.size).toBe(0);
  });

  it("keeps every other dep the base carried", () => {
    const base = fakeDeps({ client: fakeClient({}), ownWorkspaceId: "own" });
    const guarded = guardedDeps({ accounts, base, signedOut: new Map() });
    expect(guarded.ownWorkspaceId).toBe("own");
    expect(guarded.confirmPolls).toBe(1);
  });
});
