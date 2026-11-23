/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type BrowserActionError, BrowserActionErrors } from "../../../../../browser/actionErrors.js";
import type { InteractionSession, PageObservation } from "../../../../../browser/interactionSession.js";
import { readInteractionSession, writeInteractionSession } from "../../../../../browser/interactionSessionStore.js";
import { holdBrowserSession } from "../../../../../browser/sessionLock.js";
import type { TerminalClientDeps } from "../../../../../browser/terminalClient.js";
import { claimLiveSession, fileLook, keptAliveDeps } from "../../../../../cli/commands/browser/sessionHold.js";
import {
  fail,
  liveSession,
  ownerSessionId,
  pictureIsOfThisLook,
} from "../../../../../cli/commands/browser/sessionShell.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";

const ID = "5f2a1c30-0000-4000-8000-000000000001";
const OTHER = "5f2a1c30-0000-4000-8000-000000000002";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "session-shell-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function session(): InteractionSession {
  return {
    clientSession: "slopweaver-5f2a1c30",
    id: ID,
    openedAtIso: "2026-09-16T08:24:00.000Z",
    origins: ["https://ap1.datadoghq.com"],
    owner: { cmuxWorkspace: "WS-1", pid: 4242, runSlug: "some-run" },
    ownerSessionId: "agent-1",
    placement: "foreground",
    touchedAtIso: "2026-09-16T08:30:00.000Z",
    workspace: join(home, "client"),
  };
}

const OBSERVATION: PageObservation = {
  id: "obs-1",
  observedAtIso: "2026-09-16T08:30:00.000Z",
  screenshotPath: null,
  snapshotPath: "/s/page.yml",
  title: "APM Traces | Datadog",
  url: "https://ap1.datadoghq.com/apm/traces",
};

describe("ownerSessionId", () => {
  it("answers the id the reader returns", () => {
    expect(ownerSessionId({ readSessionId: () => "c0ffee00-session" })).toBe("c0ffee00-session");
  });

  it("answers unknown-session when the reader finds no id", () => {
    expect(ownerSessionId({ readSessionId: () => undefined })).toBe("unknown-session");
  });
});

describe("liveSession", () => {
  it("loads a stored live session and refuses an id with no record as SESSION_LOST with its exact message", () => {
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: session() } });

    const found = liveSession({ home, nowIso: "2026-09-16T08:31:00.000Z", sessionId: ID });
    const missing = liveSession({ home, nowIso: "2026-09-16T08:31:00.000Z", sessionId: OTHER });

    expect(found).toEqual(ok({ observation: OBSERVATION, session: session() }));
    expect(readInteractionSession({ home, id: ID })).toEqual({ observation: OBSERVATION, session: session() });
    expect(missing).toEqual(err(BrowserActionErrors.sessionLost({ sessionId: OTHER })));
    const error = unwrapErr(missing);
    expect(error.code).toBe("SESSION_LOST");
    expect(error.message).toBe(
      `no live browser session answers to ${OTHER} — it was closed, it expired, or it was never opened. ` +
        "Take a fresh one with `slopweaver browser open --url <url>`.",
    );
  });
});

