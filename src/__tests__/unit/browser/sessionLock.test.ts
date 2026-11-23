import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { holdBrowserSession, underSessionLock } from "../../../browser/sessionLock.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const ID = "5f2a1c30-0000-4000-8000-0000000000e1";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "session-lock-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("holdBrowserSession", () => {
  it("still refuses a second holder past a whole three-command close at the client's timeout", () => {
    const closer = unwrap(holdBrowserSession({ home, id: ID, nowIso: "2026-09-16T08:00:00.000Z" }));

    // Three commands at 60 seconds each is 180 seconds; the old 120-second bound let this one in.
    const second = holdBrowserSession({ home, id: ID, nowIso: "2026-09-16T08:03:01.000Z" });
    closer.release();

    expect(unwrapErr(second)).toContain("held by pid");
  });

  it("never takes over a LIVE holder, even a day later, so no close lands mid-command after a clock jump", () => {
    const running = unwrap(holdBrowserSession({ home, id: ID, nowIso: "2026-09-16T08:00:00.000Z" }));

    const closer = holdBrowserSession({ home, id: ID, nowIso: "2026-09-17T08:00:00.000Z" });
    running.release();

    expect(unwrapErr(closer)).toContain("never to go stale while its holder lives");
  });

  it("runs a closer's body while the lock is held, and frees it after", () => {
    const NOW = "2026-09-16T08:00:00.000Z";
    const during = unwrap(
      underSessionLock({
        act: () => holdBrowserSession({ home, id: ID, nowIso: NOW }),
        home,
        nowIso: NOW,
        sessionId: ID,
      }),
    );

    expect(unwrapErr(during)).toContain("held by pid");
    const after = unwrap(holdBrowserSession({ home, id: ID, nowIso: NOW }));
    after.release();
  });

  it("runs nothing and answers SESSION_BUSY when a command holds the session", () => {
    const NOW = "2026-09-16T08:00:00.000Z";
    const running = unwrap(holdBrowserSession({ home, id: ID, nowIso: NOW }));
    const ran: string[] = [];

    const closed = underSessionLock({ act: () => ran.push("closed"), home, nowIso: NOW, sessionId: ID });
    running.release();

    expect(unwrapErr(closed).code).toBe("SESSION_BUSY");
    expect(ran).toEqual([]);
  });

  it("is free again the moment its holder lets go", () => {
    unwrap(holdBrowserSession({ home, id: ID, nowIso: "2026-09-16T08:00:00.000Z" })).release();

    const next = holdBrowserSession({ home, id: ID, nowIso: "2026-09-16T08:00:01.000Z" });

    expect(next.isOk()).toBe(true);
    unwrap(next).release();
  });
});
