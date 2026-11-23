import { describe, expect, it } from "vitest";

import type { StoredInteractionSession } from "../../../../../browser/interactionSessionStore.js";
import { gatherBrowserReapInput, judgeBrowserSessions } from "../../../../../browser/sessionReap.js";
import {
  type BrowserSessionsDeps,
  browserSessionRows,
  renderBrowserSessionLines,
  runBrowserSessionsWithDeps,
} from "../../../../../cli/commands/browser/sessionsRun.js";

const NOW = "2026-09-28T04:00:00.000Z";

/** A month-old session opened by pid `ownerPid` in run `a-run`, last touched at `touchedAtIso`, looking at `url`. */
const stored = ({
  id,
  ownerPid,
  touchedAtIso,
  url,
}: {
  id: string;
  ownerPid: number;
  touchedAtIso: string;
  url: string | null;
}): StoredInteractionSession => ({
  observation:
    url === null
      ? null
      : { id: "look-1", observedAtIso: NOW, screenshotPath: null, snapshotPath: "/snap.yml", title: "Queue", url },
  session: {
    clientSession: `slopweaver-${id}`,
    id,
    openedAtIso: "2026-08-28T04:00:00.000Z",
    origins: [],
    owner: { cmuxWorkspace: "WORKSPACE-1234", pid: ownerPid, runSlug: "a-run" },
    ownerSessionId: `sess-${id}-0000`,
    placement: "background",
    touchedAtIso,
    workspace: `/home/live/browser/sessions/${id}/client`,
  },
});

/** Two minutes before {@link NOW}: inside the idle expiry, so a live opener's session is still in use. */
const IN_USE = "2026-09-28T03:58:00.000Z";
/** Forty-one minutes before {@link NOW}: past the expiry, so no command may act through the session. */
const GONE_QUIET = "2026-09-28T03:19:00.000Z";

const STORED = [
  stored({ id: "live", ownerPid: 500, touchedAtIso: IN_USE, url: "http://localhost:3000/queue" }),
  stored({ id: "dead", ownerPid: 501, touchedAtIso: "2026-08-28T04:00:00.000Z", url: null }),
];

const PROCESSES = [
  { argv: "claude", pid: 500, ppid: 1 },
  {
    argv: "/node /repo/node_modules/playwright-core/lib/entry/cliDaemon.js slopweaver-dead --browser=chrome --extension",
    pid: 900,
    ppid: 1,
  },
];

const rows = ({ sessions = STORED }: { sessions?: readonly StoredInteractionSession[] } = {}) =>
  browserSessionRows({
    nowIso: NOW,
    stored: sessions,
    verdicts: judgeBrowserSessions({
      input: gatherBrowserReapInput({
        nowIso: NOW,
        processes: PROCESSES,
        readers: {
          listeningPorts: () => new Set([3000]),
          liveOwners: () => [{ pid: 500, sessionId: "sess-live-0000" }],
        },
        stored: sessions,
      }),
    }),
  });

describe("browserSessionRows", () => {
  it("carries the opener, whether it is live, the daemon, the page, the age and the reap's verdict", () => {
    const [live, dead] = rows();
    expect(live!.ownerLiveness).toBe("live");
    expect(live!.reapVerdict).toBe("keep");
    expect(live!.page).toBe("http://localhost:3000/queue");
    // The page was opened 31 days before the reading.
    expect(live!.ageSeconds).toBe(2_678_400);
    expect(live!.daemon).toEqual({ connected: false, pids: [] });
    expect(dead!.ownerLiveness).toBe("dead");
    expect(dead!.reapVerdict).toBe("close");
    expect(dead!.daemon).toEqual({ connected: true, pids: [900] });
    expect(dead!.interaction).toBe("idle");
  });

  it("says the reap lets go of a live opener's session once it has gone quiet past its expiry", () => {
    const [quiet] = rows({
      sessions: [stored({ id: "live", ownerPid: 500, touchedAtIso: GONE_QUIET, url: "http://localhost:3000/queue" })],
    });
    expect(quiet!.ownerLiveness).toBe("live");
    expect(quiet!.interaction).toBe("idle");
    expect(quiet!.reapVerdict).toBe("forget");
    const lines = renderBrowserSessionLines({ rows: [quiet!] });
    expect(lines[1]).toContain("→ reap forget: idle 41m, past its 15-minute expiry, so no command can act through it");
  });
});

describe("renderBrowserSessionLines", () => {
  it("says so when nothing is open", () => {
    expect(renderBrowserSessionLines({ rows: [] })).toEqual(["browser sessions: none open"]);
  });

  it("prints a count line, then each session's state and its page and opener", () => {
    const lines = renderBrowserSessionLines({ rows: rows() });
    expect(lines[0]).toBe(
      "browser sessions: 2 held · the next `machine reap` keeps 1, closes 1, forgets 0 whose tab no daemon holds",
    );
    expect(lines[1]).toContain(
      "owner live  no daemon (Chrome: not connected)  → reap keep: its opener pid 500 is alive",
    );
    expect(lines[2]).toBe(
      "      http://localhost:3000/queue  — opened by session sess-liv · pid 500 · workspace WORKSPAC · run a-run",
    );
    expect(lines[3]).toContain("owner dead  daemon connected  → reap close: its opener pid 501 is gone");
    expect(lines[4]).toContain("(never read)");
  });
});

describe("runBrowserSessionsWithDeps", () => {
  it("exits 1 rather than guess when the process table cannot be read", () => {
    const deps: BrowserSessionsDeps = {
      listeningPorts: () => new Set<number>(),
      liveOwners: () => [],
      nowIso: () => NOW,
      processes: () => undefined,
      stored: () => STORED,
    };
    expect(runBrowserSessionsWithDeps({ deps, json: true })).toBe(1);
  });
});
