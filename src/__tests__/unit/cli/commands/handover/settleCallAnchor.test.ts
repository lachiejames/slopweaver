import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callAnchorReceipt, unreadTurnReading } from "../../../../../cli/commands/handover/settleCallAnchor.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { callIndexPath } from "../../../../../talk/callStore.js";
import { readTurn } from "../../../../../talk/relayStore.js";

const CALL = "7b8bdb47-ae28-4ec4-a01e-780b7a5458a8";
const OTHER = "a0000071-0000-4000-8000-000000000077";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "settle-call-anchor-"));
  mkdirSync(dirname(callIndexPath({ home })), { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The real failure `readTurn` gives for `CALL`'s turn as the home now stands. */
const turnError = () => unwrapErr(readTurn({ home, turnId: CALL }));

const reading = () => unreadTurnReading({ anchor: `talk:${CALL}`, home, turnError: turnError() });

describe("unreadTurnReading", () => {
  it("answers the call id a talk: anchor holds", () => {
    writeFileSync(callIndexPath({ home }), `${CALL}\n`);
    expect(unwrap(reading())).toEqual({ call: CALL, kind: "call" });
  });

  it("reads an absent turn whose id no call carries as absent, never as a call", () => {
    writeFileSync(callIndexPath({ home }), `${OTHER}\n`);
    expect(unwrap(reading())).toEqual({ kind: "absent" });
  });

  it("reads an absent turn as absent when no call store exists at all", () => {
    expect(unwrap(reading())).toEqual({ kind: "absent" });
  });

  it("refuses a turn file that is there but damaged, carrying the turn's own reason", () => {
    writeFileSync(callIndexPath({ home }), `${OTHER}\n`);
    const turns = stateHomePaths({ home }).talkTurns;
    mkdirSync(turns, { recursive: true });
    writeFileSync(join(turns, `${CALL}.json`), "{ not json");
    const refused = unwrapErr(reading());
    expect(refused.code).toBe("RELAY_TURN_UNREADABLE");
    expect(refused.message).toContain(`${CALL}.json`);
  });

  it("refuses a turn that appeared after the caller's read, never reading it as absent", () => {
    const stale = turnError();
    expect(stale.message).toContain("ENOENT");
    const turns = stateHomePaths({ home }).talkTurns;
    mkdirSync(turns, { recursive: true });
    writeFileSync(join(turns, `${CALL}.json`), "{ not json");
    const refused = unwrapErr(unreadTurnReading({ anchor: `talk:${CALL}`, home, turnError: stale }));
    expect(refused.code).toBe("RELAY_TURN_UNREADABLE");
  });

  it("refuses a turn the caller saw damaged that is gone by the second read, never reading it as absent", () => {
    const turns = stateHomePaths({ home }).talkTurns;
    mkdirSync(turns, { recursive: true });
    writeFileSync(join(turns, `${CALL}.json`), "{ not json");
    const damaged = turnError();
    rmSync(join(turns, `${CALL}.json`));
    const refused = unwrapErr(unreadTurnReading({ anchor: `talk:${CALL}`, home, turnError: damaged }));
    expect(refused.code).toBe("RELAY_TURN_UNREADABLE");
  });

  it("reads an absent turn whose call store cannot say as call-unproven, carrying the store's reason", () => {
    writeFileSync(callIndexPath({ home }), "not-a-call-id\n");
    const read = unwrap(reading());
    expect(read.kind).toBe("call-unproven");
    expect(JSON.stringify(read)).toContain("call-index.txt");
    expect(JSON.stringify(read)).not.toContain(`${CALL}.json`);
  });
});

describe("callAnchorReceipt", () => {
  it("says the anchor was read as the call it holds", () => {
    expect(callAnchorReceipt({ anchor: `talk:${CALL}`, call: CALL })).toEqual([
      `  talk:${CALL} holds call id ${CALL}, not a relay turn's, so it was read as that call: no relay card to answer for`,
    ]);
  });

  it("says nothing for an anchor that named a relay, or no anchor", () => {
    expect(callAnchorReceipt({ anchor: `talk:${CALL}`, call: undefined })).toEqual([]);
    expect(callAnchorReceipt({ anchor: undefined, call: undefined })).toEqual([]);
  });
});
