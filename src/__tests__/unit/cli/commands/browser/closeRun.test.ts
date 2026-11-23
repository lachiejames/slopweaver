import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readInteractionSession, writeInteractionSession } from "../../../../../browser/interactionSessionStore.js";
import { holdBrowserSession } from "../../../../../browser/sessionLock.js";
import { runBrowserClose } from "../../../../../cli/commands/browser/closeRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { unavailableRecordedProfilePort } from "../../../../recordedProfileFixture.js";

const ID = "5f2a1c30-0000-4000-8000-0000000000c1";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "close-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const STORED = {
  observation: null,
  session: {
    clientSession: "slopweaver-5f2a1c30",
    id: ID,
    openedAtIso: "2026-09-16T08:00:00.000Z",
    origins: [],
    owner: { cmuxWorkspace: null, pid: 4242, runSlug: null },
    ownerSessionId: "agent-1",
    placement: "background" as const,
    touchedAtIso: "2026-09-16T08:00:00.000Z",
    workspace: "/nowhere/client",
  },
};

describe("runBrowserClose", () => {
  it("closes NOTHING and keeps the record while a reap holds the session's lock", async () => {
    writeInteractionSession({ home, stored: STORED });
    const reap = unwrap(holdBrowserSession({ home, id: ID, nowIso: new Date().toISOString() }));

    const code = await runBrowserClose({ home, profiles: unavailableRecordedProfilePort(), sessionId: ID });
    reap.release();

    expect(code).toBe(EXIT_ERROR);
    expect(readInteractionSession({ home, id: ID })).toEqual(STORED);
  });

  it("answers nothing-to-close for a session with no record, and releases its lock for the next caller", async () => {
    const first = await runBrowserClose({ home, profiles: unavailableRecordedProfilePort(), sessionId: ID });
    const second = await runBrowserClose({ home, profiles: unavailableRecordedProfilePort(), sessionId: ID });

    expect([first, second]).toEqual([EXIT_OK, EXIT_OK]);
  });
});
