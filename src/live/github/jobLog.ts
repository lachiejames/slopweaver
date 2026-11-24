/**
 * What a failed CI job actually PRINTED, shaped so a seat can act on it without re-running the lane.
 *
 * ## Why this module exists at all
 *
 * No `slopweaver` verb read a CI job's log, so a session meeting a red leg — or `github enqueue`'s
 * `ci-not-green`/`ci-rollup-superseded` finding — reproduced CI locally by running the whole `yarn lint`
 * against its own working tree. MEASURED: two seats did exactly that inside one hour, and
 * AGENTS.md § Toolchain's rule that a lane belongs to CI and never to a seat was defeated by a
 * missing READ rather than by anybody disagreeing with it.
 *
 * ## The two findings that decide this module's shape
 *
 * **A tail of the failing step is the wrong default.** MEASURED on `lachiejames/slopweaver` run 35502228255,
 * job 106055916296 (`lint`, 1,138 lines): the two `##[error]` lines naming the actual defect sit at lines
 * 243-244, and the step does not close until line 1103 — 860 lines later — with lines 1085-1102 a wall of
 * passing gate ticks. A `--lines 40` tail of that step therefore prints eighteen gates that PASSED and none
 * of the answer. So {@link JobLogAccumulator} surfaces every annotation in full, ABOVE the tail, and the tail is
 * the second half rather than the whole output. Reproduce:
 *
 * ```bash
 * slopweaver github run-log 35502228255 --repo lachiejames/slopweaver --job lint
 * ```
 *
 * **The step's own boundary is a log marker, never a timestamp.** GitHub's jobs API reports each step's
 * `started_at`/`completed_at` to the SECOND, and on that same run the post-job cleanup steps ran inside the
 * same second the failed step completed — so a timestamp window over the failing step swallows 31 lines of
 * `git config --unset` cleanup and they dominate its tail. {@link JobLogAccumulator} ends the window at the
 * runner's own `##[error]Process completed with exit code N.` line instead, which is exactly the line the
 * cleanup follows. Closing there, rather than at end-of-file, is the single rule that fixes it.
 *
 * ## Bounded by construction
 *
 * A log is data-sized: the same measurement pass found the `unit` job's log at 3,213,680 bytes / 25,195
 * lines against `lint`'s 106 KiB / 1,115, and the size tracks how many tests there are. GitHub's log blob
 * host offers no way to ask for less — MEASURED, a `Range: bytes=-65536` request against the signed
 * location answers `200` with the whole body — so the only bounded read is to consume the response as a
 * stream and keep a fixed window. {@link JobLogAccumulator} is that window: it takes one line at a time and
 * holds at most {@link MAX_ANNOTATIONS} annotations plus `tailLines` tail lines, so nothing here grows with
 * the log. `.claude/rules/typescript-patterns.md` § "Never let a data-sized payload through one JS string"
 * is the rule; this accumulator is how this verb keeps it.
 */

import { testFilePathsFromLine } from "./testFailurePaths.js";

/** The runner annotation prefixes, in the order a reader cares about them. */
const ANNOTATION_PREFIXES: readonly string[] = ["##[error]", "##[warning]"];

/** The line the runner writes when a step's process exits non-zero — the region's close. */
const STEP_CLOSE_PREFIX = "##[error]Process completed with exit code ";

/** The marker opening a collapsible section; a step's own log begins with one naming its command. */
const GROUP_PREFIX = "##[group]";

/**
 * How many annotations one job report may carry.
 *
 * Generous on purpose — a failing gate prints one annotation per finding, and truncating the list is
 * exactly the "print a teaser, send the reader to the web UI" failure this verb exists to end. It is a cap
 * rather than no cap because an accumulator whose size is chosen by the log is not bounded at all, and a
 * run that somehow annotates ten thousand lines must not be the one that decides this process's memory.
 */
export const MAX_ANNOTATIONS = 500;

/** The default tail depth — enough to see the gate that printed an annotation, not the whole step. */
export const DEFAULT_TAIL_LINES = 40;

/**
 * The most characters one LINE may carry into the window.
 *
 * A tail bounded by line COUNT is not bounded at all if a line's length comes from the data, and a job step
 * is free to print a minified bundle or a one-line JSON dump with no newline in it — at which point the
 * splitter's carry would grow to the whole body and this read would reach the one JS string
 * `.claude/rules/typescript-patterns.md` forbids by the back door. So a line is capped too, and a capped one
 * is COUNTED and named in the report's residue rather than quietly shortened.
 *
 * 8192 is generous against what a runner actually emits. MEASURED on run 35502228255's `lint`
 * and `unit` jobs, the longest line in either is well inside it; reproduce with:
 *
 * ```bash
 * slopweaver github run-log 35502228255 --repo lachiejames/slopweaver --job unit --lines 2000 --json |
 *   jq '[.jobs[].log.tail[] | length] | max'
 * ```
 */
