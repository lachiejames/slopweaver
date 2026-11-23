/**
 * The effectful shell for `slopweaver github ci-timing` — every CI job's wall time, reported and never red.
 *
 * `github ci-runs` measures a window of runs; this reads ONE run, the one it is itself part of, and prints
 * each job's wall time. It runs as its own workflow job with `needs:` every lane and `if: always()`, so the
 * durations are GitHub's own, taken after the jobs completed, rather than a step timing itself from inside
 * the job it is measuring. It exits 0 whenever it produced a report: the owner ruled CI job timing
 * reported, not red — `docs/toolchain/ci-timing.md`.
 */

import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { ciTimingRows, parseGithubCiTimingArgs, renderCiTimingText } from "./ciTimingCore.js";
import { type GithubCiTimingDeps, productionGithubCiTimingDeps } from "./ciTimingEdges.js";
import { githubCiTimingUsage } from "./ciUsage.js";

const VERB_ARG_OFFSET = 4;

/** The workflow job this report runs in. It is still running while it reads, so it is left out by name. */
export const CI_TIMING_JOB_NAME = "ci-timing";

/**
 * Run one `github ci-timing` invocation against injected edges.
 *
 * A usage mistake exits `EXIT_USAGE`; a repository that will not resolve, or a run that cannot be read
 * whole, exits `EXIT_ERROR`, because then there is no report. Every report exits `EXIT_OK`, however slow a
 * job in it was.
 *
 * @param rest argv after `github ci-timing`
 * @param deps the repo-resolution, run-read and output seams
 * @returns the process exit code
 */
export async function runGithubCiTiming({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubCiTimingDeps;
}): Promise<number> {
  const parsed = parseGithubCiTimingArgs({ rest });
  if (parsed.isErr()) {
    for (const issue of parsed.error) {
      deps.writeDiagnostic(issue.message);
    }
    deps.writeDiagnostic(githubCiTimingUsage());
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const repo = deps.resolveRepo({ explicit: args.repo, home: args.home });
  if (repo.isErr()) {
    for (const problem of repo.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  const timings = await deps.readJobs({ home: args.home, repo: repo.value, runId: args.runId });
  if (timings.isErr()) {
    deps.writeDiagnostic(timings.error.message);
    return EXIT_ERROR;
  }
  const rows = ciTimingRows({ ownJobName: CI_TIMING_JOB_NAME, timings: timings.value });
  deps.writeOut(renderCiTimingText({ rows, runId: args.runId }));
  return EXIT_OK;
}

/** `slopweaver github ci-timing` — the verb the manifest loads. */
export const githubCiTimingCommand = defineCommand({
  run: (argv) => runGithubCiTiming({ deps: productionGithubCiTimingDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
