import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { maybeWarnStaleSeat, type SeatDrift } from "../../../cli/staleSeatEffects.js";
import { type StaleSeatNoticesPort, staleSeatNoticesPort } from "../../../cli/staleSeatNotices.js";
import { stateHomePaths } from "../../../stateHome.js";
import { FIXTURE_OUTAGE_REASON, memorySingletonStore } from "../../singletonRegisterFixture.js";
import { memoryStaleSeatNoticesPort, unavailableStaleSeatNoticesPort } from "../../staleSeatNoticesFixture.js";

/*
 * The shell's own composition, driven through the real verb-tree discovery and the real once-per-session
 * record — the store's row over an in-memory store. `measureDrift` is the injected seam — a plain fake function, not a mock — because the alternative
 * is a test that only passes on a checkout that happens to sit behind its trunk with the right files
 * changed. `handover` is the noun throughout: `verbModuleTrees` always carries the noun's OWN command
 * directory as its first tree, so `src/cli/commands/handover/...` overlaps no matter what that directory's
 * imports look like on the day the test runs.
 */

const homes: string[] = [];

/** A throwaway state home; the retired marker file, when a case seeds one, lives directly under it. */
function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "stale-seat-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A drift that states itself, standing in for the git measurement. */
function statedDrift({ behind, changedPaths }: { behind: number; changedPaths: readonly string[] }) {
  return (): SeatDrift => ({ behind, changedPaths, upstreamRef: "origin/main" });
}

/** One invocation on a seat three commits behind with no overlap — the once-per-session cadence. */
async function noOverlapNotice({
  home,
  notices,
  sessionId,
  sink,
}: {
  home: string;
  notices: StaleSeatNoticesPort;
  sessionId: string;
  sink: string[];
}): Promise<void> {
  await maybeWarnStaleSeat({
    home,
    measureDrift: statedDrift({ behind: 3, changedPaths: [] }),
    notices,
    noun: "handover",
    nowMs: 1_000,
    sessionId,
    verb: "register",
    writeLine: (line) => sink.push(line),
  });
}