export const MAX_LINE_CHARS = 8192;

/**
 * How many distinct failing test files one job report keeps.
 *
 * A cap because the set is chosen by the log, and a suite that fails everywhere would otherwise decide this
 * process's memory; fifty because a reader past that many is reading a broken build, not a list of files.
 */
export const MAX_TEST_FILE_PATHS = 50;

/** One line the runner marked as a problem, with its marker stripped. */
export interface JobLogAnnotation {
  /** `error` or `warning`, from the marker the runner wrote. */
  readonly level: "error" | "warning";
  /** The message with `##[error]`/`##[warning]` removed — what a reader is meant to read. */
  readonly text: string;
}

/**
 * The window a `--from <text>` read keeps: the first line of the WHOLE job log containing `text`, and the lines
 * after it, at most the read's line bound.
 *
 * It exists because the tail cannot reach a finding printed far above the end of the step: a red lint step's
 * log can exceed the line ceiling, and a gate that fails with no annotation prints its finding under its own
 * `dev lint: <gate>` header, above the window.
 */
export interface JobLogFromWindow {
  /** The plain, case-sensitive substring searched for. */
  readonly text: string;
  /** The 1-based line number of the first line that contained it, or `undefined` when none did. */
  readonly firstLine: number | undefined;
  /** That line and the lines after it, oldest first, at most the read's line bound. */
  readonly lines: readonly string[];
  /** How many lines the whole job log held, so a reader knows where in it the window sits. */
  readonly logLines: number;
}

/** What one job's log yielded, already bounded. */
export interface JobLogSummary {
  /** Every annotation kept, oldest first, capped at {@link MAX_ANNOTATIONS}. */
  readonly annotations: readonly JobLogAnnotation[];
  /** How many annotations were seen past the cap and therefore NOT kept — never silently zero. */
  readonly annotationsDropped: number;
  /** The last `tailLines` lines of the region, oldest first. */
  readonly tail: readonly string[];
  /** How many lines the region held in total, so a reader knows what the tail is a tail OF. */
  readonly regionLines: number;
  /** Whether the runner's `Process completed` line was seen — `false` means the region ran to end of log. */
  readonly closed: boolean;
  /** How many lines were longer than {@link MAX_LINE_CHARS} and kept only as their first that many. */
  readonly linesTruncated: number;
  /**
   * Every failing test file the WHOLE log named, first-seen order, at most {@link MAX_TEST_FILE_PATHS} —
   * `./testFailurePaths.ts`. Read from every streamed line, not from the window, because a runner prints
   * the failing file far from both the annotations and the tail.
   */
  readonly testFilePaths: readonly string[];
  /**
   * How many distinct failing test files were named past the cap and therefore NOT kept — itself counted only
   * up to {@link MAX_TEST_FILE_PATHS}, so a reader of a full count knows it is a floor.
   */
  readonly testFilePathsDropped: number;
  /**
   * The forward window a `--from` read asked for, or `undefined` on a tail read. When present, {@link tail} is
   * empty: one read keeps one window, so the bound a caller typed is the bound held in memory.
   */
  readonly from: JobLogFromWindow | undefined;
}

/**
 * Strip the leading ISO-8601 timestamp GitHub prefixes to every log line.
 *
 * Every line arrives as `<timestamp>Z <text>`: a fixed 28-character stamp and one space. It
 * is removed because it is 29 characters of identical noise on every line of a bounded tail, and the
 * instants a reader wants — when the job and step ran — come from the jobs API with no guessing.
 *
 * A line that does not carry the stamp is returned untouched rather than blindly sliced, so a chunk
 * boundary or a future format change degrades to a readable line instead of a decapitated one.
 *
 * @param line one raw log line
 * @returns the line without its timestamp prefix
 */
export function stripLogTimestamp({ line }: { line: string }): string {
  const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /u.exec(line);
  if (match === null) {
    return line;
  }
  return line.slice(match[0].length);
}

/**
 * The annotation one line carries, or `undefined` when it carries none.
 *
 * @param line one log line, already stripped of its timestamp
 * @returns the typed annotation, or `undefined`
 */
export function lineAnnotation({ line }: { line: string }): JobLogAnnotation | undefined {
  // The step's own close is an `##[error]`, and it says only that the exit code was non-zero — which the
  // job's conclusion already said. Reporting it as an annotation would put a line carrying no information
  // at the top of every single report.
  if (line.startsWith(STEP_CLOSE_PREFIX)) {
    return undefined;
  }
  const prefix = ANNOTATION_PREFIXES.find((candidate) => line.startsWith(candidate));
  if (prefix === undefined) {
    return undefined;
  }
  return { level: prefix === "##[error]" ? "error" : "warning", text: line.slice(prefix.length) };
}