describe("claimLiveSession", () => {
  it("touches the stored record at LOAD, so a reap cannot judge a command mid-act idle", () => {
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: session() } });
    const touched = { ...session(), touchedAtIso: "2026-09-16T08:44:00.000Z" };

    const claimed = claimLiveSession({ home, nowIso: "2026-09-16T08:44:00.000Z", sessionId: ID });

    expect(claimed).toEqual(ok({ observation: OBSERVATION, session: touched }));
    expect(readInteractionSession({ home, id: ID })).toEqual({ observation: OBSERVATION, session: touched });
  });

  it("refuses SESSION_BUSY and touches nothing while a reap holds the session's lock", () => {
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: session() } });
    const reap = unwrap(holdBrowserSession({ home, id: ID, nowIso: "2026-09-16T08:44:00.000Z" }));

    const busy = claimLiveSession({ home, nowIso: "2026-09-16T08:44:00.000Z", sessionId: ID });
    reap.release();

    expect(unwrapErr(busy).code).toBe("SESSION_BUSY");
    expect(readInteractionSession({ home, id: ID })).toEqual({ observation: OBSERVATION, session: session() });
  });

  it("releases its own lock, so the next claim succeeds", () => {
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: session() } });

    claimLiveSession({ home, nowIso: "2026-09-16T08:40:00.000Z", sessionId: ID });
    const again = claimLiveSession({ home, nowIso: "2026-09-16T08:41:00.000Z", sessionId: ID });

    expect(unwrap(again).session.touchedAtIso).toBe("2026-09-16T08:41:00.000Z");
  });

  it("never moves the touch BACKWARDS when the clock was set back", () => {
    const later = { ...session(), touchedAtIso: "2026-09-16T08:40:00.000Z" };
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: later } });

    const claimed = claimLiveSession({ home, nowIso: "2026-09-16T08:35:00.000Z", sessionId: ID });

    expect(unwrap(claimed).session.touchedAtIso).toBe("2026-09-16T08:40:00.000Z");
    expect(readInteractionSession({ home, id: ID })!.session.touchedAtIso).toBe("2026-09-16T08:40:00.000Z");
  });

  it("refuses an expired session as SESSION_IDLE and leaves its record untouched", () => {
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: session() } });

    const idle = claimLiveSession({ home, nowIso: "2026-09-16T08:46:00.000Z", sessionId: ID });

    expect(unwrapErr(idle).code).toBe("SESSION_IDLE");
    expect(readInteractionSession({ home, id: ID })).toEqual({ observation: OBSERVATION, session: session() });
  });
});

describe("keptAliveDeps", () => {
  const resolved = (): TerminalClientDeps => ({
    chromePinPath: "/nowhere/pin",
    clientSession: "slopweaver-5f2a1c30",
    extensionToken: "FIXTURE-token",
    placement: "background",
    workspace: join(home, "client"),
  });
  const holdOf = ({ clock }: { clock: () => string }): (() => Result<() => void, BrowserActionError>) =>
    keptAliveDeps({ clock, deps: resolved(), home, sessionId: ID }).holdForCommand!;
  /** Whether a closer could take the session's lock right now. */
  const closerCouldHold = (): boolean => {
    const closer = holdBrowserSession({ home, id: ID, nowIso: "2026-09-16T08:41:00.000Z" });
    const free = closer.isOk();
    closer.map((handle) => handle.release());
    return free;
  };

  it("keeps every other field of the resolved deps", () => {
    const { holdForCommand: _hook, ...rest } = keptAliveDeps({ deps: resolved(), home, sessionId: ID });

    expect(rest).toEqual(resolved());
  });

  it("holds the session's lock for the whole command, so no closer can act while it runs", () => {
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: session() } });

    const release = unwrap(holdOf({ clock: () => "2026-09-16T08:40:00.000Z" })());
    const duringCommand = closerCouldHold();
    release();

    expect([duringCommand, closerCouldHold()]).toEqual([false, true]);
  });

  it("touches the session at each command's own instant, so a run of commands never reads as idle", () => {
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: session() } });
    const instants = ["2026-09-16T08:40:00.000Z", "2026-09-16T08:52:00.000Z"];
    const hold = holdOf({ clock: () => instants.shift()! });

    unwrap(hold())();
    unwrap(hold())();

    expect(readInteractionSession({ home, id: ID })!.session.touchedAtIso).toBe("2026-09-16T08:52:00.000Z");
  });

  it("refuses the command when the session is gone, and leaves the lock free", () => {
    const kept = holdOf({ clock: () => "2026-09-16T08:40:00.000Z" })();

    expect(unwrapErr(kept).code).toBe("SESSION_LOST");
    expect(closerCouldHold()).toBe(true);
  });

  it("refuses the command when the session already expired, and leaves the lock free", () => {
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: session() } });

    const kept = holdOf({ clock: () => "2026-09-16T08:46:00.000Z" })();

    expect(unwrapErr(kept).code).toBe("SESSION_IDLE");
    expect(closerCouldHold()).toBe(true);
  });

  it("refuses the command under a closer's held lock, touching nothing", () => {
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: session() } });
    const reap = unwrap(holdBrowserSession({ home, id: ID, nowIso: "2026-09-16T08:40:00.000Z" }));

    const kept = holdOf({ clock: () => "2026-09-16T08:40:00.000Z" })();
    reap.release();

    expect(unwrapErr(kept).code).toBe("SESSION_BUSY");
    expect(readInteractionSession({ home, id: ID })).toEqual({ observation: OBSERVATION, session: session() });
  });
});