describe("maybeWarnStaleSeat", () => {
  test("says nothing at all when the seat is level with its trunk", async () => {
    const lines: string[] = [];
    await maybeWarnStaleSeat({
      home: newHome(),
      notices: memoryStaleSeatNoticesPort(),
      measureDrift: statedDrift({ behind: 0, changedPaths: [] }),
      noun: "handover",
      nowMs: 1_000,
      sessionId: "session-a",
      verb: "register",
      writeLine: (line) => lines.push(line),
    });
    expect(lines).toEqual([]);
  });

  test("names the overlapping paths, every invocation, with no session id needed", async () => {
    const lines: string[] = [];
    await maybeWarnStaleSeat({
      home: newHome(),
      notices: memoryStaleSeatNoticesPort(),
      measureDrift: statedDrift({
        behind: 12,
        changedPaths: ["src/cli/commands/handover/askRowRun.ts", "src/cli/commands/handover/lintRun.ts"],
      }),
      noun: "handover",
      nowMs: 1_000,
      sessionId: undefined,
      verb: "register",
      writeLine: (line) => lines.push(line),
    });
    expect(lines[0]).toBe("slopweaver handover register: this seat is 12 commit(s) behind origin/main");
    expect(lines[1]).toBe("  and it changed 2 path(s) inside the tree(s) this verb reads:");
    expect(lines[2]).toBe("    src/cli/commands/handover/askRowRun.ts");
    expect(lines[3]).toBe("    src/cli/commands/handover/lintRun.ts");
    expect(lines[4]).toBe(
      "  the verdict below is computed by code that has been superseded — confirm it against the trunk before acting on it",
    );
  });

  test("a no-overlap notice is printed once per session and then recorded in the store's row", async () => {
    const home = newHome();
    const store = memorySingletonStore();
    const notices = memoryStaleSeatNoticesPort({ store });
    const first: string[] = [];
    const second: string[] = [];
    const call = async ({ sink }: { sink: string[] }): Promise<void> => {
      await noOverlapNotice({ home, notices, sessionId: "session-b", sink });
    };
    await call({ sink: first });
    await call({ sink: second });
    expect(first[0]).toBe("slopweaver handover register: this seat is 3 commit(s) behind origin/main");
    // The tree COUNT is whatever the handover command directory imports today, so the fragment is the
    // assertion and the depth-one caveat below it — which never varies — is the exact one.
    expect(first[1]).toContain("tree(s) this verb reads changed upstream — but that is a LOWER BOUND:");
    expect(first[2]).toBe(
      "  the check is depth-one, so a fix in a module this verb reaches only transitively is invisible to it",
    );
    expect(second).toEqual([]);
    expect(store.rows.get(home)).toEqual({
      document: { noticedSessions: ["session-b"], schemaVersion: 1 },
      revision: 1,
    });
    expect(existsSync(stateHomePaths({ home }).staleSeatNoticesJson)).toBe(false);
  });

  test("a session the retired file already recorded is imported once and not shown the notice again", async () => {
    const home = newHome();
    writeFileSync(
      stateHomePaths({ home }).staleSeatNoticesJson,
      JSON.stringify({ "session-x": ["stale-seat"], "session-y": ["handover-skill"] }),
    );
    const store = memorySingletonStore();
    const lines: string[] = [];
    await noOverlapNotice({
      home,
      notices: memoryStaleSeatNoticesPort({ store }),
      sessionId: "session-x",
      sink: lines,
    });
    expect(lines).toEqual([]);
    expect(store.rows.get(home)).toEqual({
      document: { noticedSessions: ["session-x"], schemaVersion: 1 },
      revision: 1,
    });
  });

  test("a store that cannot be reached still prints the notice, and says it was not recorded", async () => {
    const lines: string[] = [];
    await noOverlapNotice({
      home: newHome(),
      notices: unavailableStaleSeatNoticesPort(),
      sessionId: "session-d",
      sink: lines,
    });
    expect(lines[0]).toBe("slopweaver handover register: this seat is 3 commit(s) behind origin/main");
    expect(lines.at(-1)!).toContain("  (not recorded as shown, so it may repeat this session: ");
    expect(lines.at(-1)!).toContain(FIXTURE_OUTAGE_REASON);
  });

  test("a store module that fails to load is a refusal beside the notice, never a failed verb", async () => {
    const lines: string[] = [];
    const notices = staleSeatNoticesPort({ load: () => Promise.reject(new Error("store module failed to load")) });
    await noOverlapNotice({ home: newHome(), notices, sessionId: "session-f", sink: lines });
    expect(lines[0]).toBe("slopweaver handover register: this seat is 3 commit(s) behind origin/main");
    expect(lines.at(-1)!).toContain("  (not recorded as shown, so it may repeat this session: ");
    expect(lines.at(-1)!).toContain("store module failed to load");
  });

  test("an operation that throws is a refusal beside the notice, never a failed verb", async () => {
    const lines: string[] = [];
    const throwing: StaleSeatNoticesPort = {
      read: () => Promise.reject(new Error("driver threw mid-read")),
      replace: () => Promise.reject(new Error("driver threw mid-write")),
    };
    const notices = staleSeatNoticesPort({ load: () => Promise.resolve(throwing) });
    await noOverlapNotice({ home: newHome(), notices, sessionId: "session-g", sink: lines });
    expect(lines.at(-1)!).toContain("driver threw mid-read");
  });

  test("a port handed in that rejects outright still costs one notice, never the verb", async () => {
    const lines: string[] = [];
    const rejecting: StaleSeatNoticesPort = {
      read: () => Promise.reject(new Error("driver failed")),
      replace: () => Promise.reject(new Error("driver failed")),
    };
    await noOverlapNotice({ home: newHome(), notices: rejecting, sessionId: "session-x", sink: lines });
    expect(lines[0]).toBe("slopweaver handover register: this seat is 3 commit(s) behind origin/main");
    expect(lines.at(-1)!).toContain("could not be reached");
    expect(lines.at(-1)!).toContain("driver failed");
  });

  test("a damaged row prints the notice with the refusal and is left exactly as it was", async () => {
    const home = newHome();
    const store = memorySingletonStore();
    store.rows.set(home, { document: { noticedSessions: "session-e", schemaVersion: 1 }, revision: 4 });
    const lines: string[] = [];
    await noOverlapNotice({
      home,
      notices: memoryStaleSeatNoticesPort({ store }),
      sessionId: "session-e",
      sink: lines,
    });
    expect(lines.at(-1)!).toContain("the store's stale-seat-notices row is not a stale-seat notices document");
    expect(store.rows.get(home)).toEqual({
      document: { noticedSessions: "session-e", schemaVersion: 1 },
      revision: 4,
    });
  });

  test("a no-overlap notice is skipped outright when there is no session to dedup against", async () => {
    const lines: string[] = [];
    await maybeWarnStaleSeat({
      home: newHome(),
      notices: memoryStaleSeatNoticesPort(),
      measureDrift: statedDrift({ behind: 3, changedPaths: [] }),
      noun: "handover",
      nowMs: 1_000,
      sessionId: undefined,
      verb: "register",
      writeLine: (line) => lines.push(line),
    });
    expect(lines).toEqual([]);
  });

  test("a drift that could not be measured leaves the verb exactly as it was", async () => {
    const lines: string[] = [];
    await maybeWarnStaleSeat({
      home: newHome(),
      notices: memoryStaleSeatNoticesPort(),
      measureDrift: () => undefined,
      noun: "handover",
      nowMs: 1_000,
      sessionId: "session-c",
      verb: "register",
      writeLine: (line) => lines.push(line),
    });
    expect(lines).toEqual([]);
  });
});
