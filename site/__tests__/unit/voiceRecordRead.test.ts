/*
 * The voice record's one read: its batches bounded by one deadline on the server, inside the browser's own, and each
 * reading in the browser turned into its own state by slug. How a batch's lines become readings is
 * `voiceRecordBatch.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  RECORD_READ_DEADLINE_MS,
  SHARED_READ_WINDOW_MS,
  sharesReadUnderWay,
  voiceRecordOf,
} from "../../components/voice/freshVoiceRecord";
import { VOICE_RECORD_SOURCES } from "../../components/voice/voiceRecordSources";
import type { LiveResult } from "../../lib/liveVerbRun";
import { liveVerbFor } from "../../lib/liveVerbs";
import { spawnSettleBoundMs } from "../../lib/spawnVerb";
import { TOOL_TIMEOUT_MS } from "../../lib/talkToolsList";
import { QUEUE_SCREEN_RESERVE_MS } from "../../lib/voiceRecordQueue";
import {
  VOICE_RECORD_SERVER_DEADLINE_MS,
  VOICE_RECORD_SLUGS,
  voiceRecordTimeLeftMs,
  voiceRecordVerb,
} from "../../lib/voiceRecordRead";

const AT = "2026-11-09T00:00:00.000Z";

// A tool asked seconds into another's read could miss a card added in between.
describe("sharesReadUnderWay", () => {
  it("shares a read begun in the same instant, as one model turn's parallel calls are", () => {
    expect(
      [0, 1, SHARED_READ_WINDOW_MS].map((late) => sharesReadUnderWay({ nowMs: 5000 + late, startedAtMs: 5000 })),
    ).toEqual([true, true, true]);
  });

  it("reads again for a call later than that, or when no read is under way", () => {
    expect([
      sharesReadUnderWay({ nowMs: 5000 + SHARED_READ_WINDOW_MS + 1, startedAtMs: 5000 }),
      sharesReadUnderWay({ nowMs: 11_000, startedAtMs: 5000 }),
      sharesReadUnderWay({ nowMs: 5000, startedAtMs: undefined }),
    ]).toEqual([false, false, false]);
  });
});

// The record, the screen asks after it, and the server's answer all inside the tool's twenty.
describe("the Queue tool's one deadline", () => {
  it("leaves the screen asks their reserve, and the server answers two seconds inside the browser's read", () => {
    expect([
      TOOL_TIMEOUT_MS,
      RECORD_READ_DEADLINE_MS,
      QUEUE_SCREEN_RESERVE_MS,
      VOICE_RECORD_SERVER_DEADLINE_MS,
    ]).toEqual([20_000, 17_000, 3000, 15_000]);
    expect(RECORD_READ_DEADLINE_MS + QUEUE_SCREEN_RESERVE_MS).toBe(TOOL_TIMEOUT_MS);
  });
});

/**
 * A reading that says it could not be measured, which every source's reader turns into its own `not-measured` state.
 *
 * @param slug the source it stands for
 * @returns the reading
 */
function unmeasured({ slug }: { slug: string }): LiveResult {
  return { notMeasured: `${slug} unmeasured`, observedAtIso: AT, ok: false };
}

describe("voiceRecordTimeLeftMs: no batch outlives the read it was started for", () => {
  const STARTED = 1_000_000;
  const DEADLINE = STARTED + VOICE_RECORD_SERVER_DEADLINE_MS;

  it("gives a batch launched at once the whole fifteen seconds", () => {
    expect(voiceRecordTimeLeftMs({ deadlineAtMs: DEADLINE, nowMs: STARTED })).toBe(15_000);
  });

  it("gives a batch launched late only what is left, so every batch dies at the same instant", () => {
    const launches = [0, 4_000, 14_500].map((late) => STARTED + late);
    const killedAt = launches.map((nowMs) => nowMs + voiceRecordTimeLeftMs({ deadlineAtMs: DEADLINE, nowMs })!);
    expect(killedAt).toEqual([DEADLINE, DEADLINE, DEADLINE]);
  });

  it("launches nothing once the deadline has passed", () => {
    expect([DEADLINE, DEADLINE + 1].map((nowMs) => voiceRecordTimeLeftMs({ deadlineAtMs: DEADLINE, nowMs }))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("settles a batch killed at the deadline inside the browser's read, its pipe drain included", () => {
    expect(spawnSettleBoundMs({ timeoutMs: VOICE_RECORD_SERVER_DEADLINE_MS })).toBe(16_000);
    expect(spawnSettleBoundMs({ timeoutMs: VOICE_RECORD_SERVER_DEADLINE_MS })).toBeLessThan(RECORD_READ_DEADLINE_MS);
  });
});

describe("voiceRecordVerb: no lone child outlives the read it was started for", () => {
  const board = liveVerbFor({ slug: "board" })!;
  const STARTED = 1_000_000;
  const DEADLINE = STARTED + VOICE_RECORD_SERVER_DEADLINE_MS;

  it("kills a verb whose page bound is longer at the read's own deadline, and runs the same argv", () => {
    expect(board.timeoutMs).toBeGreaterThan(VOICE_RECORD_SERVER_DEADLINE_MS);
    expect(voiceRecordVerb({ deadlineAtMs: DEADLINE, nowMs: STARTED, verb: board })).toEqual({
      ...board,
      timeoutMs: VOICE_RECORD_SERVER_DEADLINE_MS,
    });
  });

  it("gives a child launched late only what is left, and launches nothing once the deadline has passed", () => {
    expect([
      voiceRecordVerb({ deadlineAtMs: DEADLINE, nowMs: STARTED + 14_500, verb: board })!.timeoutMs,
      voiceRecordVerb({ deadlineAtMs: DEADLINE, nowMs: DEADLINE, verb: board }),
    ]).toEqual([500, undefined]);
  });

  it("keeps a bound already inside what is left", () => {
    const quick = { ...board, timeoutMs: 5_000 };
    expect(voiceRecordVerb({ deadlineAtMs: DEADLINE, nowMs: STARTED, verb: quick })).toBe(quick);
  });
});

describe("voiceRecordOf", () => {
  it("reads each source from its own slug's reading", () => {
    const readings = Object.fromEntries(Object.values(VOICE_RECORD_SLUGS).map((slug) => [slug, unmeasured({ slug })]));
    const record = voiceRecordOf({ arrival: { body: { readings }, kind: "body" } });
    expect(Object.keys(record).toSorted()).toEqual(Object.keys(VOICE_RECORD_SOURCES).toSorted());
    expect([record.board, record.steers]).toEqual([
      { phase: "not-measured", why: "board unmeasured" },
      { phase: "not-measured", why: "talk-steers unmeasured" },
    ]);
  });

  it("names a slug the body does not carry, and a body that is not one, never reading either as empty", () => {
    const partial = voiceRecordOf({ arrival: { body: { readings: {} }, kind: "body" } });
    const bad = voiceRecordOf({ arrival: { body: [], kind: "body" } });
    expect([partial.hands, bad.hands]).toEqual([
      { phase: "not-measured", why: "the voice record read carried no reading of hands" },
      { phase: "not-measured", why: "the voice record read answered with something that is not one" },
    ]);
  });

  it("names every source unread with the fetch's own reason when it failed", () => {
    const record = voiceRecordOf({
      arrival: { kind: "failed", why: "the voice record read did not answer within 17 s" },
    });
    expect(Object.values(record).every((state) => state.phase === "not-measured")).toBe(true);
    expect(record.landing).toEqual({ phase: "not-measured", why: "the voice record read did not answer within 17 s" });
  });
});
