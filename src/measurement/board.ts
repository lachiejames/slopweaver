/**
 * Measuring the whole board ONCE, so every consumer reads the same computation.
 *
 * ## Why this file exists rather than a second reader
 *
 * `fleet status` prints the board to a terminal, `fleet status --json` hands it to a machine, and the pane
 * renders it as HTML. Three surfaces, and the failure mode is not hypothetical: a hand-maintained board that
 * disagreed with the repository caused duplicate work twice in one day (see {@link ./status}). A second
 * surface computing its own view of the same facts is the same defect wearing a different hat.
 *
 * So state is derived in exactly one place — {@link ./workstream.measureWorkstream} — and this module
 * is the single call site every surface goes through. A surface may choose what to SHOW; none of them may
 * choose what is TRUE.
 *
 * The shell here is effectful (it reads the board, git and `gh` through `measureWorkstream`). The clock is
 * injected rather than read, so a caller decides the instant every age is computed against and the JSON
 * renderer below stays pure.
 */

import type { HandoverDoc } from "../handover/doc.js";
import type { SessionRoster } from "./sessions.js";
import { type Measured, type WorkstreamStatus } from "./status.js";
import { fleetDocs, measureWorkstream, statusOf } from "./workstream.js";

/** One measurement of the whole board, with the instant and base it was taken against. */
export interface BoardMeasurement {
  /** Every measured workstream, in slug order. */
  readonly workstreams: readonly WorkstreamStatus[];
  /** Slugs the caller named that no doc on the board claims — a refusal to report, never a silent omission. */
  readonly unknown: readonly string[];
  /** Why the board could not be scanned at all, when it could not. */
  readonly problem: string | undefined;
  /** When the measurement was taken. Every age on every surface is relative to this. */
  readonly measuredAtIso: string;
  /** The base commits were counted against, or `undefined` when each repository's own trunk was resolved. */
  readonly base: string | undefined;
}

/**
 * Measure every workstream on the board.
 *
 * Nothing is cached and nothing is read from a stored view: a cache would hide exactly the drift the board
 * exists to surface.
 *
 * @param handoverDir where the orchestration docs live
 * @param runsDir where run journals and inboxes live
 * @param base the branch commits are counted against, or `undefined` to resolve each repository's own trunk
 * @param slugs the slugs the caller named, empty for the default set
 * @param nowMs the instant every age is computed against
 * @param roster the live sessions, read once and shared by every row so no two rows disagree
 * @returns the measurement, carrying its own instant and base so a surface never has to supply them again
 */
export function measureBoard({
  handoverDir,
  runsDir,
  base,
  slugs,
  nowMs,
  roster,
}: {
  handoverDir: string;
  runsDir: string;
  base: string | undefined;
  slugs: readonly string[];
  nowMs: number;
  roster: Measured<SessionRoster>;
}): BoardMeasurement {
  const found = fleetDocs({ handoverDir, runsDir, slugs });
  // Stamped when the measurement STARTS, not when it finishes. A full board takes about a minute, so the
  // two differ materially, and the start is the conservative answer: it is the age of the OLDEST fact in
  // the result. Stamping the end would let a workstream measured sixty seconds ago claim to be current.
  const measuredAtIso = new Date(nowMs).toISOString();
  const workstreams = found.docs.map((doc: HandoverDoc) => {
    const workstream = measureWorkstream({ base, doc, roster, runsDir });
    return statusOf({ nowMs, roster, workstream });
  });
  return { base, measuredAtIso, problem: found.problem, unknown: found.unknown, workstreams };
}

/**
 * The `problem` key as the JSON states it. A board that scanned has no problem, and `JSON.stringify` drops an
 * `undefined` key, so that board writes `null`: the key stays present and says "scanned" rather than vanishing.
 */
function problemJson({ board }: { board: BoardMeasurement }): string | null {
  const { problem } = board;
  if (problem === undefined) {
    return null;
  }
  return problem;
}

/**
 * The machine shape, for `fleet status --json` and for anything checking a rendered surface against it.
 *
 * `unknown` and `problem` are carried rather than dropped. A consumer that only received `workstreams` could
 * not tell "the board is empty" from "the board could not be read", which is the absent-row-reads-as-fine
 * failure this codebase keeps paying for.
 *
 * Pure: it takes a measurement and returns text.
 *
 * @param board the measurement to serialise
 * @returns the pretty-printed JSON payload, the sole stdout body in `--json` mode
 */
export function renderBoardJson({ board }: { board: BoardMeasurement }): string {
  return JSON.stringify(
    {
      base: board.base,
      measuredAtIso: board.measuredAtIso,
      problem: problemJson({ board }),
      unknownSlugs: board.unknown,
      workstreams: board.workstreams,
    },
    null,
    2,
  );
}
