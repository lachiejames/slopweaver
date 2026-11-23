import { describe, expect, it } from "vitest";

import type { InteractionSession } from "../../../browser/interactionSession.js";
import {
  type BrowserReapInput,
  daemonPidsOf,
  expiredIdleMinutes,
  judgeBrowserSessions,
  loopbackPortOf,
  ownExpiredSessionIds,
  ownerLiveness,
  parseListeningPorts,
} from "../../../browser/sessionReap.js";

const DAEMON_ARGV = ({ name }: { name: string }): string =>
  `/node /repo/node_modules/playwright-core/lib/entry/cliDaemon.js ${name} --browser=chrome --extension`;

/** A session record, opened by pid 500 in run `a-run` unless a test says otherwise. */
const session = (over: Partial<InteractionSession> = {}): InteractionSession => ({
  clientSession: "slopweaver-aaaaaaaa",
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  openedAtIso: "2026-09-28T01:00:00.000Z",
  origins: ["http://localhost:3001"],
  owner: { cmuxWorkspace: "WS-1", pid: 500, runSlug: "a-run" },
  ownerSessionId: "sess-live",
  placement: "background",
  touchedAtIso: "2026-09-28T01:00:00.000Z",
  workspace: "/home/live/browser/sessions/aaaaaaaa/client",
  ...over,
});

/**
 * A machine where pid 500 is a live Claude Code session, its daemon runs, and port 3000 alone listens, five
 * minutes after the default session was last touched.
 */
const input = (over: Partial<BrowserReapInput> = {}): BrowserReapInput => ({
  listeningPorts: new Set([3000]),
  liveRegistry: [{ pid: 500, sessionId: "sess-live" }],
  nowIso: "2026-09-28T01:05:00.000Z",
  processes: [
    { argv: "claude", pid: 500 },
    { argv: DAEMON_ARGV({ name: "slopweaver-aaaaaaaa" }), pid: 900 },
  ],
  sessions: [{ session: session(), url: "http://localhost:3001/queue" }],
  ...over,
});

const only = (over: Partial<BrowserReapInput> = {}) => judgeBrowserSessions({ input: input(over) })[0]!;

describe("a session whose opener is alive", () => {
  it("is KEPT while in use, even on a dead localhost port — the legit long-lived browser", () => {
    const verdict = only();
    expect(verdict.owner).toBe("live");
    expect(verdict.action).toBe("keep");
    expect(verdict.why).toBe("its opener pid 500 is alive");
  });
});

describe("a background session past its idle expiry", () => {
  // The shape: one live seat, pid 500, holding a window it last touched 41 minutes ago.
  const quiet = { nowIso: "2026-09-28T01:41:00.000Z" };

  it("is CLOSED through its daemon although its opener lives — no command can act through it", () => {
    const verdict = only(quiet);
    expect(verdict.owner).toBe("live");
    expect(verdict.action).toBe("close");
    expect(verdict.daemonPids).toEqual([900]);
    expect(verdict.why).toBe("idle 41m, past its 15-minute expiry, so no command can act through it");
    expect(verdict.idleJudgedOn).toBe("2026-09-28T01:00:00.000Z");
  });

  it("is KEPT one millisecond inside the expiry, and let go of at exactly fifteen minutes", () => {
    expect(only({ nowIso: "2026-09-28T01:14:59.999Z" }).action).toBe("keep");
    expect(only({ nowIso: "2026-09-28T01:15:00.000Z" }).action).toBe("close");
  });

  it("is FORGOTTEN when no daemon holds it any more", () => {
    expect(only({ ...quiet, processes: [{ argv: "claude", pid: 500 }] }).action).toBe("forget");
  });

  it("is let go of when its owner is unknown too, on a provider page an unknown owner otherwise keeps", () => {
    const unnamed = session({ owner: null, ownerSessionId: "unknown-session" });
    const verdict = only({ ...quiet, sessions: [{ session: unnamed, url: "https://app.vanta.com/c/x" }] });
    expect(verdict.owner).toBe("unknown");
    expect(verdict.action).toBe("close");
  });

  it("KEEPS a FOREGROUND one, opened to be shown to the owner, while its opener lives", () => {
    const shown = session({ placement: "foreground" });
    const verdict = only({ ...quiet, sessions: [{ session: shown, url: "http://localhost:3001/queue" }] });
    expect(verdict.action).toBe("keep");
    expect(verdict.why).toBe("its opener pid 500 is alive");
  });

  it("KEEPS one whose last touch cannot be dated — an unreadable reading never widens the reap", () => {
    const torn = session({ touchedAtIso: "" });
    expect(only({ ...quiet, sessions: [{ session: torn, url: null }] }).action).toBe("keep");
  });

  it("still KEEPS a shared client name a daemon carries — the daemon cannot be attributed to one", () => {
    const twin = session({ id: "aaaaaaaa-0000-4000-8000-000000000002" });
    const sessions = [
      { session: session(), url: null },
      { session: twin, url: null },
    ];
    const verdicts = judgeBrowserSessions({ input: input({ ...quiet, sessions }) });
    expect(verdicts.map((verdict) => verdict.action)).toEqual(["keep", "keep"]);
  });
});

