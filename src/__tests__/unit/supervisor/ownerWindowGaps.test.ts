import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { CODEX_CHAIR_UNREAD, type SupervisorLink } from "../../../supervisor/chain.js";
import { ownerWindowGaps } from "../../../supervisor/ownerWindowGaps.js";

const CLAUDE = "a0000013-0000-4000-8000-000000000014";
const SINCE = "2026-09-05T00:00:00.000Z";
const scratch: string[] = [];

afterEach(() => {
  scratch.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A fresh state home, removed after the test. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "window-gaps-"));
  scratch.push(dir);
  return dir;
}

/** One pin link on the given host. */
function link({ host, id, at }: { host: "claude-code" | "codex"; id: string; at: string }): SupervisorLink {
  return { pinnedAtIso: at, session: { host, id }, source: "pin", workspaceId: "ws", workspaceRef: "workspace:1" };
}

describe("ownerWindowGaps", () => {
  it("names nothing when every chair in the window is Claude's and the archive read", () => {
    const chain = [link({ at: "2026-09-04T22:00:00.000Z", host: "claude-code", id: CLAUDE })];

    expect(ownerWindowGaps({ chain, home: home(), rulingProblems: [], sinceIso: SINCE })).toBeUndefined();
  });

  it("names a Codex chair inside the window, so a window it held never counts as no turns", () => {
    const chain = [
      link({ at: "2026-09-04T22:00:00.000Z", host: "claude-code", id: CLAUDE }),
      link({ at: "2026-09-05T02:00:00.000Z", host: "codex", id: "thread-1" }),
    ];

    expect(ownerWindowGaps({ chain, home: home(), rulingProblems: [], sinceIso: SINCE })).toBe(
      `chair codex:thread-1: ${CODEX_CHAIR_UNREAD}`,
    );
  });

  it("names the live pin's Codex chair when the journal never caught it, after the archive's gap", () => {
    const dir = home();
    const record = { pinnedAtIso: "2026-09-05T03:00:00.000Z", workspaceId: "ws", workspaceRef: "workspace:1" };
    writeSupervisorPin({ home: dir, record: { ...record, session: { host: "codex", id: "thread-2" } } });

    expect(ownerWindowGaps({ chain: [], home: dir, rulingProblems: ["a.md: torn"], sinceIso: SINCE })).toBe(
      `ruling archive: a.md: torn; chair codex:thread-2: ${CODEX_CHAIR_UNREAD}`,
    );
  });

  it("names a Codex thread that retook the chair after another session, though its first tenure ended early", () => {
    const dir = home();
    const record = { pinnedAtIso: "2026-09-06T00:00:00.000Z", workspaceId: "ws", workspaceRef: "workspace:1" };
    writeSupervisorPin({ home: dir, record: { ...record, session: { host: "codex", id: "thread-a" } } });
    const chain = [
      link({ at: "2026-09-01T00:00:00.000Z", host: "codex", id: "thread-a" }),
      link({ at: "2026-09-02T00:00:00.000Z", host: "claude-code", id: CLAUDE }),
    ];

    expect(ownerWindowGaps({ chain, home: dir, rulingProblems: [], sinceIso: SINCE })).toBe(
      `chair codex:thread-a: ${CODEX_CHAIR_UNREAD}`,
    );
  });

  it("names the live pin's Codex chair even when its instant will not parse", () => {
    const dir = home();
    const record = { pinnedAtIso: "not-an-instant", workspaceId: "ws", workspaceRef: "workspace:1" };
    writeSupervisorPin({ home: dir, record: { ...record, session: { host: "codex", id: "thread-1" } } });

    expect(ownerWindowGaps({ chain: [], home: dir, rulingProblems: [], sinceIso: SINCE })).toBe(
      `chair codex:thread-1: ${CODEX_CHAIR_UNREAD}`,
    );
  });

  it("leaves out a Codex chair whose successor took the pin before the floor", () => {
    const chain = [
      link({ at: "2026-09-01T00:00:00.000Z", host: "codex", id: "thread-old" }),
      link({ at: "2026-09-02T00:00:00.000Z", host: "claude-code", id: CLAUDE }),
    ];

    expect(ownerWindowGaps({ chain, home: home(), rulingProblems: [], sinceIso: SINCE })).toBeUndefined();
  });
});
