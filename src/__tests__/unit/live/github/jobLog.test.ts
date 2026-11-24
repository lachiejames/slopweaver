import { describe, expect, it } from "vitest";

import {
  DEFAULT_TAIL_LINES,
  JobLogAccumulator,
  lineAnnotation,
  MAX_ANNOTATIONS,
  MAX_LINE_CHARS,
  MAX_TEST_FILE_PATHS,
  splitStreamChunk,
  stripLogTimestamp,
} from "../../../../live/github/jobLog.js";

/**
 * The measured shape of a red `lint` job, reduced to the lines that matter.
 *
 * It carries the exact property that decided the module's design: the two `##[error]` annotations naming
 * the defect sit near the TOP, the tail of the step is passing gate ticks, and post-job cleanup follows the
 * `Process completed` close. Taken from `lachiejames/slopweaver` run 35502228255 job 106055916296.
 */
const LINT_JOB_LOG: readonly string[] = [
  "2026-09-20T09:24:42.0000000Z ##[group]Run actions/checkout@v7",
  "2026-09-20T09:24:43.0000000Z Syncing repository",
  "2026-09-20T09:24:46.0000000Z ##[endgroup]",
  "2026-09-20T09:25:31.0000000Z ##[group]Run yarn lint",
  "2026-09-20T09:25:31.1000000Z ##[endgroup]",
  "2026-09-20T09:25:32.0000000Z dev lint: oxlint",
  "2026-09-20T09:25:32.1000000Z ##[error]site/components/live/Now.tsx:86:11: This assertion is unnecessary.",
  "2026-09-20T09:25:32.2000000Z ##[error]site/components/live/Now.tsx:91:9: This assertion is unnecessary.",
  "2026-09-20T09:31:44.0000000Z   ✓ escape-hatch (2.3s)",
  "2026-09-20T09:31:44.5000000Z   ✓ hatch-release (11.6s)",
  "2026-09-20T09:31:45.0000000Z dev lint: FAIL",
  "2026-09-20T09:31:45.1000000Z ##[error]Process completed with exit code 1.",
  "2026-09-20T09:31:45.8000000Z Removing HTTP extra header",
  "2026-09-20T09:31:45.9000000Z Cleaning up orphan processes",
];

/** Feed a whole fixture through the accumulator, exactly as the streaming read does. */
function summarise({ lines, tailLines }: { lines: readonly string[]; tailLines: number }) {
  const accumulator = new JobLogAccumulator({ tailLines });
  for (const line of lines) {
    accumulator.push({ line: stripLogTimestamp({ line }) });
  }
  return accumulator.summary();
}

describe("stripLogTimestamp", () => {
  it("removes GitHub's own 28-character ISO prefix and the space after it", () => {
    expect(stripLogTimestamp({ line: "2026-09-20T09:31:51.1597447Z dev lint: FAIL" })).toBe("dev lint: FAIL");
  });

  it("returns a line carrying no timestamp untouched rather than slicing it blind", () => {
    expect(stripLogTimestamp({ line: "dev lint: FAIL" })).toBe("dev lint: FAIL");
  });

  it("leaves a line whose text merely starts with a date alone", () => {
    expect(stripLogTimestamp({ line: "2026-09-20 was the measurement date" })).toBe(
      "2026-09-20 was the measurement date",
    );
  });
});

describe("lineAnnotation", () => {
  it("reads an error annotation with its marker stripped", () => {
    expect(lineAnnotation({ line: "##[error]site/x.tsx:1:1: bad" })).toEqual({
      level: "error",
      text: "site/x.tsx:1:1: bad",
    });
  });

  it("reads a warning annotation", () => {
    expect(lineAnnotation({ line: "##[warning]deprecated" })).toEqual({ level: "warning", text: "deprecated" });
  });

  it("refuses the step's own close line, which carries nothing the job conclusion did not", () => {
    expect(lineAnnotation({ line: "##[error]Process completed with exit code 1." })).toBeUndefined();
  });

  it("reads no annotation from an ordinary line", () => {
    expect(lineAnnotation({ line: "dev lint: FAIL" })).toBeUndefined();
  });
});

