import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap } from "../../../lib/result.js";
import { cancelPlanConnection, readPlanConnections, startCodexConnect } from "../../../plans/connectCodex.js";
import type { CodexConnectDeps } from "../../../plans/connectCodexRecord.js";
import { runCodexConnectWorker } from "../../../plans/connectCodexWorker.js";
import { PlanConnectionErrors } from "../../../plans/connectionErrors.js";
import { connectionMarkerPaths, START_LOCK_STALE_MS, takeConnectionStartLock } from "../../../plans/connectionStore.js";
import { stateHomePaths } from "../../../stateHome.js";

import {
  ATTEMPT_ID,
  adopted,
  DEAD_PID,
  emptyJournal,
  fakeDeps,
  freshInstall,
  LIVE_PID,
  lockFiles,
  START_MS,
} from "./connectCodexFixtures.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "connect-codex-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("startCodexConnect", () => {
  it("writes a starting record on a fresh store of a fresh install and backgrounds the worker", async () => {
    const journal = emptyJournal();
    const deps = fakeDeps({ journal, register: freshInstall, signIn: () => ({ kind: "ran", lines: [] }) });
    const started = unwrap(await startCodexConnect({ deps, home }));
    expect(started).toEqual({
      alias: "codex-1",
      deadlineAtIso: "2026-11-07T10:12:01.000Z",
      host: "codex",
      id: ATTEMPT_ID,
      phase: "starting",
      startedAtIso: "2026-11-07T10:00:01.000Z",
      storeDir: join(home, "codex-accounts", "codex-1"),
      updatedAtIso: "2026-11-07T10:00:01.000Z",
    });
    expect(journal.launched).toEqual([ATTEMPT_ID]);
    expect(unwrap(readPlanConnections({ home, nowMs: START_MS + 5000 })).codex).toEqual(started);
  });

  it("refuses a second Connect while the first is still in flight", async () => {
    const deps = fakeDeps({
      journal: emptyJournal(),
      register: freshInstall,
      signIn: () => ({ kind: "ran", lines: [] }),
    });
    unwrap(await startCodexConnect({ deps, home }));
    const second = await startCodexConnect({ deps, home });
    expect(second._unsafeUnwrapErr().code).toBe("CONNECTION_IN_FLIGHT");
  });

  it("skips a store directory already standing and reserves the next alias rather than adopting it", async () => {
    const journal = emptyJournal();
    const deps = fakeDeps({
      journal,
      register: adopted,
      signIn: () => ({ kind: "ran", lines: [] }),
      standing: [join(home, "codex-accounts", "codex-1")],
    });
    const started = unwrap(await startCodexConnect({ deps, home }));
    expect([started.alias, journal.reserved]).toEqual(["codex-2", [join(home, "codex-accounts", "codex-2")]]);
  });

  it("removes the store it reserved and records EXITED when the worker cannot be launched", async () => {
    const journal = emptyJournal();
    const base = fakeDeps({ journal, register: adopted, signIn: () => ({ kind: "ran", lines: [] }) });
    const refused = PlanConnectionErrors.launchFailed({ cause: "spawn refused" });
    const deps: CodexConnectDeps = { ...base, launchWorker: () => err(refused) };
    const started = await startCodexConnect({ deps, home });
    const record = unwrap(readPlanConnections({ home, nowMs: START_MS })).codex!;
    expect([started._unsafeUnwrapErr().code, journal.removed, record.phase, record.failure]).toEqual([
      refused.code,
      [join(home, "codex-accounts", `codex-1.retired-${ATTEMPT_ID}`)],
      "failed",
      "EXITED",
    ]);
  });

  it("refuses a start while a live process holds the lock, and passes one whose holder has exited", async () => {
    const lockPath = join(stateHomePaths({ home }).live.planConnectionsDir, "codex.lock.1");
    const deps = (): CodexConnectDeps =>
      fakeDeps({ journal: emptyJournal(), register: freshInstall, signIn: () => ({ kind: "ran", lines: [] }) });
    mkdirSync(stateHomePaths({ home }).live.planConnectionsDir, { recursive: true });
    writeFileSync(lockPath, `${String(START_MS)} ${String(LIVE_PID)} other\n`);
    const held = await startCodexConnect({ deps: deps(), home });
    writeFileSync(lockPath, `${String(START_MS)} ${String(DEAD_PID)} other\n`);
    const abandoned = await startCodexConnect({ deps: deps(), home });
    expect([held._unsafeUnwrapErr().code, unwrap(abandoned).phase, lockFiles({ home })]).toEqual([
      "CONNECTION_STARTING",
      "starting",
      [],
    ]);
  });
});

