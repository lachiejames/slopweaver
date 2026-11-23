/**
 * The staleness probe against a card that carries the turn clock: the clock moves every minute on its own,
 * so a card whose ONLY movement is the clock is still a frozen card to the probe.
 */
import { describe, expect, it } from "vitest";

import { changingWrites, openProgressGap, type ProgressLog } from "../../../../live/turn/progressLog.js";

const clockWrite = ({ detail, tsIso }: { detail: string; tsIso: string }) => ({
  detail,
  kind: "card-write" as const,
  stageCount: 0,
  tsIso,
});

describe("changingWrites — the turn clock is not a change", () => {
  it("folds writes that differ only in their clock into the first", () => {
    const writes = [
      clockWrite({ detail: "now: still working, 5m", tsIso: "2026-09-19T03:27:00.000Z" }),
      clockWrite({ detail: "now: still working, 6m", tsIso: "2026-09-19T03:28:30.000Z" }),
      clockWrite({ detail: "now: still working, 7m", tsIso: "2026-09-19T03:30:00.000Z" }),
    ];
    expect(changingWrites({ writes }).map((kept) => kept.tsIso)).toEqual(["2026-09-19T03:27:00.000Z"]);
  });

  it("keeps a write whose content moved as well as its clock", () => {
    const writes = [
      clockWrite({ detail: "now: still working, 5m", tsIso: "2026-09-19T03:27:00.000Z" }),
      clockWrite({
        detail: "now: still working, 9m · independent review, round 1 · open just now",
        tsIso: "2026-09-19T03:32:00.000Z",
      }),
    ];
    expect(changingWrites({ writes }).map((kept) => kept.tsIso)).toEqual([
      "2026-09-19T03:27:00.000Z",
      "2026-09-19T03:32:00.000Z",
    ]);
  });
});

describe("openProgressGap over a clock-only card", () => {
  it("still reports the stretch since the card last said something new", () => {
    const log: ProgressLog = {
      stages: [],
      timeline: [],
      warns: [],
      writes: [
        clockWrite({ detail: "now: still working, 1m", tsIso: "2026-09-19T03:23:40.000Z" }),
        clockWrite({ detail: "now: still working, 3m", tsIso: "2026-09-19T03:25:10.000Z" }),
        clockWrite({ detail: "now: still working, 4m", tsIso: "2026-09-19T03:26:40.000Z" }),
        clockWrite({ detail: "now: still working, 6m", tsIso: "2026-09-19T03:28:10.000Z" }),
        clockWrite({ detail: "now: still working, 7m", tsIso: "2026-09-19T03:29:40.000Z" }),
      ],
    };
    const gap = openProgressGap({
      boundMinutes: 5,
      log,
      nowIso: "2026-09-19T03:31:40.000Z",
      startedIso: "2026-09-19T03:22:10.000Z",
    });
    expect(gap).toEqual({ fromIso: "2026-09-19T03:23:40.000Z", minutes: 8, toIso: "2026-09-19T03:31:40.000Z" });
  });
});
