/*
 * The owner's utterance holds the floor from its first delta to its `done`, whatever the transcript's gaps. Measured:
 * the live text froze for 72s while the owner talked, and the floor read that as quiet. Replayed at the call file's
 * own instants.
 */
import { describe, expect, it } from "vitest";

import {
  closeUserUtteranceOnResume,
  foldUserUtterance,
  NO_USER_UTTERANCE,
  OPEN_UTTERANCE_MAX_MS,
  userUtteranceAfterResumeRefused,
  userUtteranceOpen,
} from "../../lib/talkPlanUtterance";

/** The owner's bug report's partials either side of the stall, the triage line's taking, and its `done`. */
const STALL_FROM = Date.parse("2026-10-22T10:41:19.849Z");
const TRIAGE_DUE = Date.parse("2026-10-22T10:42:43.500Z");
const DONE = Date.parse("2026-10-22T10:43:07.970Z");

/** The owner's utterance as it stood through the stall: one delta, no `done`. */
const OPEN = foldUserUtterance({ atMs: STALL_FROM, phase: "delta", state: NO_USER_UTTERANCE });

describe("userUtteranceOpen", () => {
  it("keeps the utterance open across the transcript stall", () => {
    expect(OPEN).toEqual({ lastDeltaMs: STALL_FROM, open: true });
    expect(userUtteranceOpen({ nowMs: TRIAGE_DUE, state: OPEN })).toBe(true);
  });

  it("closes the utterance on its done", () => {
    const state = foldUserUtterance({ atMs: DONE, phase: "done", state: OPEN });
    expect(state).toEqual({ lastDeltaMs: STALL_FROM, open: false });
    expect(userUtteranceOpen({ nowMs: DONE, state })).toBe(false);
  });

  it("expires a lost done at the ten-minute ceiling, but not one millisecond before", () => {
    expect(userUtteranceOpen({ nowMs: STALL_FROM + OPEN_UTTERANCE_MAX_MS - 1, state: OPEN })).toBe(true);
    expect(userUtteranceOpen({ nowMs: STALL_FROM + OPEN_UTTERANCE_MAX_MS, state: OPEN })).toBe(false);
  });

  it("is closed before the owner has said anything", () => {
    expect(userUtteranceOpen({ nowMs: DONE, state: NO_USER_UTTERANCE })).toBe(false);
  });
});

// A resume the session refuses must not leave the owner's utterance closed.
describe("userUtteranceAfterResumeRefused", () => {
  const closed = closeUserUtteranceOnResume({ state: OPEN });

  it("puts back the utterance the resume closed when nothing of the owner's arrived since", () => {
    expect(closed).toEqual({ lastDeltaMs: STALL_FROM, open: false });
    expect(userUtteranceAfterResumeRefused({ before: OPEN, closed, now: closed })).toBe(OPEN);
  });

  it("keeps a delta or a done of the owner's that arrived while the resume was being handed", () => {
    const reopened = foldUserUtterance({ atMs: TRIAGE_DUE, phase: "delta", state: closed });
    const done = foldUserUtterance({ atMs: DONE, phase: "done", state: closed });
    expect([
      userUtteranceAfterResumeRefused({ before: OPEN, closed, now: reopened }),
      userUtteranceAfterResumeRefused({ before: OPEN, closed, now: done }),
    ]).toEqual([
      { lastDeltaMs: TRIAGE_DUE, open: true },
      { lastDeltaMs: STALL_FROM, open: false },
    ]);
  });
});
