/**
 * The one-time import's file half, over a plain in-memory read keyed by path: the pair is imported whole or not
 * at all, an unreadable file is refused as such, and an imported fold resumes from its own high-water mark rather
 * than from a cursor file the old `cmux events` may have pushed past it.
 */
import { describe, expect, it } from "vitest";

import { CmuxEventStateErrors } from "../../../../cmux/eventState/errors.js";
import { type ReadImportText, sessionImport } from "../../../../cmux/eventState/importFiles.js";
import type { SessionActivity } from "../../../../cmux/sessionActivity.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";

const HOME = "/fixture-home";
const NOW = "2026-10-31T04:00:00.000Z";
const PATHS = stateHomePaths({ home: HOME });

/**
 * One activity, folded up to `lastSeq`.
 *
 * @param workspaceId the workspace it is for
 * @param lastSeq the last sequence folded into it
 * @returns the activity
 */
function activity({ workspaceId, lastSeq }: { workspaceId: string; lastSeq: number }): SessionActivity {
  return {
    agentSessionId: undefined,
    agentSource: undefined,
    attentionKind: undefined,
    attentionSinceIso: undefined,
    cwd: undefined,
    lastEventAtIso: "2026-10-31T03:00:00.000Z",
    lastEventName: "agent.hook.PreToolUse",
    lastSeq,
    lastTurnEndedAtIso: undefined,
    lastTurnStartedAtIso: undefined,
    sessionStartedAtIso: undefined,
    toolCalls: 1,
    workspaceId,
  };
}

/**
 * A read answering from a fixed table of file texts, absent for any path not in it.
 *
 * @param files each present file's text, by absolute path
 * @returns the read
 */
function readFrom({ files }: { files: Readonly<Record<string, string>> }): ReadImportText {
  return ({ path }) => ok(files[path]);
}

const W1 = activity({ lastSeq: 38, workspaceId: "W1" });
const W2 = activity({ lastSeq: 31, workspaceId: "W2" });
const FOLD_FILE = JSON.stringify({ activities: { W1, W2 }, recordedAtIso: NOW });
const CURSOR_FILE = JSON.stringify({ recordedAtIso: NOW, seq: 44 });

describe("sessionImport", () => {
  it("imports nothing from a home holding neither file", () => {
    const imported = unwrap(sessionImport({ home: HOME, readImportText: readFrom({ files: {} }) }));

    expect(imported).toBe(undefined);
  });

  it("resumes an imported pair after its fold's highest lastSeq, not the cursor file's later seq", () => {
    const files = { [PATHS.cmuxEventCursorJson]: CURSOR_FILE, [PATHS.cmuxSessionActivityJson]: FOLD_FILE };

    const imported = unwrap(sessionImport({ home: HOME, readImportText: readFrom({ files }) }));

    expect(imported).toEqual({ activities: { W1, W2 }, cursorSeq: 38 });
  });

  it("refuses a cursor file standing without its fold", () => {
    const files = { [PATHS.cmuxEventCursorJson]: CURSOR_FILE };

    const error = unwrapErr(sessionImport({ home: HOME, readImportText: readFrom({ files }) }));

    expect(error.code).toBe("CMUX_EVENT_IMPORT_INVALID");
    expect(error.message).toContain("so the events before its cursor were never folded");
  });

  it("refuses a fold standing without its cursor file", () => {
    const files = { [PATHS.cmuxSessionActivityJson]: FOLD_FILE };

    const error = unwrapErr(sessionImport({ home: HOME, readImportText: readFrom({ files }) }));

    expect(error.code).toBe("CMUX_EVENT_IMPORT_INVALID");
    expect(error.message).toContain("so resuming would fold its events a second time");
  });

  it("refuses an activity file that is not JSON, naming the activity file", () => {
    const files = { [PATHS.cmuxEventCursorJson]: CURSOR_FILE, [PATHS.cmuxSessionActivityJson]: "{torn" };

    const error = unwrapErr(sessionImport({ home: HOME, readImportText: readFrom({ files }) }));

    expect(error.code).toBe("CMUX_EVENT_IMPORT_INVALID");
    expect(error.message).toContain("the activity file: it is not JSON a reader can take");
  });

  it("refuses an activity envelope whose recordedAtIso is not a string", () => {
    const files = {
      [PATHS.cmuxEventCursorJson]: CURSOR_FILE,
      [PATHS.cmuxSessionActivityJson]: JSON.stringify({ activities: {}, recordedAtIso: 42 }),
    };

    const error = unwrapErr(sessionImport({ home: HOME, readImportText: readFrom({ files }) }));

    expect(error.code).toBe("CMUX_EVENT_IMPORT_INVALID");
    expect(error.message).toContain("the activity file: its recordedAtIso is neither absent nor a string");
  });

  it("imports an activity envelope that carries no recordedAtIso, as the retired reader did", () => {
    const files = {
      [PATHS.cmuxEventCursorJson]: CURSOR_FILE,
      [PATHS.cmuxSessionActivityJson]: JSON.stringify({ activities: { W1 } }),
    };

    const imported = unwrap(sessionImport({ home: HOME, readImportText: readFrom({ files }) }));

    expect(imported).toEqual({ activities: { W1 }, cursorSeq: 38 });
  });

  it("passes an unreadable file's refusal through unchanged", () => {
    const unreadable = CmuxEventStateErrors.importUnreadable({ path: PATHS.cmuxEventCursorJson, reason: "EACCES" });

    const error = unwrapErr(sessionImport({ home: HOME, readImportText: () => err(unreadable) }));

    expect(error).toEqual(unreadable);
  });
});
