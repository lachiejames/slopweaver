/**
 * What `slopweaver refresh` reports about its ingest — routing each tagged summary line to the stream it belongs
 * on, withholding the identifying labels when `--numbers-only` asked for a paste-safe capture, and publishing the
 * per-source supervisor-stream events.
 *
 * Kept apart from the shell because every lane that reports (activity ingest, member hydration, structural
 * hydration) writes through this one pair, and a second copy of the stdout/stderr split is exactly the kind of
 * duplication that lets one lane quietly print data on the diagnostics stream.
 */

import { bronzeDir } from "../../../corpus/corpusPaths.js";
import { publishSupervisorEvent } from "../../../events/store.js";
import { sanitiseLine } from "../../../lib/numbersOnly.js";
import { type RefreshResult, type RefreshSummaryLine, refreshStreamEvents } from "./core.js";
import type { RefreshDeps } from "./deps.js";

/**
 * Route one summary line to its stream. `out` is DATA on stdout and takes `{ line }`; `warn`/`error` are
 * diagnostics on stderr and take `{ msg }`. The old `sink[line.level](text)` blurred the two behind one
 * dynamic index — the split signatures now make the distinction explicit, which is the point of keeping
 * `out` a separate channel at all.
 *
 * Takes the resolved `text` rather than reading it off `line`, because one caller emits a `--numbers-only`
 * sanitised version and the others emit the line verbatim. Passing it explicitly keeps that visible at each
 * call site instead of hiding it behind a default.
 *
 * @param level the stream the line belongs on
 * @param sink the refresh logger seam
 * @param text the line's text, already sanitised if the caller needed to
 */
export function emitSummaryLine({
  level,
  sink,
  text,
}: {
  level: RefreshSummaryLine["level"];
  sink: RefreshDeps["logger"];
  text: string;
}): void {
  if (level === "out") {
    sink.out({ line: text });
    return;
  }
  sink[level]({ msg: text });
}

/**
 * Emit the refresh summary, each line on its own stream, sanitised when `--numbers-only` is on.
 *
 * The bronze path is withheld too: it contains an absolute HOME path, which the hygiene gate already treats as
 * a leak class in tracked files and which is no safer in a pasted capture.
 *
 * @param home the Slopweaver home, whose bronze path is the label to withhold
 * @param lines the tagged summary lines, in order
 * @param numbersOnly whether the operator asked for a paste-safe capture
 * @param sink the refresh logger seam
 */
export function emitRefreshSummary({
  home,
  lines,
  numbersOnly,
  sink,
}: {
  home: string;
  lines: readonly RefreshSummaryLine[];
  numbersOnly: boolean;
  sink: RefreshDeps["logger"];
}): void {
  for (const line of lines) {
    emitSummaryLine({
      level: line.level,
      sink,
      text: numbersOnly ? sanitiseLine({ label: bronzeDir({ home }), text: line.text }) : line.text,
    });
  }
}

/**
 * Publish one supervisor-stream event per source, so a corpus that has stopped moving is visible somewhere
 * other than a stderr line in a run nobody was watching.
 *
 * A failed publish is narrated as a warning and never sinks the refresh: the stream is an observability
 * surface bolted beside real work, and a refresh that discarded rows it had already written because a
 * notification file was unwritable would be strictly worse than one that carried on.
 *
 * @param deps the effectful seams (the logger the warning goes to)
 * @param home the Slopweaver home, which owns the stream file
 * @param nowIso the instant to stamp the events with
 * @param results the per-source ingest results, in run order
 */
export function publishRefreshEvents({
  deps,
  home,
  nowIso,
  results,
}: {
  deps: Pick<RefreshDeps, "logger">;
  home: string;
  nowIso: string;
  results: readonly RefreshResult[];
}): void {
  for (const event of refreshStreamEvents({ nowIso, results })) {
    const failure = publishSupervisorEvent({ event, home });
    if (failure !== undefined) {
      deps.logger.warn({
        msg: `refresh could not publish its ${event.kind} event for ${event.corpusSource}: ${failure}`,
      });
    }
  }
}