describe("takeConnectionStartLock", () => {
  const take = ({ nowMs, pid, token }: { nowMs: number; pid: number; token: string }) =>
    takeConnectionStartLock({
      holderAlive: ({ pid: holder }) => holder === LIVE_PID,
      home,
      host: "codex",
      nowMs,
      pid,
      token,
    });

  it("never moves a live holder's lock, however old, short of the hung-holder age", () => {
    unwrap(take({ nowMs: START_MS, pid: LIVE_PID, token: "aaaa" }));
    const second = take({ nowMs: START_MS + START_LOCK_STALE_MS - 1, pid: LIVE_PID, token: "bbbb" });
    expect(second._unsafeUnwrapErr().code).toBe("CONNECTION_STARTING");
  });

  it("lets a holder whose lock was passed neither write nor free its successor's lock", () => {
    const first = unwrap(take({ nowMs: START_MS, pid: DEAD_PID, token: "aaaa" }));
    const second = unwrap(take({ nowMs: START_MS + 1, pid: LIVE_PID, token: "bbbb" }));
    const heldBefore = [first.stillHeld(), second.stillHeld()];
    first.release();
    const secondAfterFirstRelease = second.stillHeld();
    second.release();
    expect([heldBefore, secondAfterFirstRelease, lockFiles({ home })]).toEqual([[false, true], true, []]);
  });

  it("passes a hung live holder with a higher generation, leaving its file where it stood", () => {
    const first = unwrap(take({ nowMs: START_MS, pid: LIVE_PID, token: "aaaa" }));
    const second = unwrap(take({ nowMs: START_MS + START_LOCK_STALE_MS, pid: LIVE_PID, token: "bbbb" }));
    const bothStanding = lockFiles({ home });
    first.release();
    expect([first.stillHeld(), second.stillHeld(), bothStanding, lockFiles({ home })]).toEqual([
      false,
      true,
      ["codex.lock.1", "codex.lock.2"],
      ["codex.lock.2"],
    ]);
  });

  it("judges only the highest generation, refusing while a live one stands above a dead one", () => {
    unwrap(take({ nowMs: START_MS, pid: DEAD_PID, token: "aaaa" }));
    const dir = stateHomePaths({ home }).live.planConnectionsDir;
    writeFileSync(join(dir, "codex.lock.2"), `${String(START_MS)} ${String(LIVE_PID)} raced\n`);
    const late = take({ nowMs: START_MS + 1, pid: LIVE_PID, token: "bbbb" });
    expect([late._unsafeUnwrapErr().code, lockFiles({ home })]).toEqual([
      "CONNECTION_STARTING",
      ["codex.lock.1", "codex.lock.2"],
    ]);
  });

  it("writes no record, and removes the store it reserved, for a start whose lock was taken as hung", async () => {
    const journal = emptyJournal();
    const base = fakeDeps({
      journal,
      register: freshInstall,
      signIn: () => ({ kind: "ran", lines: [] }),
    });
    const deps: CodexConnectDeps = {
      ...base,
      readRegister: async () => {
        take({ nowMs: START_MS + 10 * START_LOCK_STALE_MS, pid: LIVE_PID, token: "ffff" });
        return ok(freshInstall);
      },
    };
    const started = await startCodexConnect({ deps, home });
    expect([
      started._unsafeUnwrapErr().code,
      unwrap(readPlanConnections({ home, nowMs: START_MS })).codex,
      journal.removed,
    ]).toEqual(["CONNECTION_STARTING", undefined, [join(home, "codex-accounts", `codex-1.retired-${ATTEMPT_ID}`)]]);
  });

  it("names the reserved store it could not remove when the start's record was never written", async () => {
    const store = join(home, "codex-accounts", "codex-1");
    const base = fakeDeps({
      journal: emptyJournal(),
      register: freshInstall,
      removeFails: "permission denied",
      signIn: () => ({ kind: "ran", lines: [] }),
    });
    const deps: CodexConnectDeps = {
      ...base,
      readRegister: async () => {
        take({ nowMs: START_MS + 10 * START_LOCK_STALE_MS, pid: LIVE_PID, token: "ffff" });
        return ok(freshInstall);
      },
    };
    const failure = (await startCodexConnect({ deps, home }))._unsafeUnwrapErr();
    expect([failure.code, failure.message]).toEqual([
      "CONNECTION_STORE_LEFT_BEHIND",
      `${PlanConnectionErrors.starting().message}; ${store} was left behind, and no plan names it: it was moved to ${store}.retired-${ATTEMPT_ID} and could not be removed there: permission denied`,
    ]);
  });
});

describe("cancelPlanConnection", () => {
  it("drops the cancel marker for an attempt in flight", async () => {
    const deps = fakeDeps({ journal: emptyJournal(), register: adopted, signIn: () => ({ kind: "ran", lines: [] }) });
    unwrap(await startCodexConnect({ deps, home }));
    const answered = unwrap(cancelPlanConnection({ home, id: ATTEMPT_ID, nowMs: START_MS + 5000 }));
    expect(answered.phase).toBe("starting");
    expect(existsSync(connectionMarkerPaths({ home, id: ATTEMPT_ID }).cancel)).toBe(true);
  });

  it("answers an attempt that already ended as it stands, dropping no marker", async () => {
    const deps = fakeDeps({
      journal: emptyJournal(),
      register: adopted,
      signIn: () => ({ kind: "ran", lines: ["!cancelled"] }),
    });
    unwrap(await startCodexConnect({ deps, home }));
    unwrap(await runCodexConnectWorker({ deps, home, id: ATTEMPT_ID }));
    const answered = unwrap(cancelPlanConnection({ home, id: ATTEMPT_ID, nowMs: START_MS + 9000 }));
    expect(answered.phase).toBe("cancelled");
    expect(existsSync(connectionMarkerPaths({ home, id: ATTEMPT_ID }).cancel)).toBe(false);
  });

  it("names an id no attempt carries", () => {
    expect(cancelPlanConnection({ home, id: "ffffffffffffffff", nowMs: START_MS })._unsafeUnwrapErr().code).toBe(
      "CONNECTION_NOT_FOUND",
    );
  });
});
