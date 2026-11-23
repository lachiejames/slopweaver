/**
 * How a {@link JobLogDocument} is rendered.
 *
 * Split from `./jobLogRead.ts` for the same reason `./runHistoryReport.ts` is split from `./runHistory.ts`:
 * the read and its presentation stay separable, and the file-size ratchet has one reason less to fire.
 *
 * The ORDER here is the point of the whole verb. Annotations come first and in full, then the tail —
 * because MEASURED on run 35502228255 the annotations naming the defect sat 860 lines above the end of the
 * failing step, and a report that led with a tail would have printed eighteen passing gates and none of the
 * answer. See `./jobLog.ts`'s header.
 */

import { safeJsonStringify } from "../../lib/safeJson.js";
import type { JobLogDocument, JobLogEntry } from "./jobLogRead.js";

/** The header line naming the run this report is about. */
function runHeading({ document }: { document: JobLogDocument }): string {
  const parts = [`run ${String(document.run.id)}`, document.repo];
  if (document.run.name !== undefined) {
    parts.push(document.run.name);
  }
  if (document.run.headBranch !== undefined) {
    parts.push(document.run.headBranch);
  }
  if (document.run.conclusion !== undefined) {
    parts.push(document.run.conclusion);
  }
  return parts.join(" · ");
}

/** The line naming one job and the step it failed at. */
function jobHeading({ entry }: { entry: JobLogEntry }): string {
  let conclusion = "still running";
  if (entry.conclusion !== undefined) {
    conclusion = entry.conclusion;
  }
  if (entry.failedStep === undefined) {
    return `job ${entry.name} (${String(entry.jobId)}) ${conclusion}, naming no failed step`;
  }
  return (
    `job ${entry.name} (${String(entry.jobId)}) ${conclusion} at step ` +
    `${String(entry.failedStep.number)} "${entry.failedStep.name}"`
  );
}

/** Every annotation, in full, as indented lines — or the one line saying there were none. */
function annotationLines({ entry }: { entry: JobLogEntry }): readonly string[] {
  if (entry.log.annotations.length === 0) {
    return ["  no ##[error] or ##[warning] annotations in this job's log"];
  }
  const heading = `  ${String(entry.log.annotations.length)} annotation(s):`;
  return [heading, ...entry.log.annotations.map((one) => `    [${one.level}] ${one.text}`)];
}

/** The bounded tail, with the count it is a tail of. */
function tailSection({ entry, tailLines }: { entry: JobLogEntry; tailLines: number }): readonly string[] {
  if (entry.log.tail.length === 0) {
    return ["  no log lines were kept — --lines was zero"];
  }
  const shown = Math.min(tailLines, entry.log.tail.length);
  return [
    `  last ${String(shown)} of ${String(entry.log.regionLines)} line(s):`,
    ...entry.log.tail.map((line) => `    ${line}`),
  ];
}

/** One job's whole block. */
function jobBlock({ entry, tailLines }: { entry: JobLogEntry; tailLines: number }): readonly string[] {
  const lines = [jobHeading({ entry }), ...annotationLines({ entry }), ...tailSection({ entry, tailLines })];
  if (entry.htmlUrl !== undefined) {
    lines.push(`  whole log: ${entry.htmlUrl}`);
  }
  return lines;
}

/**
 * Render one job-log document as the text a session reads.
 *
 * @param document the bounded read
 * @returns the whole report, newline-joined, with no trailing newline
 */
export function renderJobLogText({ document }: { document: JobLogDocument }): string {
  const lines: string[] = [runHeading({ document }), ""];
  for (const entry of document.jobs) {
    lines.push(...jobBlock({ entry, tailLines: document.tailLines }), "");
  }
  for (const note of document.residue) {
    lines.push(`residue: ${note}`);
  }
  return lines.join("\n");
}

/**
 * Render one job-log document as the machine-readable form.
 *
 * @param document the bounded read
 * @returns one JSON document
 */
export function renderJobLogJson({ document }: { document: JobLogDocument }): string {
  return safeJsonStringify({ label: "github run-log document", space: 2, value: document });
}
