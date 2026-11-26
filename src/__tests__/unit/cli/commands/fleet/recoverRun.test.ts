/**
 * `fleet recover` through its body (`fleetRecover`) over a real throwaway home — its lock and scratch are real — and a
 * scripted app, so what is under test is the flag handling, the lock and the exit code each result reads as.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type FleetRecoverDeps, fleetRecover } from "../../../../../cli/commands/fleet/recoverRun.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { acquireFleetRecoverLock } from "../../../../../fleet/locks.js";
import type { RecoveryChairReading } from "../../../../../fleet/recoveryChair.js";
import type { RecoveryEvidence } from "../../../../../fleet/recoveryCheck.js";
import type { RecoveryHost } from "../../../../../fleet/recoveryPassDeps.js";
import { recoveryScratchRoot } from "../../../../../fleet/recoveryScratch.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import type { AppSessionSnapshot } from "../../../../../sessionHarness/appProtocol.js";
import { makeHome } from "./fleetKit.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The argv the verb receives. */
function argvOf({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "fleet", "recover", ...rest];
}

/** An app whose every session answers its challenge at once, or one that cannot be reached at all. */
function answeringHost({ reachable, opened }: { reachable: boolean; opened: string[] }): RecoveryHost {
  const sessions: AppSessionSnapshot[] = [];
  return {
    close: async ({ session }) => {
      const index = sessions.findIndex((snapshot) => snapshot.sessionId === session.sessionId);
      sessions[index] = { ...sessions[index]!, state: "closed" };
      return ok(undefined);
    },
    leftOpen: () => ok([]),
    list: async () => {
      if (!reachable) {
        return err("the desktop app is not running");
      }
      return ok([...sessions]);
    },
    open: async ({ candidate, directory, ledgerKey, openedAtIso, prompt }) => {
      opened.push(directory);
      const sessionId = `s-${String(opened.length)}`;
      const answer = [...prompt.matchAll(/\[([0-9a-f]+)\]/gu)].map((match) => match[1]!).join("");
      sessions.push({
        directory,
        handle: `app:${sessionId}`,
        lastAgentText: answer,
        lastSubmittedText: prompt,
        ledgerKey,
        openedAtIso,
        sessionId,
        state: "idle",
        title: "Recovery check",
        vendor: candidate.vendor,
      });
      return ok({ handle: `app:${sessionId}`, sessionId });
    },
  };
}

/** Evidence offering one plan per vendor, or none for Codex. */
function evidenceOf({ codexPlans }: { codexPlans: boolean }): FleetRecoverDeps["evidence"] {
  return async ({ vendor }): Promise<RecoveryEvidence> => {
    if (vendor === "claude") {
      return { candidates: [{ alias: "claude-1", storeDir: "/s/one", vendor }], excluded: [], vendor };
    }
    if (!codexPlans) {
      return { candidates: [], excluded: [], vendor };
    }
    return { candidates: [{ alias: "codex-1", codexHome: "/c/one", vendor }], excluded: [], vendor };
  };
}

/** A chair read as `reading` that is never opened: these cases leave a down chair's restart to the pass's own tests. */
function chairReadAs({ reading }: { reading: RecoveryChairReading }): FleetRecoverDeps["chair"] {
  return () => ({
    open: async () => err({ reason: "these cases open no chair" }),
    pin: () => ({ kind: "none" }),
    read: async () => reading,
    retire: () => ok(undefined),
  });
}

/** The verb's deps over the scripted app, recording every directory a session opened in. */
function depsOf({
  chair = { kind: "live", label: "app:the-chair" },
  codexPlans = true,
  opened,
  reachable = true,
}: {
  chair?: RecoveryChairReading;
  codexPlans?: boolean;
  opened: string[];
  reachable?: boolean;
}): FleetRecoverDeps {
  let ms = Date.parse("2026-11-25T10:00:00.000Z");
  return {
    chair: chairReadAs({ reading: chair }),
    evidence: evidenceOf({ codexPlans }),
    host: () => answeringHost({ opened, reachable }),
    nowMs: () => ms,
    pause: async () => {
      ms += 1000;
    },
    randomBytes: (size) => Buffer.alloc(size, opened.length + 1),
    runId: () => "run",
  };
}

describe("fleetRecover", () => {
  it("answers 0 when both vendors answered, each inside this home's scratch, which is left empty and unlocked", async () => {
    const opened: string[] = [];
    const code = await fleetRecover({ argv: argvOf({ rest: ["--home", home] }), deps: depsOf({ opened }) });
    const root = recoveryScratchRoot({ home });
    expect(code).toBe(EXIT_OK);
    expect(opened).toEqual([`${root}/run-1/fleet-recovery`, `${root}/run-2/fleet-recovery`]);
    expect(readdirSync(root)).toEqual([]);
    unwrap(acquireFleetRecoverLock({ home, nowIso: "2026-11-25T10:10:00.000Z" })).release();
  });

  it("answers 3 when one vendor did not start", async () => {
    const opened: string[] = [];
    const code = await fleetRecover({
      argv: argvOf({ rest: ["--home", home] }),
      deps: depsOf({ codexPlans: false, opened }),
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(opened.length).toBe(1);
  });

  it("answers 3 when both vendors answered but a supervisor it could not read was not restarted", async () => {
    const opened: string[] = [];
    const chair: RecoveryChairReading = { kind: "unknown", why: "the supervisor pin could not be read" };
    const code = await fleetRecover({ argv: argvOf({ rest: ["--home", home] }), deps: depsOf({ chair, opened }) });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(opened.length).toBe(2);
  });

  it("answers 1 when the app cannot be reached, opening nothing", async () => {
    const opened: string[] = [];
    const code = await fleetRecover({
      argv: argvOf({ rest: ["--home", home] }),
      deps: depsOf({ opened, reachable: false }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(opened).toEqual([]);
  });

  it("answers 4 and opens nothing while another check holds the lock", async () => {
    const held = unwrap(acquireFleetRecoverLock({ home, nowIso: "2026-11-25T09:59:00.000Z" }));
    const opened: string[] = [];
    const code = await fleetRecover({ argv: argvOf({ rest: ["--home", home] }), deps: depsOf({ opened }) });
    held.release();
    expect(code).toBe(EXIT_DEFERRED);
    expect(opened).toEqual([]);
  });

  it("answers help with 0 and touches nothing under the home", async () => {
    const opened: string[] = [];
    const code = await fleetRecover({ argv: argvOf({ rest: ["--help"] }), deps: depsOf({ opened }) });
    expect(code).toBe(EXIT_OK);
    expect(existsSync(recoveryScratchRoot({ home }))).toBe(false);
  });

  it("refuses a positional argument and an unknown flag as usage errors", async () => {
    const opened: string[] = [];
    const deps = depsOf({ opened });
    expect(await fleetRecover({ argv: argvOf({ rest: ["--home", home, "now"] }), deps })).toBe(EXIT_USAGE);
    expect(await fleetRecover({ argv: argvOf({ rest: ["--home", home, "--json"] }), deps })).toBe(EXIT_USAGE);
    expect(opened).toEqual([]);
  });
});
