import { describe, expect, it } from "vitest";

import type { CoverageLeg, CoverageManifest } from "../../../retrieval/coverage.js";
import {
  BEHIND_AFTER_MINUTES,
  estimateWords,
  isMovingTarget,
  type JustInTimeWait,
  justInTimeRefusalLines,
  justInTimeVerdict,
  REFRESH_FLOOR_SECONDS,
  sourcesBehind,
  waitEstimate,
  waitRefreshCommand,
} from "../../../retrieval/justInTime.js";

const NOW = "2026-09-05T12:00:00.000Z";

/** One coverage leg, defaulted to a healthy source whose cursor is minutes old. */
function leg(over: Partial<CoverageLeg> = {}): CoverageLeg {
  return {
    cursorIso: "2026-09-05T11:50:00.000Z",
    detail: "read",
    indexed: 10,
    ingested: 10,
    leg: "slack",
    skipped: [],
    state: "ok",
    ...over,
  };
}

/** A manifest over the given legs. */
function manifestOf({ legs }: { legs: readonly CoverageLeg[] }): CoverageManifest {
  return { legs };
}

describe("isMovingTarget", () => {
  it("calls a recency-marked question moving and names the marker", () => {
    const verdict = isMovingTarget({ question: "what shipped today?" });
    expect(verdict.moving).toBe(true);
    expect(verdict.because).toBe('the question carries a recency marker ("today")');
  });

  it("calls a state question moving even with no recency marker", () => {
    const verdict = isMovingTarget({ question: "who owns the billing rewrite" });
    expect(verdict.moving).toBe(true);
    expect(verdict.because).toBe('the question asks state rather than history ("who owns")');
  });

  it("calls a history question NOT moving", () => {
    const verdict = isMovingTarget({ question: "what did we decide about the retry budget" });
    expect(verdict.moving).toBe(false);
    expect(verdict.because).toBe("the question asks what was decided, not what is true now");
  });

  it("lets a recency marker outrank a history phrase in the same question", () => {
    const verdict = isMovingTarget({ question: "what did we decide about the current sprint" });
    expect(verdict.moving).toBe(true);
    expect(verdict.because).toBe('the question carries a recency marker ("current")');
  });

  it("calls a plain topical question NOT moving", () => {
    const verdict = isMovingTarget({ question: "how does the embedding cache work" });
    expect(verdict.moving).toBe(false);
    expect(verdict.because).toBe("the question carries no recency marker and does not ask for current state");
  });

  it("is case-insensitive", () => {
    expect(isMovingTarget({ question: "What Is The Status Of #350?" }).moving).toBe(true);
  });
});

describe("sourcesBehind", () => {
  it("returns a source whose cursor is past the threshold, with its age and cursor", () => {
    const behind = sourcesBehind({
      manifest: manifestOf({ legs: [leg({ cursorIso: "2026-09-04T12:00:00.000Z" })] }),
      nowIso: NOW,
    });
    expect(behind).toEqual([{ behindMinutes: 1440, cursorIso: "2026-09-04T12:00:00.000Z", source: "slack" }]);
  });

  it("leaves a source inside the window alone", () => {
    expect(sourcesBehind({ manifest: manifestOf({ legs: [leg()] }), nowIso: NOW })).toEqual([]);
  });

  it("ignores a leg refresh does not keep current", () => {
    const behind = sourcesBehind({
      manifest: manifestOf({ legs: [leg({ cursorIso: "2026-08-01T00:00:00.000Z", leg: "self" })] }),
      nowIso: NOW,
    });
    expect(behind).toEqual([]);
  });

  it("ignores a leg with no stored cursor", () => {
    const cursorless: CoverageLeg = { detail: "read", indexed: 1, ingested: 1, leg: "slack", skipped: [], state: "ok" };
    expect(sourcesBehind({ manifest: manifestOf({ legs: [cursorless] }), nowIso: NOW })).toEqual([]);
  });

  it("takes the threshold from the caller", () => {
    const behind = sourcesBehind({
      behindAfterMinutes: 5,
      manifest: manifestOf({ legs: [leg()] }),
      nowIso: NOW,
    });
    expect(behind[0]!.source).toBe("slack");
  });

  it("defaults its threshold to four hours", () => {
    expect(BEHIND_AFTER_MINUTES).toBe(240);
  });
});

describe("waitEstimate", () => {
  it("sums the measured floors and says about", () => {
    const estimate = waitEstimate({
      sources: [
        { behindMinutes: 300, cursorIso: NOW, source: "github" },
        { behindMinutes: 300, cursorIso: NOW, source: "linear" },
      ],
    });
    expect(estimate.seconds).toBe(423);
    expect(estimate.unbounded).toBe(false);
    expect(estimate.words).toBe("about 7 min");
  });

  it("says at least when a source's floor has no measured upper bound", () => {
    const estimate = waitEstimate({ sources: [{ behindMinutes: 300, cursorIso: NOW, source: "notion" }] });
    expect(estimate.unbounded).toBe(true);
    expect(estimate.words).toBe("at least 40 min");
  });

  it("falls back to the unbounded floor for a source an earlier pass never timed", () => {
    const estimate = waitEstimate({ sources: [{ behindMinutes: 300, cursorIso: NOW, source: "calendar" }] });
    expect(estimate.seconds).toBe(2400);
    expect(estimate.words).toBe("at least 40 min");
  });

  it("carries the floors as measured", () => {
    expect(REFRESH_FLOOR_SECONDS["slack"]).toEqual({ seconds: 1054, unbounded: false });
    expect(REFRESH_FLOOR_SECONDS["gmail"]).toEqual({ seconds: 8, unbounded: false });
  });
});