describe("JobLogAccumulator", () => {
  it("ends the tail at the runner's close, so post-job cleanup is not the report", () => {
    const summary = summarise({ lines: LINT_JOB_LOG, tailLines: 3 });

    expect(summary.closed).toBe(true);
    expect(summary.tail).toEqual([
      "  ✓ hatch-release (11.6s)",
      "dev lint: FAIL",
      "##[error]Process completed with exit code 1.",
    ]);
  });

  it("keeps every annotation in full, including ones far above the tail", () => {
    const summary = summarise({ lines: LINT_JOB_LOG, tailLines: 3 });

    expect(summary.annotations).toEqual([
      { level: "error", text: "site/components/live/Now.tsx:86:11: This assertion is unnecessary." },
      { level: "error", text: "site/components/live/Now.tsx:91:9: This assertion is unnecessary." },
    ]);
    expect(summary.annotationsDropped).toBe(0);
  });

  it("counts the region from the step's own group marker, not from the start of the log", () => {
    // `##[group]Run yarn lint` is index 3 and the close is index 11, so the step holds nine lines.
    expect(summarise({ lines: LINT_JOB_LOG, tailLines: 3 }).regionLines).toBe(9);
  });

  it("reports the live window, unclosed, when no Process completed line ever arrives", () => {
    const summary = summarise({ lines: LINT_JOB_LOG.slice(0, 11), tailLines: 2 });

    expect(summary.closed).toBe(false);
    expect(summary.regionLines).toBe(11);
    expect(summary.tail).toEqual(["  ✓ hatch-release (11.6s)", "dev lint: FAIL"]);
  });

  it("snapshots the LAST close, so an earlier step's failure is not the one reported", () => {
    const summary = summarise({
      lines: [
        "##[group]Run first",
        "first failed",
        "##[error]Process completed with exit code 2.",
        "##[group]Run second",
        "second failed",
        "##[error]Process completed with exit code 1.",
        "Cleaning up orphan processes",
      ],
      tailLines: 2,
    });

    expect(summary.tail).toEqual(["second failed", "##[error]Process completed with exit code 1."]);
    expect(summary.regionLines).toBe(3);
  });

  it("keeps nothing at all when the tail depth is zero, and still reports annotations", () => {
    const summary = summarise({ lines: LINT_JOB_LOG, tailLines: 0 });

    expect(summary.tail).toEqual([]);
    expect(summary.annotations.length).toBe(2);
  });

  it("keeps exactly the tail depth asked for when the region is longer", () => {
    expect(summarise({ lines: LINT_JOB_LOG, tailLines: 1 }).tail).toEqual([
      "##[error]Process completed with exit code 1.",
    ]);
  });

  it("keeps the whole region when the tail depth exceeds it", () => {
    expect(summarise({ lines: LINT_JOB_LOG, tailLines: 100 }).tail.length).toBe(LINT_JOB_LOG.length - 2);
  });

  it("caps annotations and counts the ones it dropped rather than growing with the log", () => {
    const flood = Array.from({ length: MAX_ANNOTATIONS + 7 }, (_unused, index) => `##[error]finding ${String(index)}`);
    const summary = summarise({ lines: [...flood, "##[error]Process completed with exit code 1."], tailLines: 1 });

    expect(summary.annotations.length).toBe(MAX_ANNOTATIONS);
    expect(summary.annotationsDropped).toBe(7);
    expect(summary.annotations[0]).toEqual({ level: "error", text: "finding 0" });
  });

  it("defaults the tail depth to a window a reader can hold", () => {
    expect(DEFAULT_TAIL_LINES).toBe(40);
  });
});

/** Feed a whole fixture through an accumulator keeping a `--from` window, exactly as the streaming read does. */
function summariseFrom({ lines, tailLines, from }: { lines: readonly string[]; tailLines: number; from: string }) {
  const accumulator = new JobLogAccumulator({ from, tailLines });
  for (const line of lines) {
    accumulator.push({ line: stripLogTimestamp({ line }) });
  }
  return accumulator.summary();
}

/**
 * A red lint step whose failed gate raised no annotation: its finding sits under its own section header, and
 * the step ends in a wall of summary ticks — the shape of a red lint step, cut down.
 */
const UNANNOTATED_LINT_LOG: readonly string[] = [
  "##[group]Run yarn lint",
  "dev lint: max-function-lines",
  "max-function-lines: src/a.ts:12 run() is 71 lines (limit 60)",
  "dev lint: no-python",
  "no-python: clean",
  "dev lint:",
  "  ✗ max-function-lines (1.2s)",
  "  ✓ no-python (0.4s)",
  "dev lint: FAIL",
  "##[error]Process completed with exit code 1.",
];

