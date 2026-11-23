import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendProgressLogEvent,
  changingWrites,
  decodeProgressLogLine,
  foldProgressLog,
  openProgressGap,
  type ProgressLog,
  progressGapsExceeding,
  progressLogPath,
  readProgressLog,
  worstProgressGap,
} from "../../../../live/turn/progressLog.js";

const ASK = { channel: "C1", messageTs: "1787997255.201059", threadTs: "1786869839.349169" };

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const stage = ({ text, tsIso }: { text: string; tsIso: string }) => ({ kind: "stage" as const, text, tsIso });
// Each write carries a DISTINCT detail, because a real one does: every card write on the turns these
// fixtures reproduce was a `now:` line whose elapsed-time and tool-call counts moved between writes. The
// constant that used to stand here was an incidental placeholder, and once `changingWrites` began folding a
// repeated detail into one mark it silently turned these real timelines into single-mark ones. A write that
// deliberately repeats its predecessor is `sameDetailWrite` below, used only where that IS the property.
const write = ({ tsIso }: { tsIso: string }) => ({
  detail: `now: Bash · at ${tsIso}`,
  kind: "card-write" as const,
  stageCount: 1,
  tsIso,
});

/** A write that re-sends the detail the card already carried — what a reader sees as no change at all. */
const sameDetailWrite = ({ detail, tsIso }: { detail: string; tsIso: string }) => ({
  detail,
  kind: "card-write" as const,
  stageCount: 1,
  tsIso,
});

describe("decodeProgressLogLine", () => {
  it("decodes a stage", () => {
    const decoded = decodeProgressLogLine({
      line: '{"kind":"stage","text":"reading the thread","tsIso":"2026-08-29T09:55:56.595Z"}',
    });
    expect(decoded).toEqual({ kind: "stage", text: "reading the thread", tsIso: "2026-08-29T09:55:56.595Z" });
  });

  it("decodes a card write, defaulting a missing stage count to zero", () => {
    const decoded = decodeProgressLogLine({
      line: '{"kind":"card-write","detail":"now: Bash","tsIso":"2026-08-29T10:00:00.000Z"}',
    });
    expect(decoded).toEqual({
      detail: "now: Bash",
      kind: "card-write",
      stageCount: 0,
      tsIso: "2026-08-29T10:00:00.000Z",
    });
  });

  it("returns undefined for a blank line", () => {
    expect(decodeProgressLogLine({ line: "   " })).toBe(undefined);
  });

  it("returns undefined for a line that is not JSON rather than throwing", () => {
    expect(decodeProgressLogLine({ line: "{not json" })).toBe(undefined);
  });

  it("returns undefined for a foreign kind", () => {
    expect(decodeProgressLogLine({ line: '{"kind":"something-else","tsIso":"2026-08-29T10:00:00.000Z"}' })).toBe(
      undefined,
    );
  });

  it("returns undefined for a stage with no tsIso", () => {
    expect(decodeProgressLogLine({ line: '{"kind":"stage","text":"x"}' })).toBe(undefined);
  });
});

describe("foldProgressLog", () => {
  it("splits stages from writes in file order", () => {
    const folded = foldProgressLog({
      text: [
        JSON.stringify(stage({ text: "first", tsIso: "2026-08-29T09:00:00.000Z" })),
        JSON.stringify(write({ tsIso: "2026-08-29T09:01:00.000Z" })),
        JSON.stringify(stage({ text: "second", tsIso: "2026-08-29T09:02:00.000Z" })),
      ].join("\n"),
    });
    expect(folded.stages.map((s) => s.text)).toEqual(["first", "second"]);
    expect(folded.writes.map((w) => w.tsIso)).toEqual(["2026-08-29T09:01:00.000Z"]);
  });

  it("skips one corrupt line and keeps the rest", () => {
    const folded = foldProgressLog({
      text: ["{oops", JSON.stringify(stage({ text: "kept", tsIso: "2026-08-29T09:02:00.000Z" }))].join("\n"),
    });
    expect(folded.stages.map((s) => s.text)).toEqual(["kept"]);
  });

  it("folds empty text to an empty log", () => {
    expect(foldProgressLog({ text: "" })).toEqual({ stages: [], timeline: [], warns: [], writes: [] });
  });
});