/** Whether this line is the runner's `Process completed` close for a step. */
function isStepCloseLine({ line }: { line: string }): boolean {
  return line.startsWith(STEP_CLOSE_PREFIX);
}

/** Whether this line opens a collapsible group — the marker a step's own log begins with. */
function isGroupOpenLine({ line }: { line: string }): boolean {
  return line.startsWith(GROUP_PREFIX);
}

/**
 * A fixed-size window over a line stream, which ends the window where the runner ended the last STEP.
 *
 * It is a class rather than a fold over an array because the whole point is that the array never exists —
 * lines arrive from a streamed HTTP body and are dropped as soon as they leave the window. Everything it
 * decides is a pure function of the lines it has been given, so a test drives it by calling {@link push}
 * and reading {@link summary}, with no I/O and no mock anywhere.
 *
 * ## The snapshot, and why a live ring buffer is not enough
 *
 * The lines a reader wants end at the runner's `##[error]Process completed with exit code N.`, not at the
 * end of the log — MEASURED on run 35502228255, 34 lines of post-job `git config --unset` cleanup follow it
 * and would otherwise BE the entire tail. A streamed reader cannot know which close is the last one until
 * the body ends, so every close takes a SNAPSHOT of the window as it then stands, and the final summary
 * reports the last snapshot taken. That costs one array copy per step, never one per line.
 */
export class JobLogAccumulator {
  /** The tail depth this accumulator keeps. */
  private readonly tailLines: number;

  /** Annotations kept so far, oldest first, never longer than {@link MAX_ANNOTATIONS}. */
  private readonly annotations: JobLogAnnotation[] = [];

  /** Annotations seen after the cap was reached. */
  private dropped = 0;

  /** Lines that arrived longer than {@link MAX_LINE_CHARS}; reported, never silently shortened. */
  private truncated = 0;

  /** The tail ring, oldest first, never longer than {@link tailLines}. */
  private readonly tail: string[] = [];

  /** Every line offered since construction, whether kept or dropped. */
  private seen = 0;

  /** Failing test files named so far, first-seen order, never longer than {@link MAX_TEST_FILE_PATHS}. */
  private readonly testFiles: string[] = [];

  /** Distinct failing test files named after the cap was reached. */
  private readonly testFilesDropped = new Set<string>();

  /** The line index of the most recent `##[group]` marker — where the current step's own output began. */
  private lastGroupAt = 0;

  /** The window as it stood at the most recent close, or `undefined` when no close has been seen. */
  private closedAt: { tail: readonly string[]; annotations: readonly JobLogAnnotation[]; lines: number } | undefined;

  /** The `--from` substring, or `undefined` on a tail read. */
  private readonly fromText: string | undefined;

  /** The 1-based line number of the first line containing {@link fromText}, once one has arrived. */
  private fromFirstLine: number | undefined;

  /** The forward window from that line, never longer than {@link tailLines}. */
  private readonly fromLines: string[] = [];

  /**
   * @param tailLines how many lines to keep — trailing ones, or with `from` the ones from its first match; a
   *   non-positive value keeps none
   * @param from keep a forward window opening at the first line containing this plain substring INSTEAD of a tail
   */
  public constructor({ tailLines, from }: { tailLines: number; from?: string }) {
    this.tailLines = tailLines;
    this.fromText = from;
  }

  /**
   * Keep the line in the forward window when it opens or extends it. Once the window is full nothing more is
   * kept, while the stream itself goes on through annotations, test files and step closes.
   */
  private keepFromLine({ line }: { line: string }): void {
    if (this.fromText === undefined) {
      return;
    }
    if (this.fromFirstLine === undefined) {
      if (!line.includes(this.fromText)) {
        return;
      }
      this.fromFirstLine = this.seen;
    }
    if (this.fromLines.length < this.tailLines) {
      this.fromLines.push(line);
    }
  }

  /** The forward window as it stands, or `undefined` on a tail read. */
  private fromWindow(): JobLogFromWindow | undefined {
    if (this.fromText === undefined) {
      return undefined;
    }
    return { firstLine: this.fromFirstLine, lines: [...this.fromLines], logLines: this.seen, text: this.fromText };
  }

  /**
   * Record that lines arrived longer than {@link MAX_LINE_CHARS} and were kept only as their first that many.
   *
   * Separate from {@link push} because the truncation happens in {@link splitStreamChunk}, before a line is
   * a line: the splitter is where the cap has to bite, and this is where the count is kept with the other
   * residue the summary reports.
   *
   * @param count how many lines this chunk truncated
   */
  public recordTruncated({ count }: { count: number }): void {
    this.truncated += count;
  }