describe("JobLogAccumulator --from window", () => {
  it("opens at the first line containing the text and keeps the lines after it, with no tail", () => {
    const summary = summariseFrom({ from: "dev lint: max-function-lines", lines: UNANNOTATED_LINT_LOG, tailLines: 2 });

    expect(summary.from).toStrictEqual({
      firstLine: 2,
      lines: ["dev lint: max-function-lines", "max-function-lines: src/a.ts:12 run() is 71 lines (limit 60)"],
      logLines: 10,
      text: "dev lint: max-function-lines",
    });
    expect(summary.tail).toEqual([]);
  });

  it("keeps the FIRST match, never a later line that also contains the text", () => {
    const summary = summariseFrom({ from: "max-function-lines", lines: UNANNOTATED_LINT_LOG, tailLines: 1 });

    expect(summary.from!.firstLine).toBe(2);
    expect(summary.from!.lines).toEqual(["dev lint: max-function-lines"]);
  });

  it("records a match on the very first line as line 1", () => {
    expect(summariseFrom({ from: "##[group]Run", lines: UNANNOTATED_LINT_LOG, tailLines: 1 }).from!.firstLine).toBe(1);
  });

  it("names no line when nothing matches, after reading the whole log", () => {
    const summary = summariseFrom({ from: "dev lint: oxlint", lines: UNANNOTATED_LINT_LOG, tailLines: 5 });

    expect(summary.from).toStrictEqual({ firstLine: undefined, lines: [], logLines: 10, text: "dev lint: oxlint" });
  });

  it("finds the match under --lines 0 and keeps no line of it", () => {
    const summary = summariseFrom({ from: "dev lint: no-python", lines: UNANNOTATED_LINT_LOG, tailLines: 0 });

    expect(summary.from!.firstLine).toBe(4);
    expect(summary.from!.lines).toEqual([]);
  });

  it("matches case-sensitively, as the usage promises", () => {
    expect(
      summariseFrom({ from: "DEV LINT", lines: UNANNOTATED_LINT_LOG, tailLines: 5 }).from!.firstLine,
    ).toBeUndefined();
  });

  it("keeps reading the stream once the window is full, so later annotations and failing files still count", () => {
    const summary = summariseFrom({
      from: "dev lint: max-function-lines",
      lines: [
        ...UNANNOTATED_LINT_LOG.slice(0, 3),
        "##[error]src/b.ts:1:1: an annotation after the window filled",
        "FAIL src/b.test.ts > one",
        ...UNANNOTATED_LINT_LOG.slice(3),
      ],
      tailLines: 1,
    });

    expect(summary.from!.lines).toEqual(["dev lint: max-function-lines"]);
    expect(summary.from!.logLines).toBe(12);
    expect(summary.annotations).toEqual([
      { level: "error", text: "src/b.ts:1:1: an annotation after the window filled" },
    ]);
    expect(summary.testFilePaths).toEqual(["src/b.test.ts"]);
  });

  it("carries no window at all on a tail read", () => {
    expect(summarise({ lines: UNANNOTATED_LINT_LOG, tailLines: 2 }).from).toBeUndefined();
  });
});

describe("splitStreamChunk", () => {
  it("returns whole lines and holds the unterminated remainder as the carry", () => {
    expect(splitStreamChunk({ carry: "", chunk: "one\ntwo\nthr" })).toEqual({
      carry: "thr",
      lines: ["one", "two"],
      truncated: 0,
    });
  });

  it("joins a line split across two chunks rather than losing its marker", () => {
    const first = splitStreamChunk({ carry: "", chunk: "##[err" });
    const second = splitStreamChunk({ carry: first.carry, chunk: "or]boom\n" });

    expect(first.lines).toEqual([]);
    expect(second.lines).toEqual(["##[error]boom"]);
    expect(second.carry).toBe("");
  });

  it("strips a CRLF carriage return so a Windows-authored line still matches a prefix", () => {
    expect(splitStreamChunk({ carry: "", chunk: "dev lint: FAIL\r\n" }).lines).toEqual(["dev lint: FAIL"]);
  });

  it("yields no line at all for a chunk carrying no newline", () => {
    expect(splitStreamChunk({ carry: "a", chunk: "bc" })).toEqual({ carry: "abc", lines: [], truncated: 0 });
  });

  it("yields one empty line for a chunk that is only a newline", () => {
    expect(splitStreamChunk({ carry: "", chunk: "\n" })).toEqual({ carry: "", lines: [""], truncated: 0 });
  });
});