describe("readProgressLog", () => {
  it("round-trips appended events through a real file", () => {
    const home = mkdtempSync(join(tmpdir(), "progress-log-"));
    fixtureDirs.push(home);
    appendProgressLogEvent({
      askIdentity: ASK,
      event: stage({ text: "reading the thread", tsIso: "2026-08-29T09:55:56.595Z" }),
      home,
    });
    appendProgressLogEvent({ askIdentity: ASK, event: write({ tsIso: "2026-08-29T09:56:00.000Z" }), home });
    const log = readProgressLog({ askIdentity: ASK, home });
    expect(log.stages.map((s) => s.text)).toEqual(["reading the thread"]);
    expect(log.writes.map((w) => w.detail)).toEqual(["now: Bash · at 2026-08-29T09:56:00.000Z"]);
  });

  it("reads a turn with no log at all as empty rather than failing", () => {
    const home = mkdtempSync(join(tmpdir(), "progress-log-"));
    fixtureDirs.push(home);
    expect(readProgressLog({ askIdentity: ASK, home })).toEqual({ stages: [], timeline: [], warns: [], writes: [] });
  });

  it("keys the file by channel and messageTs, never the thread root", () => {
    const path = progressLogPath({ askIdentity: ASK, home: "/tmp/state" });
    expect(path).toBe("/tmp/state/live/slack/progress/C1-1787997255.201059.jsonl");
  });
});

describe("progressGapsExceeding", () => {
  // The real tag-3 card timeline: the writes the worker's own `turn status` calls made, and the
  // answer that ended the turn. Reproduce the source with
  // `grep 'turn status' <the worker's ~/.claude/projects/**/<session>.jsonl>`.
  const TAG_THREE: ProgressLog = {
    stages: [],
    timeline: [],
    warns: [],
    writes: [
      "2026-08-29T09:55:56.595Z",
      "2026-08-29T09:58:17.328Z",
      "2026-08-29T10:01:35.519Z",
      "2026-08-29T10:06:00.956Z",
      "2026-08-29T10:12:08.718Z",
      "2026-08-29T10:22:18.389Z",
      "2026-08-29T10:27:38.013Z",
    ].map((tsIso) => write({ tsIso })),
  };

  it("catches every gap over five minutes on the turn the owner complained about", () => {
    const gaps = progressGapsExceeding({
      boundMinutes: 5,
      log: TAG_THREE,
      nowIso: "2026-08-29T10:44:15.721Z",
      startedIso: "2026-08-29T09:54:23.389Z",
    });
    expect(gaps.map((gap) => gap.minutes)).toEqual([6.1, 10.2, 5.3, 16.6]);
  });

  it("counts the stretch from the card being posted to its FIRST write, so a card never written still fails", () => {
    const gaps = progressGapsExceeding({
      boundMinutes: 5,
      log: { stages: [], timeline: [], warns: [], writes: [] },
      nowIso: "2026-08-29T10:44:15.721Z",
      startedIso: "2026-08-29T09:54:23.389Z",
    });
    expect(gaps.map((gap) => gap.minutes)).toEqual([49.9]);
  });

  it("finds nothing on a turn whose card kept up", () => {
    const gaps = progressGapsExceeding({
      boundMinutes: 5,
      log: {
        stages: [],
        timeline: [],
        warns: [],
        writes: ["2026-08-29T09:56:00.000Z", "2026-08-29T09:58:00.000Z"].map((tsIso) => write({ tsIso })),
      },
      nowIso: "2026-08-29T10:00:00.000Z",
      startedIso: "2026-08-29T09:54:00.000Z",
    });
    expect(gaps).toEqual([]);
  });

  it("ignores an unreadable timestamp rather than scoring it as an infinite gap", () => {
    const gaps = progressGapsExceeding({
      boundMinutes: 5,
      log: { stages: [], timeline: [], warns: [], writes: [write({ tsIso: "not-a-date" })] },
      nowIso: "2026-08-29T09:56:00.000Z",
      startedIso: "2026-08-29T09:54:00.000Z",
    });
    expect(gaps).toEqual([]);
  });
});

// The shape the card-stale defect report measured on the day's second live tag: a 9.2m stall since
// 04:55:02.676Z, a SMALLER 5.1m one since 05:10:33.890Z after it, and a card still writing seconds before the
// sweep ran. The two qualifying gaps and their `since` marks are the measured values; the writes that close
// them are chosen to reproduce exactly those two and no third.
const SECOND_LIVE_TAG: ProgressLog = {
  stages: [],
  timeline: [],
  warns: [],
  writes: [
    "2026-09-02T04:55:02.676Z",
    "2026-09-02T05:04:14.676Z",
    "2026-09-02T05:08:00.000Z",
    "2026-09-02T05:10:33.890Z",
    "2026-09-02T05:15:39.890Z",
    "2026-09-02T05:19:00.000Z",
    "2026-09-02T05:21:53.000Z",
  ].map((tsIso) => write({ tsIso })),
};

