/**
 * Recording the supervisor pin after a successful pin — a real round trip against a temp state home, and the
 * one rule that keeps the depth guard scoped correctly: a pin of SOMEONE ELSE'S workspace records nothing.
 */
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  forgetUnpinnedSupervisor,
  recordAppSupervisorPin,
  recordSupervisorPin,
} from "../../../../../cli/commands/cmux/recordPin.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { pinnedCmuxWorkspaceId } from "../../../../../sessions/supervisorPin.js";
import { readSupervisorPin, supervisorPinPath } from "../../../../../sessions/supervisorPinStore.js";
import { readSupervisorChain } from "../../../../../supervisor/chainStore.js";
import { recordedChairCodexHome } from "../../../../../supervisor/codexChairRead.js";
import { pinAsLink } from "../../../../../supervisor/intakeScope.js";
import type { SupervisorSessionDetection } from "../../../../../supervisor/session.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh, empty state home. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "supervisor-pin-home-"));
  fixtureDirs.push(dir);
  return dir;
}

/** A detected visible session — Claude Code unless a case names Codex. */
function active({
  id,
  host = "claude-code",
}: {
  id: string;
  host?: "claude-code" | "codex";
}): SupervisorSessionDetection {
  return { kind: "active", session: { host, id } };
}

describe("recordSupervisorPin", () => {
  it("records a Codex thread as the holder, and nothing for an ambiguous process naming both hosts", () => {
    const dir = home();
    const pin = { home: dir, nowIso: "2026-09-02T04:47:00.000Z", ownWorkspaceId: "ws-1", pinnedWorkspaceId: "ws-1" };
    const ambiguous: SupervisorSessionDetection = {
      kind: "ambiguous",
      sessions: [
        { host: "claude-code", id: "sess-super" },
        { host: "codex", id: "thread-1" },
      ],
    };

    expect(recordSupervisorPin({ ...pin, detection: ambiguous, workspaceRef: "workspace:936" })).toBe(false);
    expect(existsSync(supervisorPinPath({ home: dir }))).toBe(false);
    expect(
      recordSupervisorPin({
        ...pin,
        detection: active({ host: "codex", id: "thread-1" }),
        workspaceRef: "workspace:936",
      }),
    ).toBe(true);
    expect(readSupervisorPin({ home: dir })!.session).toStrictEqual({ host: "codex", id: "thread-1" });
  });

  it("records a Codex chair's CODEX_HOME on its pin and its chain link, so its rollout is read from that home", () => {
    const dir = home();
    const codexHome = join(dir, "codex-home");
    const detection: SupervisorSessionDetection = {
      codexHome,
      kind: "active",
      session: { host: "codex", id: "thread-1" },
    };

    expect(
      recordSupervisorPin({
        detection,
        home: dir,
        nowIso: "2026-09-02T04:47:00.000Z",
        ownWorkspaceId: "ws-1",
        pinnedWorkspaceId: "ws-1",
        workspaceRef: "workspace:936",
      }),
    ).toBe(true);
    expect(readSupervisorPin({ home: dir })!.codexHome).toBe(codexHome);
    expect(readSupervisorChain({ home: dir }).map((link) => link.codexHome)).toStrictEqual([codexHome]);
  });

  it("records a pin of the caller's own workspace", () => {
    const dir = home();
    const wrote = recordSupervisorPin({
      detection: active({ id: "sess-super" }),
      home: dir,
      nowIso: "2026-09-02T04:47:00.000Z",
      ownWorkspaceId: "ws-1",
      pinnedWorkspaceId: "ws-1",
      workspaceRef: "workspace:936",
    });
    expect(wrote).toBe(true);
    expect(readSupervisorPin({ home: dir })).toStrictEqual({
      session: { host: "claude-code", id: "sess-super" },
      pinnedAtIso: "2026-09-02T04:47:00.000Z",
      workspaceId: "ws-1",
      workspaceRef: "workspace:936",
    });
  });

  it("records nothing when the pin moved onto a DIFFERENT workspace", () => {
    const dir = home();
    const wrote = recordSupervisorPin({
      detection: active({ id: "sess-super" }),
      home: dir,
      nowIso: "2026-09-02T04:47:00.000Z",
      ownWorkspaceId: "ws-1",
      pinnedWorkspaceId: "ws-2",
      workspaceRef: "workspace:940",
    });
    expect(wrote).toBe(false);
    expect(existsSync(supervisorPinPath({ home: dir }))).toBe(false);
  });

  it("records nothing when the caller's own workspace could not be resolved", () => {
    const dir = home();
    expect(
      recordSupervisorPin({
        detection: active({ id: "sess-super" }),
        home: dir,
        nowIso: "2026-09-02T04:47:00.000Z",
        ownWorkspaceId: undefined,
        pinnedWorkspaceId: "ws-1",
        workspaceRef: "workspace:936",
      }),
    ).toBe(false);
  });

  it("records nothing outside a visible session", () => {
    const dir = home();
    expect(
      recordSupervisorPin({
        detection: { kind: "missing" },
        home: dir,
        nowIso: "2026-09-02T04:47:00.000Z",
        ownWorkspaceId: "ws-1",
        pinnedWorkspaceId: "ws-1",
        workspaceRef: "workspace:936",
      }),
    ).toBe(false);
  });

  it("replaces the predecessor's record rather than appending to it", () => {
    const dir = home();
    recordSupervisorPin({
      detection: active({ id: "sess-predecessor" }),
      home: dir,
      nowIso: "2026-09-02T03:00:00.000Z",
      ownWorkspaceId: "ws-old",
      pinnedWorkspaceId: "ws-old",
      workspaceRef: "workspace:900",
    });
    recordSupervisorPin({
      detection: active({ id: "sess-super" }),
      home: dir,
      nowIso: "2026-09-02T04:47:00.000Z",
      ownWorkspaceId: "ws-1",
      pinnedWorkspaceId: "ws-1",
      workspaceRef: "workspace:936",
    });
    expect(readSupervisorPin({ home: dir })!.session.id).toBe("sess-super");
  });

  it("reads back nothing from a home that has never recorded one", () => {
    expect(readSupervisorPin({ home: home() })).toBeUndefined();
  });

  it("removes a predecessor's record when the pin moves onto a DIFFERENT workspace it cannot name", () => {
    const dir = home();
    recordSupervisorPin({
      detection: active({ id: "sess-predecessor" }),
      home: dir,
      nowIso: "2026-09-02T03:00:00.000Z",
      ownWorkspaceId: "ws-old",
      pinnedWorkspaceId: "ws-old",
      workspaceRef: "workspace:900",
    });
    const wrote = recordSupervisorPin({
      detection: active({ id: "sess-predecessor" }),
      home: dir,
      nowIso: "2026-09-02T04:47:00.000Z",
      ownWorkspaceId: "ws-old",
      pinnedWorkspaceId: "ws-2",
      workspaceRef: "workspace:940",
    });
    expect(wrote).toBe(false);
    expect(existsSync(supervisorPinPath({ home: dir }))).toBe(false);
  });

  it("keeps the record when the pin lands on the very workspace it already names", () => {
    const dir = home();
    recordSupervisorPin({
      detection: active({ id: "sess-super" }),
      home: dir,
      nowIso: "2026-09-02T03:00:00.000Z",
      ownWorkspaceId: "ws-1",
      pinnedWorkspaceId: "ws-1",
      workspaceRef: "workspace:936",
    });
    recordSupervisorPin({
      detection: { kind: "missing" },
      home: dir,
      nowIso: "2026-09-02T04:47:00.000Z",
      ownWorkspaceId: "ws-other",
      pinnedWorkspaceId: "ws-1",
      workspaceRef: "workspace:936",
    });
    expect(readSupervisorPin({ home: dir })!.session.id).toBe("sess-super");
  });
});