describe("fail", () => {
  it("answers exit code 1", () => {
    expect(fail({ problems: ["the page went away"] })).toBe(1);
  });
});

describe("whether a look's picture shows the page its snapshot read", () => {
  const PAGE_A = "https://example.invalid/a";

  it("keeps a picture of the same page", () => {
    expect(pictureIsOfThisLook({ lookUrl: PAGE_A, picturedUrl: PAGE_A })).toBe(true);
  });

  it("withholds a picture taken after a redirect to another page", () => {
    expect(pictureIsOfThisLook({ lookUrl: PAGE_A, picturedUrl: "https://example.invalid/b" })).toBe(false);
  });

  it("leaves a picture standing when the screenshot reply named no page", () => {
    expect(pictureIsOfThisLook({ lookUrl: PAGE_A, picturedUrl: null })).toBe(true);
  });
});

describe("fileLook", () => {
  /** A fresh look whose snapshot is a real file in this test's home. */
  const freshLook = (): PageObservation => {
    const snapshotPath = join(home, "look-2.yml");
    writeFileSync(snapshotPath, '- main [ref=e1]:\n  - button "Merge" [ref=e2]', "utf8");
    return { ...OBSERVATION, id: "obs-2", snapshotPath };
  };

  it("files the look and touches the session at the command's own instant", () => {
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: session() } });
    const look = freshLook();

    const filed = fileLook({
      home,
      notFiled: "not filed",
      nowIso: "2026-09-16T08:35:00.000Z",
      observation: look,
      session: session(),
    });

    expect(filed.isOk()).toBe(true);
    expect(readInteractionSession({ home, id: ID })).toEqual({
      observation: look,
      session: { ...session(), touchedAtIso: "2026-09-16T08:35:00.000Z" },
    });
  });

  it("never moves the touch BACKWARDS past a later command's", () => {
    const later = { ...session(), touchedAtIso: "2026-09-16T08:40:00.000Z" };
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: later } });

    fileLook({
      home,
      notFiled: "not filed",
      nowIso: "2026-09-16T08:35:00.000Z",
      observation: freshLook(),
      session: session(),
    });

    expect(readInteractionSession({ home, id: ID })!.session.touchedAtIso).toBe("2026-09-16T08:40:00.000Z");
  });

  it("refuses rather than RECREATE a record a reap removed while the command ran", () => {
    const filed = fileLook({
      home,
      notFiled: "not filed",
      nowIso: "2026-09-16T08:35:00.000Z",
      observation: freshLook(),
      session: session(),
    });

    expect(unwrapErr(filed)).toEqual([BrowserActionErrors.sessionLost({ sessionId: ID }).message, "not filed"]);
    expect(readInteractionSession({ home, id: ID })).toBe(undefined);
  });

  it("files nothing while a closer holds the session's lock, so a close cannot be undone", () => {
    const stored = { observation: OBSERVATION, session: session() };
    writeInteractionSession({ home, stored });
    const closer = unwrap(holdBrowserSession({ home, id: ID, nowIso: "2026-09-16T08:35:00.000Z" }));

    const filed = fileLook({
      home,
      notFiled: "not filed",
      nowIso: "2026-09-16T08:35:00.000Z",
      observation: freshLook(),
      session: session(),
    });
    closer.release();

    const problems = unwrapErr(filed);
    expect(problems[0]).toContain("held by another process");
    expect(problems[1]).toBe("not filed");
    expect(readInteractionSession({ home, id: ID })).toEqual(stored);
  });

  it("releases its lock once the look is filed, so the next claimant takes it", () => {
    writeInteractionSession({ home, stored: { observation: OBSERVATION, session: session() } });

    fileLook({
      home,
      notFiled: "not filed",
      nowIso: "2026-09-16T08:35:00.000Z",
      observation: freshLook(),
      session: session(),
    });
    const next = holdBrowserSession({ home, id: ID, nowIso: "2026-09-16T08:35:01.000Z" });

    expect(next.isOk()).toBe(true);
    unwrap(next).release();
  });
});