describe("ownExpiredSessionIds", () => {
  const mine = session({ id: "mine" });
  const fresh = session({ id: "fresh", touchedAtIso: "2026-09-28T01:40:00.000Z" });
  const theirs = session({ id: "theirs", owner: { cmuxWorkspace: null, pid: 501, runSlug: null } });
  const legacy = session({ id: "legacy", owner: null });
  const sessions = [mine, fresh, theirs, legacy].map((one) => ({ session: one }));

  it("picks only the opener's own sessions past their expiry", () => {
    const ids = ownExpiredSessionIds({ nowIso: "2026-09-28T01:41:00.000Z", ownerPid: 500, sessions });
    expect([...ids]).toEqual(["mine"]);
  });

  it("picks nothing for an opener with no recorded pid", () => {
    expect(ownExpiredSessionIds({ nowIso: "2026-09-28T01:41:00.000Z", ownerPid: null, sessions }).size).toBe(0);
  });
});

describe("expiredIdleMinutes", () => {
  it("answers whole minutes past the expiry for a background session, null inside it or in the foreground", () => {
    expect(expiredIdleMinutes({ nowIso: "2026-09-28T04:00:59.000Z", session: session() })).toBe(180);
    expect(expiredIdleMinutes({ nowIso: "2026-09-28T01:10:00.000Z", session: session() })).toBe(null);
    const shown = session({ placement: "foreground" });
    expect(expiredIdleMinutes({ nowIso: "2026-09-28T04:00:00.000Z", session: shown })).toBe(null);
  });
});

describe("a session whose opener is dead", () => {
  it("is CLOSED through its daemon when the opener pid is gone", () => {
    const verdict = only({ processes: [{ argv: DAEMON_ARGV({ name: "slopweaver-aaaaaaaa" }), pid: 900 }] });
    expect(verdict.action).toBe("close");
    expect(verdict.daemonPids).toEqual([900]);
    expect(verdict.why).toBe("its opener pid 500 is gone");
  });

  it("is FORGOTTEN when no daemon holds its connection any more", () => {
    const verdict = only({ processes: [] });
    expect(verdict.action).toBe("forget");
    expect(verdict.daemonPids).toEqual([]);
  });
});

describe("an opener pid that is alive decides alone, whatever the registry says", () => {
  it("is KEPT with no registry row, as a session under another CLAUDE_CONFIG_DIR or run as node cli.js has", () => {
    const verdict = only({
      liveRegistry: [],
      processes: [
        { argv: "/usr/bin/node /opt/claude-code/cli.js --session-id live", pid: 500 },
        { argv: DAEMON_ARGV({ name: "slopweaver-aaaaaaaa" }), pid: 900 },
      ],
    });
    expect(verdict.owner).toBe("live");
    expect(verdict.action).toBe("keep");
    expect(verdict.why).toBe("its opener pid 500 is alive");
  });

  it("KEEPS a recycled pid's session — a leaked tab until that process exits, never a live seat's tab closed", () => {
    const verdict = only({
      liveRegistry: [],
      processes: [
        { argv: "/usr/bin/vim notes.md", pid: 500 },
        { argv: DAEMON_ARGV({ name: "slopweaver-aaaaaaaa" }), pid: 900 },
      ],
    });
    expect(verdict.action).toBe("keep");
  });
});

describe("two records sharing one client name", () => {
  // Both ids open `aaaaaaaa`, so both records carry `slopweaver-aaaaaaaa`: daemon 900 could be either one's.
  const dead = session({
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    owner: { cmuxWorkspace: "WS-2", pid: 501, runSlug: "b-run" },
  });
  const both = [
    { session: session(), url: "http://localhost:3001/queue" },
    { session: dead, url: "http://localhost:3001/queue" },
  ];

  it("KEEPS the dead opener's record too, because the daemon the name finds may be the live one's", () => {
    const verdicts = judgeBrowserSessions({ input: input({ sessions: both }) });
    expect(verdicts.map((verdict) => verdict.action)).toEqual(["keep", "keep"]);
    expect(verdicts[1]!.why).toBe("2 records share slopweaver-aaaaaaaa, so its daemon cannot be attributed to one");
  });

  it("still forgets the dead record when no daemon carries the name — only a file goes", () => {
    const verdicts = judgeBrowserSessions({
      input: input({ processes: [{ argv: "claude", pid: 500 }], sessions: both }),
    });
    expect(verdicts.map((verdict) => verdict.action)).toEqual(["keep", "forget"]);
  });
});