// When that card was posted, and the instant the sweep ran — seven seconds after its last write.
const TAG_STARTED = "2026-09-02T04:52:00.000Z";
const SWEPT_AT = "2026-09-02T05:22:00.000Z";

describe("openProgressGap — the one gap that can be described in the present tense", () => {
  it("finds nothing on a card written seconds ago, however bad its history was", () => {
    expect(
      openProgressGap({
        boundMinutes: 5,
        log: SECOND_LIVE_TAG,
        nowIso: SWEPT_AT,
        startedIso: TAG_STARTED,
      }),
    ).toBeUndefined();
  });

  it("reports the stretch since the last write when the card really has gone quiet", () => {
    expect(
      openProgressGap({
        boundMinutes: 5,
        log: SECOND_LIVE_TAG,
        nowIso: "2026-09-02T05:28:05.000Z",
        startedIso: TAG_STARTED,
      }),
    ).toEqual({ fromIso: "2026-09-02T05:21:53.000Z", minutes: 6.2, toIso: "2026-09-02T05:28:05.000Z" });
  });

  it("runs from the card being posted when nothing has been written at all", () => {
    expect(
      openProgressGap({
        boundMinutes: 5,
        log: { stages: [], timeline: [], warns: [], writes: [] },
        nowIso: "2026-08-29T10:44:15.721Z",
        startedIso: "2026-08-29T09:54:23.389Z",
      }),
    ).toEqual({ fromIso: "2026-08-29T09:54:23.389Z", minutes: 49.9, toIso: "2026-08-29T10:44:15.721Z" });
  });

  it("finds nothing when the open stretch is exactly the bound, so the alarm fires strictly over it", () => {
    expect(
      openProgressGap({
        boundMinutes: 5,
        log: { stages: [], timeline: [], warns: [], writes: [write({ tsIso: "2026-09-02T05:00:00.000Z" })] },
        nowIso: "2026-09-02T05:05:00.000Z",
        startedIso: TAG_STARTED,
      }),
    ).toBeUndefined();
  });

  it("finds nothing when the last write carries a later timestamp than now, rather than scoring a negative", () => {
    expect(
      openProgressGap({
        boundMinutes: 5,
        log: { stages: [], timeline: [], warns: [], writes: [write({ tsIso: "2026-09-02T05:19:43.443Z" })] },
        nowIso: "2026-09-02T05:19:41.435Z",
        startedIso: TAG_STARTED,
      }),
    ).toBeUndefined();
  });

  it("is the FINAL mark pair, not a toIso that happens to equal now — a write at the closing instant is fresh", () => {
    expect(
      openProgressGap({
        boundMinutes: 5,
        log: { stages: [], timeline: [], warns: [], writes: [write({ tsIso: SWEPT_AT })] },
        nowIso: SWEPT_AT,
        startedIso: TAG_STARTED,
      }),
    ).toBeUndefined();
  });
});

describe("worstProgressGap — the longest, never the most recent", () => {
  it("picks the 9.2m stall the old last-element read reported as 5.1m", () => {
    const gaps = progressGapsExceeding({
      boundMinutes: 5,
      log: SECOND_LIVE_TAG,
      nowIso: SWEPT_AT,
      startedIso: TAG_STARTED,
    });
    expect(gaps.map((gap) => gap.minutes)).toEqual([9.2, 5.1]);
    expect(worstProgressGap({ gaps })).toEqual({
      fromIso: "2026-09-02T04:55:02.676Z",
      minutes: 9.2,
      toIso: "2026-09-02T05:04:14.676Z",
    });
  });

  it("keeps the earlier gap on a tie, so the reading is stable rather than order-dependent", () => {
    expect(
      worstProgressGap({
        gaps: [
          { fromIso: "2026-09-02T05:00:00.000Z", minutes: 6, toIso: "2026-09-02T05:06:00.000Z" },
          { fromIso: "2026-09-02T05:10:00.000Z", minutes: 6, toIso: "2026-09-02T05:16:00.000Z" },
        ],
      }),
    ).toEqual({ fromIso: "2026-09-02T05:00:00.000Z", minutes: 6, toIso: "2026-09-02T05:06:00.000Z" });
  });

  it("returns undefined for no gaps at all", () => {
    expect(worstProgressGap({ gaps: [] })).toBeUndefined();
  });
});