  /** Keep one named failing test file up to the cap, then count distinct ones past it up to the same cap. */
  private keepTestFile({ path }: { path: string }): void {
    if (this.testFiles.includes(path)) {
      return;
    }
    if (this.testFiles.length < MAX_TEST_FILE_PATHS) {
      this.testFiles.push(path);
      return;
    }
    if (this.testFilesDropped.size < MAX_TEST_FILE_PATHS) {
      this.testFilesDropped.add(path);
    }
  }

  /** Keep the line's annotation, if it carries one, up to the cap; past it, count it as dropped. */
  private keepAnnotation({ line }: { line: string }): void {
    const annotation = lineAnnotation({ line });
    if (annotation === undefined) {
      return;
    }
    if (this.annotations.length < MAX_ANNOTATIONS) {
      this.annotations.push(annotation);
      return;
    }
    this.dropped += 1;
  }

  /**
   * Offer one line to the window, which keeps what it must and drops the rest.
   *
   * @param line one log line, already stripped of its timestamp
   */
  public push({ line }: { line: string }): void {
    this.seen += 1;
    for (const path of testFilePathsFromLine({ line })) {
      this.keepTestFile({ path });
    }
    this.keepAnnotation({ line });
    this.keepFromLine({ line });
    if (this.tailLines > 0 && this.fromText === undefined) {
      this.tail.push(line);
      if (this.tail.length > this.tailLines) {
        this.tail.shift();
      }
    }
    if (isGroupOpenLine({ line })) {
      this.lastGroupAt = this.seen - 1;
    }
    if (isStepCloseLine({ line })) {
      this.closedAt = {
        annotations: [...this.annotations],
        lines: this.seen - this.lastGroupAt,
        tail: [...this.tail],
      };
    }
  }

  /**
   * What this window holds right now.
   *
   * @returns the bounded summary — the last step's snapshot when one exists, otherwise the live window
   */
  public summary(): JobLogSummary {
    const closed = this.closedAt;
    if (closed === undefined) {
      return {
        annotations: [...this.annotations],
        annotationsDropped: this.dropped,
        closed: false,
        from: this.fromWindow(),
        linesTruncated: this.truncated,
        regionLines: this.seen,
        tail: [...this.tail],
        testFilePaths: [...this.testFiles],
        testFilePathsDropped: this.testFilesDropped.size,
      };
    }
    return {
      annotations: closed.annotations,
      annotationsDropped: this.dropped,
      closed: true,
      from: this.fromWindow(),
      linesTruncated: this.truncated,
      regionLines: closed.lines,
      tail: closed.tail,
      testFilePaths: [...this.testFiles],
      testFilePathsDropped: this.testFilesDropped.size,
    };
  }
}

/**
 * Split a stream of arbitrary text chunks into whole lines, carrying the partial line across the boundary.
 *
 * A chunk boundary landing mid-line is the ordinary case on a multi-megabyte body, not an edge: without
 * this, one line in the tail arrives as two halves and an `##[error]` split across chunks is never matched
 * at all. Pure, so the boundary behaviour is a unit test rather than a hope.
 *
 * @param chunk the text just read from the body
 * @param carry whatever the previous call left unterminated
 * @returns the whole lines this chunk completed, and the new carry
 */
export function splitStreamChunk({ chunk, carry }: { chunk: string; carry: string }): {
  lines: readonly string[];
  carry: string;
  truncated: number;
} {
  const combined = carry + chunk;
  const parts = combined.split("\n");
  // `split` always yields at least one element, and the last is whatever followed the final newline — an
  // empty string when the chunk ended cleanly. That element is the next carry, never a line.
  const rawCarry = parts[parts.length - 1];
  let truncated = 0;
  const lines = parts.slice(0, -1).map((part) => {
    const line = part.endsWith("\r") ? part.slice(0, -1) : part;
    if (line.length <= MAX_LINE_CHARS) {
      return line;
    }
    truncated += 1;
    return line.slice(0, MAX_LINE_CHARS);
  });
  // The carry is capped for the same reason, and the consequence is stated rather than hidden: once a line
  // has filled the cap without ending, the REST of that line is discarded as it arrives, and the window
  // keeps its first MAX_LINE_CHARS characters. The cap is MAX_LINE_CHARS + 1, not MAX_LINE_CHARS, so that
  // an over-long line is still OVER the cap when it finally ends and is counted exactly once by the branch
  // above — at MAX_LINE_CHARS it would arrive looking like a legitimate line of exactly that length.
  if (rawCarry === undefined) {
    return { carry: "", lines, truncated };
  }
  return { carry: rawCarry.slice(0, MAX_LINE_CHARS + 1), lines, truncated };
}
