/**
 * Every line the noun prints, and the JSON envelope that must agree with it.
 */
import { describe, expect, it } from "vitest";

import {
  autonomyRatio,
  failureRow,
  humanMs,
  jsonEnvelope,
  mergeStrippedCounts,
  preview,
  type RetentionView,
  retentionReport,
  sessionRow,
  splitLines,
  statsLine,
  summaryLines,
  summarySubject,
  turnRow,
} from "../../../../../cli/commands/transcripts/render.js";
import type { TranscriptSummary } from "../../../../../transcripts/fold.js";
import { retentionFloor } from "../../../../../transcripts/retention.js";

const FLOOR = retentionFloor({
  nowMs: Date.parse("2026-08-28T00:00:00.000Z"),
  oldestMs: Date.parse("2026-07-28T00:00:00.000Z"),
  transcriptCount: 1633,
});

const RETENTION: RetentionView = { floor: FLOOR, verdict: "within-retention" };

const SUMMARY: TranscriptSummary = {
  assistantTurns: 322_603,
  cwd: "/repo",
  firstIso: "2026-07-28T02:26:25.005Z",
  humanTurns: 4735,
  lastIso: "2026-08-27T17:07:41.870Z",
  lineCount: 951_122,
  models: ["claude-opus-5"],
  sidechainRecords: 0,
  stripped: { "task-notification": 4872, "tool-result": 170_820 },
  toolErrors: 5038,
  toolResults: 170_820,
  undecodedLines: 441_437,
};

describe("preview", () => {
  it("collapses whitespace onto one line", () => {
    expect(preview({ budget: 40, text: "a\n\n  b\tc " })).toBe("a b c");
  });

  it("marks how much it cut rather than truncating silently", () => {
    expect(preview({ budget: 4, text: "abcdefghij" })).toBe("abcd… (+6 chars)");
  });

  it("leaves text that fits exactly alone", () => {
    expect(preview({ budget: 4, text: "abcd" })).toBe("abcd");
  });
});

describe("sessionRow", () => {
  it("names the session, its pulse, its size and its project", () => {
    expect(
      sessionRow({
        session: {
          bytes: 4_089_446,
          lastWriteMs: Date.parse("2026-08-27T17:04:28.114Z"),
          path: "/p/-repo/s.jsonl",
          projectDir: "-repo",
          sessionId: "s",
        },
      }),
    ).toBe("s  2026-08-27T17:04:28.114Z      3.9 MiB  -repo");
  });
});

describe("turnRow", () => {
  const turn = {
    cwd: "/repo",
    lineNumber: 10,
    source: "typed" as const,
    text: "run the probe",
    timestamp: "2026-08-27T12:00:00.000Z",
    uuid: "u-1",
  };

  it("shows the instant, the line, how it arrived and the words", () => {
    expect(turnRow({ full: false, turn })).toBe("2026-08-27T12:00:00.000Z  L10  [typed]  run the probe");
  });

  it("says so rather than inventing an instant when the record carried none", () => {
    expect(turnRow({ full: false, turn: { ...turn, timestamp: "" } })).toContain("(no timestamp)");
  });

  it("prints the turn whole under --full", () => {
    const long = "y".repeat(500);
    expect(turnRow({ full: true, turn: { ...turn, text: long } })).toContain(long);
  });
});

describe("failureRow", () => {
  it("names the tool that failed", () => {
    expect(
      failureRow({
        failure: {
          lineNumber: 249,
          text: "Exit code 1",
          timestamp: "2026-08-27T13:02:37.125Z",
          tool: "Bash",
          toolUseId: "t1",
        },
      }),
    ).toBe("2026-08-27T13:02:37.125Z  L249  Bash  Exit code 1");
  });

  it("says the call was outside the file rather than guessing a tool name", () => {
    expect(failureRow({ failure: { lineNumber: 1, text: "boom", timestamp: "", tool: "", toolUseId: "t2" } })).toBe(
      "(no timestamp)  L1  (call not in this file)  boom",
    );
  });
});

describe("autonomyRatio", () => {
  it("reports assistant turns per human turn", () => {
    expect(autonomyRatio({ summary: SUMMARY })).toBe("68.1:1 assistant turns per human turn");
  });

  it("refuses a ratio for a session nobody has spoken to, rather than reporting infinity", () => {
    expect(autonomyRatio({ summary: { ...SUMMARY, humanTurns: 0 } })).toBe("no human turns, so no ratio");
  });
});

describe("summaryLines", () => {
  it("reports every count, the span, the models and the working directory", () => {
    expect(
      summaryLines({ bytes: 3_218_759_045, path: "/p", sessionId: "1633 transcripts", summary: SUMMARY }),
    ).toStrictEqual([
      "session 1633 transcripts · /p",
      "951,122 lines, 3069.6 MiB · 441,437 carried no message record",
      "4,735 human turns · 322,603 assistant turns · 68.1:1 assistant turns per human turn",
      "170,820 tool results, 5,038 of them errors · 0 subagent records",
      "machine turns wearing the user role: tool-result 170,820 · task-notification 4,872",
      "span 2026-07-28T02:26:25.005Z … 2026-08-27T17:07:41.870Z · models claude-opus-5",
      "cwd /repo",
    ]);
  });

  it("says what is unknown rather than printing an empty field", () => {
    const bare = summaryLines({
      bytes: 0,
      path: "/p",
      sessionId: "s",
      summary: { ...SUMMARY, cwd: "", firstIso: "", lastIso: "", models: [], stripped: {} },
    });
    expect(bare[4]).toBe("machine turns wearing the user role: none");
    expect(bare[5]).toBe("span unknown … unknown · models none named");
    expect(bare[6]).toBe("cwd not recorded");
  });
});

