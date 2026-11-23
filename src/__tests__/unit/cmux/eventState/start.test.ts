/**
 * Where `session watch` starts folding: the stored cursor and fold are one fact, so `--since` may resume them or
 * start an empty fold, and never move the cursor out from under a fold built to another one.
 */
import { describe, expect, it } from "vitest";

import type { SessionWatchState } from "../../../../cmux/eventState/port.js";
import { sessionWatchStart } from "../../../../cmux/eventState/start.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const NOTHING: SessionWatchState = { activities: {}, cursorSeq: undefined, revision: null };
const STORED: SessionWatchState = { activities: {}, cursorSeq: 90, revision: 4 };

describe("sessionWatchStart", () => {
  it("resumes the stored state when no --since was passed", () => {
    expect(unwrap(sessionWatchStart({ since: undefined, state: STORED }))).toEqual(STORED);
  });

  it("starts an empty fold at --since when nothing is stored", () => {
    expect(unwrap(sessionWatchStart({ since: 30, state: NOTHING }))).toEqual({ ...NOTHING, cursorSeq: 30 });
  });

  it("starts from the live edge when nothing is stored and no --since was passed", () => {
    expect(unwrap(sessionWatchStart({ since: undefined, state: NOTHING })).cursorSeq).toBeUndefined();
  });

  it("treats a --since naming the stored cursor as a resume", () => {
    expect(unwrap(sessionWatchStart({ since: 90, state: STORED }))).toEqual(STORED);
  });

  it("refuses a --since the stored fold does not stand at, naming the reset escape", () => {
    const error = unwrapErr(sessionWatchStart({ since: 30, state: STORED }));

    expect(error.code).toBe("CMUX_EVENT_SINCE_CONFLICT");
    expect([error.since, error.storedSeq]).toEqual([30, 90]);
    expect(error.message).toContain("--reset-state --since <seq>");
  });
});