describe("splitStreamChunk line bound", () => {
  it("caps a line whose length came from the data, and COUNTS it rather than shortening it quietly", () => {
    const split = splitStreamChunk({ carry: "", chunk: `${"x".repeat(MAX_LINE_CHARS + 500)}\n` });

    expect(split.lines[0]!.length).toBe(MAX_LINE_CHARS);
    expect(split.truncated).toBe(1);
  });

  it("counts a line at exactly the cap as whole, since nothing was dropped from it", () => {
    const split = splitStreamChunk({ carry: "", chunk: `${"x".repeat(MAX_LINE_CHARS)}\n` });

    expect(split.lines[0]!.length).toBe(MAX_LINE_CHARS);
    expect(split.truncated).toBe(0);
  });

  it("bounds the CARRY too, so a body with no newline in it cannot become one JS string", () => {
    let carry = "";
    for (let chunk = 0; chunk < 20; chunk += 1) {
      carry = splitStreamChunk({ carry, chunk: "y".repeat(5000) }).carry;
    }

    expect(carry.length).toBe(MAX_LINE_CHARS + 1);
  });

  it("counts a carried over-long line exactly once, when the newline finally arrives", () => {
    const first = splitStreamChunk({ carry: "", chunk: "z".repeat(MAX_LINE_CHARS + 900) });
    const second = splitStreamChunk({ carry: first.carry, chunk: "z".repeat(900) });
    const third = splitStreamChunk({ carry: second.carry, chunk: "\ntrailing\n" });

    expect(first.truncated).toBe(0);
    expect(second.truncated).toBe(0);
    expect(third.truncated).toBe(1);
    expect(third.lines).toEqual(["z".repeat(MAX_LINE_CHARS), "trailing"]);
  });

  it("reports no truncation at all for an ordinary log line", () => {
    expect(splitStreamChunk({ carry: "", chunk: "dev lint: FAIL\n" }).truncated).toBe(0);
  });
});

describe("JobLogAccumulator failing test files", () => {
  it("keeps a failing file named far above the window, where only a per-line read could see it", () => {
    const lines = [
      "2026-10-04T01:00:00.0000000Z ##[group]Run yarn test:unit",
      "2026-10-04T01:00:01.0000000Z  FAIL  src/__tests__/unit/review/landing.test.ts > presses",
      ...Array.from({ length: 60 }, (_, index) => `2026-10-04T01:00:02.0000000Z   ✓ passing case ${String(index)}`),
      "2026-10-04T01:00:03.0000000Z ##[error]Process completed with exit code 1.",
    ];

    const summary = summarise({ lines, tailLines: 5 });

    expect(summary.tail.some((line) => line.includes("landing.test.ts"))).toBe(false);
    expect(summary.testFilePaths).toEqual(["src/__tests__/unit/review/landing.test.ts"]);
    expect(summary.testFilePathsDropped).toBe(0);
  });

  it("names each failing file once however often the runner repeats it", () => {
    const summary = summarise({
      lines: ["FAIL src/a.test.ts > one", "FAIL src/a.test.ts > two", "❯ src/a.test.ts (2 tests | 2 failed) 12ms"],
      tailLines: 0,
    });

    expect(summary.testFilePaths).toEqual(["src/a.test.ts"]);
  });

  it("caps the kept list and counts the files past it rather than growing with the log", () => {
    const lines = Array.from({ length: MAX_TEST_FILE_PATHS + 7 }, (_, index) => `FAIL src/f${String(index)}.test.ts`);

    const summary = summarise({ lines, tailLines: 0 });

    expect(summary.testFilePaths.length).toBe(MAX_TEST_FILE_PATHS);
    expect(summary.testFilePaths[0]).toBe("src/f0.test.ts");
    expect(summary.testFilePathsDropped).toBe(7);
  });

  it("names no file from a log whose failures name none", () => {
    expect(summarise({ lines: LINT_JOB_LOG, tailLines: 0 }).testFilePaths).toEqual([]);
  });
});