describe("summarySubject", () => {
  const session = { bytes: 1, lastWriteMs: 0, path: "/p/-repo/s.jsonl", projectDir: "-repo", sessionId: "s" };

  it("names the one session and its file when exactly one is in scope", () => {
    expect(summarySubject({ projectsDir: "/p", sessions: [session], walked: 1 })).toEqual({
      path: "/p/-repo/s.jsonl",
      sessionId: "s",
    });
  });

  it("names the count walked and the projects directory when several are in scope", () => {
    expect(
      summarySubject({ projectsDir: "/p", sessions: [session, { ...session, sessionId: "t" }], walked: 2 }),
    ).toEqual({ path: "/p", sessionId: "2 transcripts" });
  });

  it("names the projects directory when no session is in scope", () => {
    expect(summarySubject({ projectsDir: "/p", sessions: [], walked: 0 })).toEqual({
      path: "/p",
      sessionId: "0 transcripts",
    });
  });
});

describe("mergeStrippedCounts", () => {
  it("sums each kind across transcripts, keeping first-seen key order", () => {
    expect(
      JSON.stringify(
        mergeStrippedCounts({
          counts: [
            { command: 2, reminder: 1 },
            { hook: 4, reminder: 3 },
          ],
        }),
      ),
    ).toBe('{"command":2,"reminder":4,"hook":4}');
  });

  it("is empty over no transcripts", () => {
    expect(mergeStrippedCounts({ counts: [] })).toEqual({});
  });
});

describe("jsonEnvelope", () => {
  it("carries the same retention note the human report prints, so the two cannot disagree", () => {
    const payload = JSON.parse(jsonEnvelope({ payload: { selected: 2 }, retention: RETENTION })) as {
      readonly selected: number;
      readonly retention: { readonly note: string; readonly verdict: string; readonly retainedDays: number };
    };
    expect(payload.selected).toBe(2);
    expect(payload.retention.note).toBe(retentionReport({ retention: RETENTION }));
    expect(payload.retention.verdict).toBe("within-retention");
    expect(payload.retention.retainedDays).toBe(31);
  });

  it("reports a machine with no transcripts as a null floor rather than an empty string", () => {
    const empty = retentionFloor({ nowMs: 0, oldestMs: undefined, transcriptCount: 0 });
    const payload = JSON.parse(
      jsonEnvelope({ payload: {}, retention: { floor: empty, verdict: "within-retention" } }),
    ) as { readonly retention: { readonly oldestTranscriptIso: string | null } };
    expect(payload.retention.oldestTranscriptIso).toBe(null);
  });
});

describe("humanMs", () => {
  it("keeps milliseconds below a second, so a 7 ms call does not read as 0.0s", () => {
    expect(humanMs({ ms: 7 })).toBe("7ms");
    expect(humanMs({ ms: 999 })).toBe("999ms");
  });

  it("switches to seconds at a second and to minutes at a minute", () => {
    expect(humanMs({ ms: 1000 })).toBe("1.0s");
    expect(humanMs({ ms: 59_999 })).toBe("60.0s");
    expect(humanMs({ ms: 60_000 })).toBe("1.0m");
    expect(humanMs({ ms: 600_183 })).toBe("10.0m");
  });
});

describe("statsLine", () => {
  it("says an empty set is empty rather than printing five zeros", () => {
    expect(statsLine({ stats: { count: 0, maxMs: 0, meanMs: 0, p50Ms: 0, p90Ms: 0 } })).toBe("no samples");
  });

  it("quotes count, p50, p90, max and mean in one order", () => {
    expect(statsLine({ stats: { count: 1234, maxMs: 600_000, meanMs: 2500, p50Ms: 1500, p90Ms: 30_000 } })).toBe(
      "n=1,234 · p50 1.5s · p90 30.0s · max 10.0m · mean 2.5s",
    );
  });
});

describe("splitLines", () => {
  it("names the direction of a ratio below one as faster", () => {
    const lines = splitLines({
      split: {
        after: {
          errorsIncluded: 0,
          firstIso: "2026-09-15T04:00:00.000Z",
          lastIso: "2026-09-15T05:00:00.000Z",
          parallelExcluded: 0,
          stats: { count: 10, maxMs: 2000, meanMs: 600, p50Ms: 500, p90Ms: 1500 },
        },
        before: {
          errorsIncluded: 2,
          firstIso: "2026-09-15T02:00:00.000Z",
          lastIso: "2026-09-15T03:00:00.000Z",
          parallelExcluded: 3,
          stats: { count: 20, maxMs: 9000, meanMs: 1200, p50Ms: 1000, p90Ms: 4000 },
        },
        p50Ratio: 0.5,
        splitIso: "2026-09-15T03:28:54.000Z",
      },
    });
    expect(lines[0]).toBe("split at 2026-09-15T03:28:54.000Z");
    expect(lines[3]).toBe("  after/before p50 ratio 0.50× (faster after)");
    expect(lines[1]).toContain("3 parallel excluded");
    expect(lines[1]).toContain("2 error(s) in sample");
  });

  it("says why there is no ratio rather than printing one", () => {
    const empty = {
      errorsIncluded: 0,
      firstIso: "",
      lastIso: "",
      parallelExcluded: 0,
      stats: { count: 0, maxMs: 0, meanMs: 0, p50Ms: 0, p90Ms: 0 },
    };
    const lines = splitLines({
      split: { after: empty, before: empty, p50Ratio: null, splitIso: "2026-09-15T03:28:54.000Z" },
    });
    expect(lines[3]).toBe("  no ratio — one side has no serial sample, or the before-side median is zero");
    expect(lines[1]).toContain("(empty)");
  });
});