describe("recordAppSupervisorPin", () => {
  const APP_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60";

  it("writes the app arm and appends an app link to the chain", () => {
    const dir = home();
    const wrote = recordAppSupervisorPin({
      appSessionId: APP_ID,
      home: dir,
      nowIso: "2026-09-02T04:47:00.000Z",
      session: { host: "codex", id: "thread-1" },
    });

    expect(wrote).toBe(true);
    expect(readSupervisorPin({ home: dir })).toStrictEqual({
      appSessionId: APP_ID,
      pinnedAtIso: "2026-09-02T04:47:00.000Z",
      session: { host: "codex", id: "thread-1" },
    });
    expect(readSupervisorChain({ home: dir })).toStrictEqual([
      {
        appSessionId: APP_ID,
        pinnedAtIso: "2026-09-02T04:47:00.000Z",
        session: { host: "codex", id: "thread-1" },
        source: "pin",
      },
    ]);
    // The app-hosted Codex chair records no home, so its owner turns read as UNRECORDED rather than a guessed home.
    expect(
      unwrapErr(
        recordedChairCodexHome({
          links: [...readSupervisorChain({ home: dir }), ...pinAsLink({ home: dir })],
          session: { host: "codex", id: "thread-1" },
        }),
      ).code,
    ).toBe("CODEX_HOME_UNRECORDED");
  });

  it("is never forgotten by a cmux unpin or by a cmux pin of somebody else's workspace", () => {
    const dir = home();
    recordAppSupervisorPin({
      appSessionId: APP_ID,
      home: dir,
      nowIso: "2026-09-02T04:47:00.000Z",
      session: { host: "claude-code", id: "sess-super" },
    });

    expect(forgetUnpinnedSupervisor({ home: dir, unpinnedWorkspaceId: APP_ID })).toBe("absent");
    expect(
      recordSupervisorPin({
        detection: active({ id: "sess-other" }),
        home: dir,
        nowIso: "2026-09-02T05:00:00.000Z",
        ownWorkspaceId: "ws-1",
        pinnedWorkspaceId: "ws-2",
        workspaceRef: "workspace:940",
      }),
    ).toBe(false);
    expect(readSupervisorPin({ home: dir })!.session.id).toBe("sess-super");
  });
});

