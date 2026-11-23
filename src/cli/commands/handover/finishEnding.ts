/**
 * What `handover finish` WRITES and PRINTS once every gate above it has passed.
 *
 * Split out of `./lifecycle.ts` along the same seam `../../../handover/settleEnding.ts` uses one level up: the
 * refusals are one file's job and the ending is another's. `finishRun` then reads as a sequence of one-line
 * refusals followed by one call, which is the shape a reviewer can hold — and `lifecycle.ts` stays inside the
 * size the ratchet records.
 *
 * A `--dry-run` reaches {@link reportFinishDryRun} and writes nothing at all, which is that flag's whole
 * contract: the journal is byte-identical afterwards.
 */
import { lastSignOff } from "../../../handover/attention.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { type BoundPark, finishOwnershipPrecondition } from "../../../handover/parkedFinish.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { currentSessionId } from "../../../handover/runOwner.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { RunContext } from "./runContextTypes.js";

/**
 * Journal the `finished` event and say what the session owes next.
 *
 * The write and its two lines rather than a branch in {@link finishRun}: every refusal above it is one line,
 * and the reader of that sequence should not have to carry a four-line `applyRowEvent` call to reach the end
 * of it.
 *
 * @param context the resolved doc, whose events the sign-off line reads
 * @param residue the unmet probes carried onto the event
 * @param log where the refusal and the closing lines go; omitted, the process logger
 * @param park the one park this finish may close, checked on the append's own read
 * @returns the process exit code
 */
export function journalFinished({
  context,
  nowIso,
  park,
  residue,
  runsDir,
  log = logger,
}: {
  context: RunContext;
  nowIso: string;
  park?: BoundPark | undefined;
  residue: readonly string[];
  runsDir: string;
  log?: Logger;
}): number {
  const slug = context.doc.slug;
  // Ownership again, on the append's own read: a claim landing while the gates ran must not be closed underneath.
  const precondition = finishOwnershipPrecondition({
    park,
    phase: context.run.phase,
    sessionId: currentSessionId({ env: process.env }),
  });
  const event = { atIso: nowIso, kind: "finished", residue } as const;
  const appended = applyRowEvent({ event, precondition, runsDir, slug });
  if (appended.isErr()) {
    log.error({ msg: `handover finish: ${appended.error.message}` });
    return EXIT_ERROR;
  }
  log.out({ line: `handover finish: closed the run for ${slug}` });
  log.out({ line: `  when the PR merges: slopweaver handover close ${slug} --summary "<what shipped>"` });
  reportSignOff({ events: context.events, log });
  return EXIT_OK;
}

/**
 * Print the exact `finished` event a real `finish` would journal, and write nothing.
 *
 * @param nowIso the instant the event would carry
 * @param residue the unmet probes, which on this path is always empty
 * @param slug the doc's slug, named in the line so a piped dry run says which doc it previewed
 * @param log where the preview lines go; omitted, the process logger
 * @returns the success exit code — a dry run that reached here passed every gate
 */
export function reportFinishDryRun({
  nowIso,
  residue,
  slug,
  log = logger,
}: {
  nowIso: string;
  residue: readonly string[];
  slug: string;
  log?: Logger;
}): number {
  log.out({ line: JSON.stringify({ atIso: nowIso, kind: "finished", residue }, null, 2) });
  log.out({
    line: `dry run — nothing was written. every gate passed for ${slug}; \`handover finish\` without --dry-run would close the run.`,
  });
  return EXIT_OK;
}

/**
 * Say whether anyone OTHER than this session has vouched for the run being closed.
 *
 * Said at the moment of closing rather than only in the sweep, because this is the moment the closing session can
 * still do something about it. Measured: a run closed itself without ever checking in, and the board
 * printed a plain `DONE` nobody could distinguish from a real completion until the owner happened to ask. Naming
 * the absence here does not PREVENT a self-close — a sign-off is attributable, not authenticated — it makes one
 * visible to the session doing it.
 */
function reportSignOff({ events, log }: { events: readonly RunEvent[]; log: Logger }): void {
  const signed = lastSignOff({ events });
  log.out({
    line:
      signed === undefined
        ? "  NOT SIGNED OFF — nobody but this session has vouched for it; `slopweaver handover sign-off` records a second party"
        : `  signed off by ${signed.by} at ${signed.atIso}`,
  });
}