describe("a finished run is not a criterion", () => {
  it("KEEPS a live opener's session whose run is done — the owner is live, so it is not touched", () => {
    // The record names run `a-run`; nothing this judgement reads can see that run's state, and pid 500 is a
    // live Claude Code session holding daemon 900, so the only verdict is keep.
    const verdict = only({
      sessions: [
        {
          session: session({ owner: { cmuxWorkspace: "WS-1", pid: 500, runSlug: "a-run" } }),
          url: "http://localhost:3001/queue",
        },
      ],
    });
    expect(verdict.owner).toBe("live");
    expect(verdict.action).toBe("keep");
    expect(verdict.daemonPids).toEqual([900]);
  });
});

describe("a legacy record with no recorded pid", () => {
  const legacy = [{ session: session({ owner: null }), url: "https://github.com/x/y/pull/1" }];

  it("is live while a registry row carries its session id", () => {
    expect(only({ sessions: legacy }).action).toBe("keep");
  });

  it("is FORGOTTEN once no live session carries its id and no daemon holds its tab — only a file goes", () => {
    const verdict = only({
      liveRegistry: [{ pid: 501, sessionId: "someone-else" }],
      processes: [{ argv: "claude", pid: 500 }],
      sessions: legacy,
    });
    expect(verdict.owner).toBe("dead");
    expect(verdict.action).toBe("forget");
  });

  it("is KEPT when its id is gone but a daemon still holds its tab — a /clear looks the same as an exit", () => {
    // Pid 500 ran /clear: the registry now carries a new id at the same pid, and daemon 900 still holds the tab.
    const verdict = only({ liveRegistry: [{ pid: 500, sessionId: "after-clear" }], sessions: legacy });
    expect(verdict.owner).toBe("unknown");
    expect(verdict.action).toBe("keep");
    expect(verdict.daemonPids).toEqual([900]);
  });
});

describe("a session whose opener cannot be known", () => {
  const unnamed = ({ url }: { url: string }) => [
    { session: session({ owner: null, ownerSessionId: "unknown-session" }), url },
  ];

  it("is let go of when its localhost port has nothing listening", () => {
    const verdict = only({ sessions: unnamed({ url: "http://localhost:3056/queue" }) });
    expect(verdict.owner).toBe("unknown");
    expect(verdict.action).toBe("close");
    expect(verdict.why).toBe("nothing listens on localhost:3056 any more");
  });

  it("is LEFT ALONE on a port that still listens", () => {
    expect(only({ sessions: unnamed({ url: "http://localhost:3000/queue" }) }).action).toBe("keep");
  });

  it("is LEFT ALONE on a provider page — an unknown owner is not a dead one", () => {
    expect(only({ sessions: unnamed({ url: "https://app.vanta.com/c/x" }) }).action).toBe("keep");
  });

  it("is LEFT ALONE when the listening ports could not be read", () => {
    const verdict = only({ listeningPorts: undefined, sessions: unnamed({ url: "http://localhost:3056/" }) });
    expect(verdict.action).toBe("keep");
  });

  it("switches the owner criterion OFF for a record with no pid when the registry could not be read", () => {
    const legacy = session({ owner: null });
    const verdict = only({ liveRegistry: undefined, sessions: [{ session: legacy, url: "https://github.com" }] });
    expect(verdict.owner).toBe("unknown");
    expect(verdict.action).toBe("keep");
  });

  it("KEEPS a live opener's session on a dead localhost port when the registry could not be read", () => {
    // Pid 500 is running with its daemon, port 3001 is not listening, and the registry read failed: the pid
    // alone says live, so the unreadable registry is never consulted and never turns into a close.
    const verdict = only({ liveRegistry: undefined });
    expect(verdict.owner).toBe("live");
    expect(verdict.action).toBe("keep");
  });

  it("KEEPS a no-pid record on a dead localhost port when the registry could not be read", () => {
    const verdict = only({
      liveRegistry: undefined,
      sessions: [{ session: session({ owner: null }), url: "http://localhost:3001/queue" }],
    });
    expect(verdict.owner).toBe("unknown");
    expect(verdict.action).toBe("keep");
  });
});

describe("ownerLiveness", () => {
  it("does not compare the registry's session id against a recorded pid — /clear keeps the process", () => {
    const judged = ownerLiveness({
      liveRegistry: [{ pid: 500, sessionId: "after-clear" }],
      processes: [{ argv: "claude", pid: 500 }],
      session: session(),
    });
    expect(judged.owner).toBe("live");
  });
});