describe("estimateWords", () => {
  it("says under a minute below sixty seconds", () => {
    expect(estimateWords({ seconds: 8, unbounded: false })).toBe("under a minute");
  });

  it("rounds to whole minutes", () => {
    expect(estimateWords({ seconds: 1054, unbounded: false })).toBe("about 18 min");
  });
});

describe("justInTimeVerdict", () => {
  const behindSlack = leg({ cursorIso: "2026-09-04T18:00:00.000Z" });

  it("waits when the question moves AND a behind source is in the slice", () => {
    const verdict = justInTimeVerdict({
      manifest: manifestOf({ legs: [behindSlack] }),
      nowIso: NOW,
      question: "what is the status of the staging pool",
      sliceSources: ["slack", "github"],
    });
    expect(verdict).toEqual({
      alreadyRunning: [],
      because: 'the question asks state rather than history ("what is the status"), and this question reads slack',
      decision: "wait",
      estimate: { seconds: 1054, unbounded: false, words: "about 18 min" },
      waitOn: [{ behindMinutes: 1080, cursorIso: "2026-09-04T18:00:00.000Z", source: "slack" }],
    });
  });

  it("answers now when the question is historical, however behind the source is", () => {
    const verdict = justInTimeVerdict({
      manifest: manifestOf({ legs: [behindSlack] }),
      nowIso: NOW,
      question: "why did we pick BM25 over embeddings for the first cut",
      sliceSources: ["slack"],
    });
    expect(verdict.decision).toBe("answer-now");
    expect(verdict.because).toBe(
      "answering from what is here: the question asks what was decided, not what is true now",
    );
  });

  it("answers now when the behind source contributed nothing to the slice", () => {
    const verdict = justInTimeVerdict({
      manifest: manifestOf({ legs: [behindSlack] }),
      nowIso: NOW,
      question: "what is the status of #350 today",
      sliceSources: ["github"],
    });
    expect(verdict.decision).toBe("answer-now");
    expect(verdict.because).toBe(
      "answering from what is here: nothing this question reads is behind (slack is behind and contributed nothing)",
    );
  });

  it("answers now when every source the question reads is current", () => {
    const verdict = justInTimeVerdict({
      manifest: manifestOf({ legs: [leg()] }),
      nowIso: NOW,
      question: "what is the status of #350 today",
      sliceSources: ["slack"],
    });
    expect(verdict.decision).toBe("answer-now");
    expect(verdict.because).toBe("answering from what is here: every source this question reads is current");
  });

  it("carries only the in-flight refreshes of sources it is waiting on", () => {
    const verdict = justInTimeVerdict({
      inFlight: [
        { pid: 4242, source: "slack", startedAtIso: "2026-09-05T11:55:00.000Z" },
        { pid: 4343, source: "notion", startedAtIso: "2026-09-05T11:00:00.000Z" },
      ],
      manifest: manifestOf({ legs: [behindSlack] }),
      nowIso: NOW,
      question: "what is still open today",
      sliceSources: ["slack"],
    });
    expect(verdict).toEqual({
      alreadyRunning: [{ pid: 4242, source: "slack", startedAtIso: "2026-09-05T11:55:00.000Z" }],
      because: 'the question carries a recency marker ("today"), and this question reads slack',
      decision: "wait",
      estimate: { seconds: 1054, unbounded: false, words: "about 18 min" },
      waitOn: [{ behindMinutes: 1080, cursorIso: "2026-09-04T18:00:00.000Z", source: "slack" }],
    });
  });
});

describe("waitRefreshCommand", () => {
  it("names each source and takes the just-in-time slot, with no --since", () => {
    const command = waitRefreshCommand({
      sources: [
        { behindMinutes: 600, cursorIso: NOW, source: "slack" },
        { behindMinutes: 600, cursorIso: NOW, source: "linear" },
      ],
    });
    expect(command).toBe("slopweaver refresh --jit --source slack --source linear");
  });
});

describe("justInTimeRefusalLines", () => {
  const wait: JustInTimeWait = {
    alreadyRunning: [],
    because: 'the question carries a recency marker ("today"), and this question reads slack',
    decision: "wait",
    estimate: { seconds: 1054, unbounded: false, words: "about 18 min" },
    waitOn: [{ behindMinutes: 1080, cursorIso: "2026-09-04T18:00:00.000Z", source: "slack" }],
  };

  it("names the behind source, the command, the estimate and the card copy", () => {
    const lines = justInTimeRefusalLines({ cardLines: ["card line one", "card line two"], wait });
    expect(lines[0]).toBe(
      'refusing to answer yet: the question carries a recency marker ("today"), and this question reads slack — ' +
        "answering now would describe an afternoon this corpus has not seen",
    );
    expect(lines[1]).toBe("  behind: slack — last observed 2026-09-04T18:00:00.000Z (18.0h ago)");
    expect(lines[2]).toBe("  wait: `slopweaver refresh --jit --source slack` (about 18 min), then re-run this brief");
    expect(lines).toContain("    · card line one");
    expect(lines).toContain("    · card line two");
  });

  it("names the holder when a refresh of that source is already running", () => {
    const lines = justInTimeRefusalLines({
      cardLines: [],
      wait: { ...wait, alreadyRunning: [{ pid: 99, source: "slack", startedAtIso: "2026-09-05T11:55:00.000Z" }] },
    });
    expect(lines).toContain(
      "  already running: a just-in-time refresh of slack holds the slot (pid 99, since 2026-09-05T11:55:00.000Z)" +
        " — that command will skip it and say so",
    );
  });
});