describe("changingWrites — a rewrite is not a change", () => {
  it("folds the four identical `─` writes the sweep pushed on one turn into one mark", () => {
    // The real timeline: three stages with their own writes, and between them sweep pushes whose entire
    // detail was `─`. The owner read that card as frozen, and the probe read four fresh writes.
    const writes = [
      sameDetailWrite({ detail: "─", tsIso: "2026-09-14T00:11:09.454Z" }),
      sameDetailWrite({ detail: "─", tsIso: "2026-09-14T00:17:27.994Z" }),
      sameDetailWrite({ detail: "─", tsIso: "2026-09-14T00:23:55.805Z" }),
      sameDetailWrite({ detail: "─", tsIso: "2026-09-14T00:30:32.694Z" }),
    ];
    expect(changingWrites({ writes }).map((kept) => kept.tsIso)).toEqual(["2026-09-14T00:11:09.454Z"]);
  });

  it("keeps the FIRST of a repeated run, which is when the card last said something new", () => {
    const writes = [
      sameDetailWrite({ detail: "now: still working — 0 tool calls so far", tsIso: "2026-09-14T00:10:00.000Z" }),
      sameDetailWrite({ detail: "now: still working — 0 tool calls so far", tsIso: "2026-09-14T00:11:30.000Z" }),
      sameDetailWrite({
        detail: "now: Bash (started just now) · 3 tool calls so far",
        tsIso: "2026-09-14T00:13:00.000Z",
      }),
    ];
    expect(changingWrites({ writes }).map((kept) => kept.tsIso)).toEqual([
      "2026-09-14T00:10:00.000Z",
      "2026-09-14T00:13:00.000Z",
    ]);
  });

  it("keeps a detail that returns after a different one — the card did change, twice", () => {
    const writes = [
      sameDetailWrite({ detail: "A", tsIso: "2026-09-14T00:10:00.000Z" }),
      sameDetailWrite({ detail: "B", tsIso: "2026-09-14T00:11:00.000Z" }),
      sameDetailWrite({ detail: "A", tsIso: "2026-09-14T00:12:00.000Z" }),
    ];
    expect(changingWrites({ writes }).map((kept) => kept.detail)).toEqual(["A", "B", "A"]);
  });

  it("is empty for a log with no writes at all", () => {
    expect(changingWrites({ writes: [] })).toEqual([]);
  });
});

describe("openProgressGap measures since the card CHANGED, not since it was written", () => {
  // The exact defect: a ticker re-sending one constant detail every 90s keeps a write-counting probe quiet
  // forever. A Codex worker records no transcript, so `nowLine` returns this same string on every tick.
  const FROZEN = "now: still working — 0 tool calls so far";
  const log: ProgressLog = {
    stages: [],
    timeline: [],
    warns: [],
    writes: [
      sameDetailWrite({ detail: FROZEN, tsIso: "2026-09-14T00:10:00.000Z" }),
      sameDetailWrite({ detail: FROZEN, tsIso: "2026-09-14T00:11:30.000Z" }),
      sameDetailWrite({ detail: FROZEN, tsIso: "2026-09-14T00:13:00.000Z" }),
      sameDetailWrite({ detail: FROZEN, tsIso: "2026-09-14T00:14:30.000Z" }),
      sameDetailWrite({ detail: FROZEN, tsIso: "2026-09-14T00:16:00.000Z" }),
    ],
  };

  it("reports the whole frozen stretch, not the 0.5m since the last rewrite", () => {
    const gap = openProgressGap({
      boundMinutes: 5,
      log,
      nowIso: "2026-09-14T00:16:30.000Z",
      startedIso: "2026-09-14T00:09:00.000Z",
    });
    expect(gap).toEqual({ fromIso: "2026-09-14T00:10:00.000Z", minutes: 6.5, toIso: "2026-09-14T00:16:30.000Z" });
  });

  it("stays quiet when the same writes carried moving details instead", () => {
    const moving: ProgressLog = {
      stages: [],
      timeline: [],
      warns: [],
      writes: log.writes.map((entry) => sameDetailWrite({ detail: `now: at ${entry.tsIso}`, tsIso: entry.tsIso })),
    };
    expect(
      openProgressGap({
        boundMinutes: 5,
        log: moving,
        nowIso: "2026-09-14T00:16:30.000Z",
        startedIso: "2026-09-14T00:09:00.000Z",
      }),
    ).toBe(undefined);
  });
});
