/**
 * `cmux takeover`'s steps 4–6 over a GONE predecessor, against a real pin record, ledger and run journal in a
 * throwaway home: the gone chair's exact record goes, this session is seated, and the chair's ledger row is ended —
 * with no host asked to close anything, since none holds it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recordAppSupervisorPin, recordSupervisorPin } from "../../../cli/commands/cmux/recordPin.js";
import { gonePredecessorRunGate } from "../../../cli/commands/cmux/takeoverGone.js";
import type { GatedPredecessor } from "../../../cli/commands/cmux/takeoverHosts.js";
import { performTakeover } from "../../../cli/commands/cmux/takeoverSteps.js";
import { EXIT_ERROR, EXIT_OK } from "../../../cli/exitCodes.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { readSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import type { VisibleSupervisorSession } from "../../../supervisor/session.js";
import { fakeCmux, hostOverFake } from "../sessionHarness/fakeCmux.js";
import {
  chairRun,
  GONE_APP_ID,
  GONE_AT,
  GONE_CMUX_TARGET,
  GONE_TARGET,
  spawnedChair,
  spawnedCmuxChair,
} from "./goneChairFixture.js";

const SUCCESSOR_APP_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const GONE_SESSION: VisibleSupervisorSession = { host: "claude-code", id: "gone-chair-session" };
const SUCCESSOR_SESSION: VisibleSupervisorSession = { host: "claude-code", id: "successor-session" };

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "takeover-steps-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The gone chair as the pin record names it, its run reaped orphaned, gated through gate (c). */
function goneChair(): GatedPredecessor {
  recordAppSupervisorPin({ appSessionId: GONE_APP_ID, home, nowIso: GONE_AT, session: GONE_SESSION });
  spawnedChair({ home });
  chairRun({ home, orphaned: true });
  const gate = gonePredecessorRunGate({ home, target: GONE_TARGET });
  if ("refusal" in gate) {
    throw new Error(`gate (c) refused: ${gate.refusal}`);
  }
  return { kind: "gone", run: gate, target: GONE_TARGET };
}

/** Steps 4–6 for an app successor, over a cmux client and an app harness neither of which is scripted to be called. */
function takeOver({ predecessor }: { predecessor: GatedPredecessor }): Promise<number> {
  return performTakeover({
    appHarness: {
      close: () => {
        throw new Error("a gone chair is never closed through the app");
      },
    },
    caller: { appSessionId: SUCCESSOR_APP_ID, kind: "app" },
    client: hostOverFake({ client: fakeCmux({}).client }),
    home,
    predecessor,
    session: SUCCESSOR_SESSION,
  });
}

/** The ledger's rows under the throwaway home, by status. */
function ledgerStatuses(): string[] {
  return foldSessions({ events: parseSessionLog({ text: readSessionLogText({ home }) }).events }).map(
    (item) => item.status,
  );
}

describe("performTakeover over a gone predecessor", () => {
  it("replaces the gone chair's record with this session's and ends the chair's ledger row", async () => {
    expect(await takeOver({ predecessor: goneChair() })).toBe(EXIT_OK);
    expect(readSupervisorPin({ home })).toEqual(
      expect.objectContaining({ appSessionId: SUCCESSOR_APP_ID, session: SUCCESSOR_SESSION }),
    );
    expect(ledgerStatuses()).toEqual(["closed"]);
  });

  it("exits non-zero and leaves both rows open when a twin sharing the chair's address appeared after gate (c)", async () => {
    const predecessor = goneChair();
    spawnedChair({ home });
    expect(await takeOver({ predecessor })).toBe(EXIT_ERROR);
    expect(ledgerStatuses()).toEqual(["open", "open"]);
  });

  it("forgets a gone cmux chair's record by its workspace id and ends its cmux ledger row", async () => {
    expect(await takeOver({ predecessor: goneCmuxChair() })).toBe(EXIT_OK);
    expect(readSupervisorPin({ home })).toEqual(
      expect.objectContaining({ appSessionId: SUCCESSOR_APP_ID, session: SUCCESSOR_SESSION }),
    );
    expect(ledgerStatuses()).toEqual(["closed"]);
  });
});

/** A gone CMUX chair as its pin record names it, its run reaped orphaned, gated through gate (c). */
function goneCmuxChair(): GatedPredecessor {
  recordSupervisorPin({
    detection: { kind: "active", session: GONE_SESSION },
    home,
    nowIso: GONE_AT,
    ownWorkspaceId: GONE_CMUX_TARGET.workspaceId,
    pinnedWorkspaceId: GONE_CMUX_TARGET.workspaceId,
    workspaceRef: GONE_CMUX_TARGET.workspaceRef,
  });
  spawnedCmuxChair({ home });
  chairRun({ home, orphaned: true });
  const gate = gonePredecessorRunGate({ home, target: GONE_CMUX_TARGET });
  if ("refusal" in gate) {
    throw new Error(`gate (c) refused: ${gate.refusal}`);
  }
  return { kind: "gone", run: gate, target: GONE_CMUX_TARGET };
}
