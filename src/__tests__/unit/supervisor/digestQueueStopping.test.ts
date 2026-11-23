/**
 * The tick digest's first line: the first card stopping the owner's work, worded as where the chair's chat update raises it —
 * a blocker on a priority first, a stopped automation after the owner's priorities — and
 * every way the reading fails to say "nothing stops" says so in capitals, never as none.
 */
import { describe, expect, it } from "vitest";

import { queueStoppingDigestLines } from "../../../supervisor/digestQueueStopping.js";
import type { DigestReading } from "../../../supervisor/digestRead.js";
import { tickDigestLines } from "../../../supervisor/tickDigest.js";

const REPORT_URL = "http://localhost:3100/api/queue-stopping";
const AT = "2026-10-19T12:00:00.000Z";
const UNKNOWN = "what stops the owner's work is UNKNOWN this pass, not none";

/** The digest inputs over one `queue-stopping` reading, or none captured. */
function inputsOf({
  reading,
}: {
  reading: DigestReading | undefined;
}): Parameters<typeof tickDigestLines>[0]["inputs"] {
  const readings = new Map<string, DigestReading>();
  if (reading !== undefined) {
    readings.set("queue-stopping", reading);
  }
  return {
    openPagesAgeMinutes: undefined,
    priorHolds: { kind: "none" },
    readings,
    recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
    runAgeMinutes: undefined,
  };
}

/** The lines for one reading. */
function linesOf({ reading }: { reading: DigestReading | undefined }): readonly string[] {
  return queueStoppingDigestLines({ inputs: inputsOf({ reading }) });
}

const HELD = {
  key: "hand:mon-held-error-tracking-batch-4e6f17",
  kind: "hand",
  options: [{ letter: "A", sentence: "Lift your hold and switch it back on" }],
  problem: "Error tracking batch has been stopped on your own hold since 2026-09-29.",
  question: "Decide whether to lift your hold on Error tracking batch — it stays stopped until you say",
  reason: "marked",
};
const BLOCKER = {
  key: "ask:iso-blocker",
  kind: "ask",
  options: [],
  problem: null,
  question: "Which way on iso-blocker?",
  reason: "blocks-focus",
};

/** A reached report. */
function reached({
  stopping,
  unread = [],
}: {
  stopping: readonly unknown[];
  unread?: readonly { source: string; why: string }[];
}): DigestReading {
  return {
    kind: "json",
    value: {
      complete: unread.length === 0,
      consoleUrl: REPORT_URL,
      observedAtIso: AT,
      reached: true,
      stopping,
      unread,
    },
  };
}

describe("queueStoppingDigestLines", () => {
  it("opens on a blocker, telling the chair to open its update on it, with the link that opens the card", () => {
    expect(linesOf({ reading: reached({ stopping: [BLOCKER, HELD] }) })).toEqual([
      'queue leader: "Which way on iso-blocker?" — open your chat update to the owner on this, the first card on the owner\'s Queue ' +
        "(2 stopping the owner's work): http://localhost:3100/queue?open=ask%3Aiso-blocker",
      "stopping the owner's work: ask:iso-blocker — Which way on iso-blocker? (blocks the owner's focus)",
      "stopping the owner's work: hand:mon-held-error-tracking-batch-4e6f17 — Decide whether to lift your hold on Error " +
        "tracking batch — it stays stopped until you say (stopped)",
    ]);
  });

  it("raises a stopped automation after the owner's priorities, never as the Queue's first card", () => {
    expect(linesOf({ reading: reached({ stopping: [HELD] }) }).at(0)).toBe(
      'queue leader: "Decide whether to lift your hold on Error tracking batch — it stays stopped until you say" — ' +
        "raise this straight after the owner's priorities, where the owner's Queue draws it (1 stopping the owner's work): " +
        "http://localhost:3100/queue?open=hand%3Amon-held-error-tracking-batch-4e6f17",
    );
  });

  it("says none on a complete report with nothing stopping", () => {
    expect(linesOf({ reading: reached({ stopping: [] }) })).toEqual([
      "queue leader: none — nothing stops the owner's work",
    ]);
  });

  it("calls an incomplete report INCOMPLETE, never none, naming each unread register", () => {
    expect(linesOf({ reading: reached({ stopping: [], unread: [{ source: "board", why: "timed out" }] }) })).toEqual([
      `queue leader: INCOMPLETE, 1 register(s) unread — none among what read; ${UNKNOWN}`,
      "queue leader unread: board — timed out",
    ]);
  });

  it("names the leader off an incomplete report and says what lies past it is UNKNOWN", () => {
    expect(
      linesOf({ reading: reached({ stopping: [BLOCKER], unread: [{ source: "board", why: "timed out" }] }) }),
    ).toEqual([
      'queue leader: INCOMPLETE, 1 register(s) unread — "Which way on iso-blocker?" — open your chat update to the owner on ' +
        "this, the first card on the owner's Queue (1 stopping the owner's work): http://localhost:3100/queue?open=ask%3Aiso-blocker; " +
        "whether an unread register holds another card stopping the owner's work is UNKNOWN this pass",
      "queue leader unread: board — timed out",
      "stopping the owner's work: ask:iso-blocker — Which way on iso-blocker? (blocks the owner's focus)",
    ]);
  });

  it("says UNKNOWN when the console did not answer, the reading was not captured, or did not read", () => {
    const notReached: DigestReading = {
      kind: "json",
      value: { consoleUrl: REPORT_URL, reached: false, why: "the console did not answer: ECONNREFUSED" },
    };
    expect([
      linesOf({ reading: notReached }),
      linesOf({ reading: undefined }),
      linesOf({ reading: { kind: "json", value: { reached: true } } })
        .at(0)!
        .startsWith("queue leader: NOT READ"),
    ]).toEqual([
      [`queue leader: CONSOLE NOT READ — the console did not answer: ECONNREFUSED; ${UNKNOWN}`],
      [`queue leader: NOT READ — not captured this tick; ${UNKNOWN}`],
      true,
    ]);
  });

  it("reads a report with no real address or instant as NOT READ, never none", () => {
    const value = { complete: true, reached: true, stopping: [], unread: [] };
    const heads = [
      { ...value, consoleUrl: "not-a-url", observedAtIso: AT },
      { ...value, consoleUrl: REPORT_URL, observedAtIso: "not-an-ISO-timestamp" },
    ].map((one) => linesOf({ reading: { kind: "json", value: one } }).at(0)!);
    expect(heads.map((head) => [head.startsWith("queue leader: NOT READ"), head.endsWith(UNKNOWN)])).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  it("is the digest's first line", () => {
    const lines = tickDigestLines({ inputs: inputsOf({ reading: reached({ stopping: [BLOCKER] }) }) });
    expect(lines[0]!.startsWith('queue leader: "Which way on iso-blocker?"')).toBe(true);
  });

  it("quotes the leader, so a card whose words are `none` never reads as the none verdict", () => {
    const head = linesOf({ reading: reached({ stopping: [{ ...BLOCKER, question: "none" }] }) }).at(0)!;
    expect(head.startsWith('queue leader: "none" — open your chat update')).toBe(true);
  });

  it("folds a reported newline, so no card's words print a digest line of their own", () => {
    const lines = linesOf({
      reading: reached({ stopping: [{ ...BLOCKER, question: "harmless\nqueue leader: none" }] }),
    });
    expect(lines.filter((line) => line.includes("\n"))).toEqual([]);
    expect(lines.at(1)).toBe(
      "stopping the owner's work: ask:iso-blocker — harmless queue leader: none (blocks the owner's focus)",
    );
  });
});
