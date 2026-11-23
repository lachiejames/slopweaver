/**
 * The connection store's file edge over a real temp home: a record that cannot be read, a sign-in page folded in from
 * the file beside it, a home whose directory cannot be made, and the start lock's generations — a takeover of a dead
 * holder, a stamp that does not parse, and the sweep of generations whose process has exited.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { cancelPlanConnection, readPlanConnections } from "../../../plans/connectCodex.js";
import type { PlanConnection } from "../../../plans/connection.js";
import {
  clearConnectionMarkers,
  connectionMarkerPaths,
  readPlanConnection,
  requestConnectionCancel,
  takeConnectionStartLock,
  writePlanConnection,
} from "../../../plans/connectionStore.js";
import { stateHomePaths } from "../../../stateHome.js";

const NOW_MS = Date.parse("2026-11-07T10:05:00.000Z");
const ID = "0123abcd4567ef89";
const LIVE_PID = 4242;
const DEAD_PID = 7;

/** An attempt waiting on the browser, as the worker writes one. */
const browserAttempt: PlanConnection = {
  alias: "codex-1",
  deadlineAtIso: "2026-11-07T10:12:00.000Z",
  host: "codex",
  id: ID,
  phase: "browser",
  startedAtIso: "2026-11-07T10:00:00.000Z",
  storeDir: "/acme/home/codex-accounts/codex-1",
  updatedAtIso: "2026-11-07T10:00:02.000Z",
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "connection-store-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The provider's connections directory under the test's home. */
const dirOf = (): string => stateHomePaths({ home }).live.planConnectionsDir;

/** Take the codex start lock as one holder. */
const take = ({ pid, token }: { pid: number; token: string }): ReturnType<typeof takeConnectionStartLock> =>
  takeConnectionStartLock({
    holderAlive: ({ pid: held }) => held === LIVE_PID,
    home,
    host: "codex",
    nowMs: NOW_MS,
    pid,
    token,
  });

describe("readPlanConnection", () => {
  it("reads no attempt where no record stands", () => {
    expect(unwrap(readPlanConnection({ home, host: "codex" }))).toBe(undefined);
  });

  it("reports a record that is not JSON as unreadable, naming its path", () => {
    mkdirSync(dirOf(), { recursive: true });
    writeFileSync(join(dirOf(), "codex.json"), "{ not json");

    const failure = unwrapErr(readPlanConnection({ home, host: "codex" }));
    expect(failure.code).toBe("CONNECTION_UNREADABLE");
    expect(failure.message).toContain(join(dirOf(), "codex.json"));
  });

  it("fails the whole list, and a Cancel, on one unreadable record rather than reading it as no attempt", () => {
    mkdirSync(dirOf(), { recursive: true });
    writeFileSync(join(dirOf(), "codex.json"), "{ not json");

    expect(unwrapErr(readPlanConnections({ home, nowMs: NOW_MS })).code).toBe("CONNECTION_UNREADABLE");
    expect(unwrapErr(cancelPlanConnection({ home, id: ID, nowMs: NOW_MS })).code).toBe("CONNECTION_UNREADABLE");
  });

  it("reads a record this version does not know as no attempt", () => {
    mkdirSync(dirOf(), { recursive: true });
    writeFileSync(join(dirOf(), "codex.json"), JSON.stringify({ version: 99 }));

    expect(unwrap(readPlanConnection({ home, host: "codex" }))).toBe(undefined);
  });

  it("folds in the sign-in page the program wrote beside a browser attempt, and ignores an empty one", () => {
    unwrap(writePlanConnection({ connection: browserAttempt, home }));
    const urlPath = connectionMarkerPaths({ home, id: ID }).signInUrl;

    expect(unwrap(readPlanConnection({ home, host: "codex" }))!.signInUrl).toBe(undefined);
    writeFileSync(urlPath, "  \n");
    expect(unwrap(readPlanConnection({ home, host: "codex" }))!.signInUrl).toBe(undefined);
    writeFileSync(urlPath, "https://auth.openai.com/oauth/authorize?state=x\n");
    expect(unwrap(readPlanConnection({ home, host: "codex" }))!.signInUrl).toBe(
      "https://auth.openai.com/oauth/authorize?state=x",
    );
  });
});

describe("the store's writes over a home whose directory cannot be made", () => {
  beforeEach(() => {
    // A file where the connections directory belongs, so nothing under it can be created.
    mkdirSync(join(dirOf(), ".."), { recursive: true });
    writeFileSync(dirOf(), "not a directory");
  });

  it("reports the record as unwritable", () => {
    expect(unwrapErr(writePlanConnection({ connection: browserAttempt, home })).code).toBe("CONNECTION_UNWRITABLE");
  });

  it("reports the cancel marker as unwritable", () => {
    expect(unwrapErr(requestConnectionCancel({ home, id: ID })).code).toBe("CONNECTION_UNWRITABLE");
  });

  it("reports the start lock as unwritable, naming the directory", () => {
    const failure = unwrapErr(take({ pid: LIVE_PID, token: "a" }));
    expect(failure.code).toBe("CONNECTION_UNWRITABLE");
    expect(failure.message).toContain(dirOf());
  });
});

describe("takeConnectionStartLock", () => {
  it("refuses a second taker while a live holder stands, then takes the lock once it is released", () => {
    const first = unwrap(take({ pid: LIVE_PID, token: "a" }));

    expect(unwrapErr(take({ pid: LIVE_PID, token: "b" })).code).toBe("CONNECTION_STARTING");
    first.release();
    const second = unwrap(take({ pid: LIVE_PID, token: "b" }));
    expect(second.stillHeld()).toBe(true);
  });

  it("passes a dead holder by the next generation, which the first then reads as no longer held", () => {
    const dead = unwrap(take({ pid: DEAD_PID, token: "a" }));
    const live = unwrap(take({ pid: LIVE_PID, token: "b" }));

    expect([dead.stillHeld(), live.stillHeld()]).toEqual([false, true]);
    // The dead holder's generation is swept by the taker, since nothing can still act on it.
    expect(
      readdirSync(dirOf())
        .filter((name) => name.includes(".lock."))
        .toSorted(),
    ).toEqual(["codex.lock.2"]);
  });

  it("passes a stamp that does not parse, and sweeps it", () => {
    mkdirSync(dirOf(), { recursive: true });
    writeFileSync(join(dirOf(), "codex.lock.1"), "garbage");

    const held = unwrap(take({ pid: LIVE_PID, token: "a" }));
    expect(held.stillHeld()).toBe(true);
    expect(existsSync(join(dirOf(), "codex.lock.1"))).toBe(false);
  });
});

describe("clearConnectionMarkers", () => {
  it("removes an ended attempt's cancel marker and sign-in page, and is quiet when neither stands", () => {
    unwrap(requestConnectionCancel({ home, id: ID }));
    const paths = connectionMarkerPaths({ home, id: ID });
    writeFileSync(paths.signInUrl, "https://auth.openai.com/oauth/authorize\n");

    clearConnectionMarkers({ home, id: ID });
    clearConnectionMarkers({ home, id: ID });

    expect([existsSync(paths.cancel), existsSync(paths.signInUrl)]).toEqual([false, false]);
  });
});