describe("forgetUnpinnedSupervisor", () => {
  it("removes the record naming the workspace just unpinned, and leaves one naming another", () => {
    const dir = home();
    recordSupervisorPin({
      detection: active({ id: "sess-super" }),
      home: dir,
      nowIso: "2026-09-02T04:47:00.000Z",
      ownWorkspaceId: "ws-1",
      pinnedWorkspaceId: "ws-1",
      workspaceRef: "workspace:936",
    });

    expect(forgetUnpinnedSupervisor({ home: dir, unpinnedWorkspaceId: "ws-2" })).toBe("absent");
    expect(readSupervisorPin({ home: dir })!.session.id).toBe("sess-super");
    expect(forgetUnpinnedSupervisor({ home: dir, unpinnedWorkspaceId: "ws-1" })).toBe("removed");
    expect(existsSync(supervisorPinPath({ home: dir }))).toBe(false);
  });

  it("is a no-op on a home with no record", () => {
    expect(forgetUnpinnedSupervisor({ home: home(), unpinnedWorkspaceId: "ws-1" })).toBe("absent");
  });

  it("reports failed, never absent, when the stale record will not go", () => {
    const dir = home();
    recordSupervisorPin({
      detection: active({ id: "sess-super" }),
      home: dir,
      nowIso: "2026-09-02T04:47:00.000Z",
      ownWorkspaceId: "ws-1",
      pinnedWorkspaceId: "ws-1",
      workspaceRef: "workspace:936",
    });
    const sessions = dirname(supervisorPinPath({ home: dir }));
    chmodSync(sessions, 0o500);
    try {
      expect(forgetUnpinnedSupervisor({ home: dir, unpinnedWorkspaceId: "ws-1" })).toBe("failed");
      expect(pinnedCmuxWorkspaceId({ pin: readSupervisorPin({ home: dir }) })).toBe("ws-1");
    } finally {
      chmodSync(sessions, 0o700);
    }
  });
});
