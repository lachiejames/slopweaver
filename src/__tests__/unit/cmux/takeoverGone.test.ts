/**
 * `cmux takeover`'s gate (c) and step 5 for a GONE predecessor, over a real ledger and run journal in a throwaway
 * home: a chair its host no longer holds is retired only once its run reached a terminal phase, and its ledger row
 * is ended on disk.
 */
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  endGonePredecessorRow,
  type GonePredecessorRun,
  gonePredecessorRunGate,
} from "../../../cli/commands/cmux/takeoverGone.js";
import { appendRunEvent } from "../../../handover/runStore.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { chairRun, GONE_APP_ID, GONE_SLUG, GONE_TARGET, spawnedChair } from "./goneChairFixture.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "takeover-gone-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Gate (c)'s passing arm for the chair, throwing on a refusal so a test acts only on a gate that passed. */
function passedGate(): GonePredecessorRun {
  const gate = gonePredecessorRunGate({ home, target: GONE_TARGET });
  if ("refusal" in gate) {
    throw new Error(`gate (c) refused: ${gate.refusal}`);
  }
  return gate;
}

/** The ledger's rows under the throwaway home, as `[key, status]` pairs. */
function ledgerRows(): (string | undefined)[][] {
  const rows = foldSessions({ events: parseSessionLog({ text: readSessionLogText({ home }) }).events });
  return rows.map((item) => [item.sessionKey, item.status]);
}

describe("gonePredecessorRunGate", () => {
  it("passes a gone chair whose run was reaped orphaned, naming its slug and row", () => {
    spawnedChair({ home });
    chairRun({ home, orphaned: true });
    expect(gonePredecessorRunGate({ home, target: GONE_TARGET })).toEqual({
      label: `app:${GONE_APP_ID}`,
      row: expect.objectContaining({ sessionId: GONE_APP_ID, sessionKey: GONE_SLUG }),
      slug: GONE_SLUG,
    });
  });

  it("refuses a gone chair whose run is still open, so the host's silence alone never retires it", () => {
    spawnedChair({ home });
    chairRun({ home, orphaned: false });
    expect(gonePredecessorRunGate({ home, target: GONE_TARGET })).toEqual({
      refusal: expect.stringContaining("(phase: open)"),
    });
  });

  it("refuses a finished cycle followed by a line that does not decode, which may be a newer run", () => {
    spawnedChair({ home });
    chairRun({ home, orphaned: true });
    appendFileSync(join(stateHomePaths({ home }).runs, `${GONE_SLUG}.jsonl`), '{"kind":"started"\n');
    expect(gonePredecessorRunGate({ home, target: GONE_TARGET })).toEqual({
      refusal: expect.stringContaining("line(s) this checkout could not decode"),
    });
  });

  it("refuses a finished cycle followed by a dispatch nothing answered, which may be a newer attempt", () => {
    spawnedChair({ home });
    chairRun({ home, orphaned: true });
    appendRunEvent({
      event: { atIso: "2026-11-05T10:30:00.000Z", by: "cmux spawn", kind: "dispatched", target: "workspace:9" },
      runsDir: stateHomePaths({ home }).runs,
      slug: GONE_SLUG,
    });
    expect(gonePredecessorRunGate({ home, target: GONE_TARGET })).toEqual({
      refusal: expect.stringContaining("ends on a dispatch nothing answered"),
    });
  });

  it("refuses a gone chair no open ledger row carries", () => {
    expect(gonePredecessorRunGate({ home, target: GONE_TARGET })).toEqual({
      refusal: expect.stringContaining("(0 open rows carry its id)"),
    });
  });
});

describe("endGonePredecessorRow", () => {
  it("ends the chair's open ledger row on disk", () => {
    spawnedChair({ home });
    chairRun({ home, orphaned: true });
    expect(endGonePredecessorRow({ home, nowIso: "2026-11-05T11:00:00.000Z", run: passedGate() })).toBe(true);
    expect(ledgerRows()).toEqual([[GONE_SLUG, "closed"]]);
  });

  it("leaves the row open when a twin sharing its address was written after gate (c), so the close would end both", () => {
    spawnedChair({ home });
    chairRun({ home, orphaned: true });
    const run = passedGate();
    spawnedChair({ home });
    expect(endGonePredecessorRow({ home, nowIso: "2026-11-05T11:00:00.000Z", run })).toBe(false);
    expect(ledgerRows()).toEqual([
      [GONE_SLUG, "open"],
      [GONE_SLUG, "open"],
    ]);
  });
});
