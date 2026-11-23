/*
 * The cmux hang judge's `classifyProbe`: one socket probe, plus the seats' newest call, read as answering, stalled,
 * unprobed, refused, silent or absent.
 */
import { describe, expect, it } from "vitest";

import { classifyProbe, MAX_READING_GAP_MS } from "../../../../cmux/hang.js";
import type { InsideCallEvidence } from "../../../../cmux/insideCalls.js";
import type { CmuxProbeState } from "../../../../cmux/reviveJournal.js";

describe("classifyProbe", () => {
  /** Classify at a fixed instant, the shipped gap, with the seats' newest call when one is given. */
  const classify = ({
    replied,
    connectRefused = false,
    appRunning = true,
    inside,
    answeredIso,
  }: {
    replied: boolean;
    connectRefused?: boolean;
    appRunning?: boolean;
    inside?: InsideCallEvidence;
    answeredIso?: string;
  }): CmuxProbeState =>
    classifyProbe({
      answeredIso,
      appRunning,
      connectRefused,
      inside,
      maxGapMs: MAX_READING_GAP_MS,
      nowIso: "2026-10-11T04:38:00.000Z",
      replied,
    });

  it("calls a reply answering once the seats' newest call was answered", () => {
    expect(classify({ inside: { atIso: "2026-10-11T03:00:00.000Z", outcome: "answered" }, replied: true })).toBe(
      "answering",
    );
  });

  it("calls a reply stalled while the seats' calls time out — an access refusal over hung handlers", () => {
    expect(classify({ inside: { atIso: "2026-10-11T04:37:00.000Z", outcome: "unanswered" }, replied: true })).toBe(
      "stalled",
    );
  });

  it("calls a reply answering when a call was answered within the gap, though a timeout came after it", () => {
    const inside = { atIso: "2026-10-11T04:37:00.000Z", outcome: "unanswered" } as const;
    expect([
      classify({ answeredIso: "2026-10-11T04:34:00.000Z", inside, replied: true }),
      classify({ answeredIso: "2026-10-11T04:32:00.000Z", inside, replied: true }),
    ]).toEqual(["answering", "stalled"]);
  });

  it("calls a reply unprobed with no seat call to judge it by, or only a timeout older than the gap", () => {
    const stale = { atIso: "2026-10-11T04:30:00.000Z", outcome: "unanswered" } as const;
    expect([classify({ replied: true }), classify({ inside: stale, replied: true })]).toEqual(["unprobed", "unprobed"]);
  });

  it("calls a refused connect while the app runs refused, whatever the seats heard", () => {
    expect(
      classify({
        connectRefused: true,
        inside: { atIso: "2026-10-11T04:37:00.000Z", outcome: "answered" },
        replied: false,
      }),
    ).toBe("refused");
  });

  it("calls a connect that never replied silent", () => {
    expect(classify({ replied: false })).toBe("silent");
  });

  it("calls no app absent, whatever the socket did", () => {
    expect(classify({ appRunning: false, connectRefused: true, replied: false })).toBe("absent");
  });
});
