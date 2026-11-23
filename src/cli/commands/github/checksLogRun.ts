/**
 * `github checks --log`'s own shell: one checks read, then the log of every check that failed.
 *
 * It lives beside `./checksRun.ts` rather than inside it because the two are different SHAPES of run. The
 * status and event paths (`./checksRun.ts` and `./checksEventWatch.ts`) are polling loops that print one
 * line per change; this is a single read that prints a bounded report per failed job and exits. Keeping them
 * in one file is what pushed that file past the `file-size-ratchet` floor, and the seam between a watch and a
 * one-shot read is a real one.
 */

import { renderJobLogText } from "../../../live/github/jobLogReport.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../exitCodes.js";
import { noFailedCheckLine, selectCheckLogs } from "./checksLogCore.js";
import type { GithubChecksDeps, PollTarget } from "./checksSeams.js";

/**
 * `--log`: one read of the head's checks, then the log of every check that failed.
 *
 * It exits `EXIT_EXPECTED_EMPTY` on a green head rather than `EXIT_OK`, for the same reason the status path
 * does: "nothing failed" is a legitimate non-success STATUS, so `github checks --log || alert` still fires
 * and nobody reads a silent success as a log that was read and found clean.
 *
 * @param deps the injected edges
 * @param target the pull request to read
 * @param lines how many trailing lines of each failing step to print
 * @returns the process exit code
 */
export async function runChecksLog({
  deps,
  target,
  lines,
}: {
  deps: GithubChecksDeps;
  target: PollTarget;
  lines: number;
}): Promise<number> {
  const fetched = await deps.fetchChecks({
    home: target.home,
    limit: target.limit,
    number: target.number,
    owner: target.owner,
    repo: target.repo,
  });
  if (fetched.isErr()) {
    deps.writeDiagnostic(fetched.error.message);
    return EXIT_ERROR;
  }
  const selection = selectCheckLogs({ snapshot: fetched.value });
  for (const name of selection.unreadable) {
    deps.writeDiagnostic(`${name} failed but carries no Actions job URL — its log is not GitHub's to serve`);
  }
  if (selection.groups.length === 0) {
    deps.writeOut(noFailedCheckLine({ snapshot: fetched.value }));
    return EXIT_EXPECTED_EMPTY;
  }
  for (const group of selection.groups) {
    const read = await deps.readJobLogs({
      home: target.home,
      jobIds: group.jobIds,
      lines,
      owner: target.owner,
      repo: target.repo,
      runId: group.runId,
    });
    if (read.isErr()) {
      deps.writeDiagnostic(read.error.message);
      return EXIT_ERROR;
    }
    deps.writeOut(renderJobLogText({ document: read.value }));
  }
  return EXIT_EXPECTED_EMPTY;
}