describe("daemonPidsOf", () => {
  it("matches the session name as a whole token, never as a prefix", () => {
    const processes = [{ argv: DAEMON_ARGV({ name: "slopweaver-aaaaaaaa9" }), pid: 1 }];
    expect(daemonPidsOf({ clientSession: "slopweaver-aaaaaaaa", processes })).toEqual([]);
  });

  it("ignores a process naming the session that is not the daemon", () => {
    const processes = [{ argv: "grep cliDaemon.js slopweaver-aaaaaaaa", pid: 2 }];
    expect(daemonPidsOf({ clientSession: "slopweaver-aaaaaaaa", processes })).toEqual([]);
  });

  it("ignores a process CARRYING the daemon path and the name as arguments — only node running it is one", () => {
    const processes = [
      { argv: "python3 worker.py /tmp/cliDaemon.js slopweaver-aaaaaaaa", pid: 3 },
      { argv: "/node /x/node_modules/playwright-core/lib/entry/cliDaemon.js", pid: 4 },
      { argv: "/node /tmp/cliDaemon.js slopweaver-aaaaaaaa", pid: 5 },
      { argv: "/node /x/playwright-core/lib/entry/cliDaemon.js other slopweaver-aaaaaaaa", pid: 6 },
    ];
    expect(daemonPidsOf({ clientSession: "slopweaver-aaaaaaaa", processes })).toEqual([]);
  });

  it("matches the real daemon's argv, as ps printed it", () => {
    const argv =
      "/Users/x/.proto/tools/node/24.21.0/bin/node /Users/x/wt/node_modules/playwright-core/lib/entry/cliDaemon.js slopweaver-aaaaaaaa --browser=chrome --extension";
    expect(daemonPidsOf({ clientSession: "slopweaver-aaaaaaaa", processes: [{ argv, pid: 94027 }] })).toEqual([94027]);
  });

  it("carries every daemon under one name rather than picking one", () => {
    const processes = [
      { argv: DAEMON_ARGV({ name: "slopweaver-aaaaaaaa" }), pid: 7 },
      { argv: DAEMON_ARGV({ name: "slopweaver-aaaaaaaa" }), pid: 8 },
    ];
    expect(daemonPidsOf({ clientSession: "slopweaver-aaaaaaaa", processes })).toEqual([7, 8]);
  });
});

describe("age from open is not a criterion", () => {
  it("keeps a live-owned session opened a year ago and still in use, and closes a dead-owned one opened a second ago", () => {
    const ancient = session({ id: "old", openedAtIso: "2025-09-28T00:00:00.000Z" });
    const fresh = session({
      clientSession: "slopweaver-bbbbbbbb",
      id: "fresh",
      owner: { cmuxWorkspace: null, pid: 777, runSlug: null },
    });
    const verdicts = judgeBrowserSessions({
      input: input({
        processes: [
          { argv: "claude", pid: 500 },
          { argv: DAEMON_ARGV({ name: "slopweaver-aaaaaaaa" }), pid: 900 },
          { argv: DAEMON_ARGV({ name: "slopweaver-bbbbbbbb" }), pid: 901 },
        ],
        sessions: [
          { session: ancient, url: "https://github.com/" },
          { session: fresh, url: "https://github.com/" },
        ],
      }),
    });
    expect(verdicts.map((verdict) => [verdict.id, verdict.action])).toEqual([
      ["old", "keep"],
      ["fresh", "close"],
    ]);
  });
});

describe("loopbackPortOf", () => {
  it("reads an explicit port and the scheme's default", () => {
    expect(loopbackPortOf({ url: "http://localhost:3471/pull-requests" })).toBe(3471);
    expect(loopbackPortOf({ url: "http://127.0.0.1/" })).toBe(80);
    expect(loopbackPortOf({ url: "https://[::1]/" })).toBe(443);
  });

  it("answers null for a page on another host, or no page at all", () => {
    expect(loopbackPortOf({ url: "https://github.com/" })).toBe(null);
    expect(loopbackPortOf({ url: "about:blank" })).toBe(null);
    expect(loopbackPortOf({ url: "not a url" })).toBe(null);
  });
});

describe("parseListeningPorts", () => {
  it("reads every address shape lsof prints and ignores the pid lines", () => {
    const text = ["p161", "n*:3000", "n127.0.0.1:19222", "n[::1]:49398", "p200", "nweird"].join("\n");
    expect([...parseListeningPorts({ text })].toSorted((a, b) => a - b)).toEqual([3000, 19222, 49398]);
  });
});
