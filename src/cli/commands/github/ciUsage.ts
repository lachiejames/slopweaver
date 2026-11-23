/**
 * The usage lines of `slopweaver github`'s CI verbs — checks, ci-timing and ci-runs, with the defaults they quote, and
 * nothing else.
 *
 * A LEAF on purpose: `cli/manifests/githubCi.ts` reads these strings on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command
 * module, a string would put that module and everything it imports on every invocation's load path. The command modules
 * import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/**
 * The usage text for `github checks`.
 *
 * @returns exact command help, including only the flags its parser accepts
 */
export function githubChecksUsage(): string {
  return (
    "usage: slopweaver github checks --number <n> [--repo <owner/name>] [--wait] [--until ci|review|any|merge] " +
    "[--since <iso>] [--timeout-seconds <n>] [--limit <1..100>] [--json] [--home <dir>]\n" +
    "  Reports one pull request's CI checks as a compact status line — GitHub's own aggregate rollup for its\n" +
    "  head commit — instead of a raw `gh pr checks` polling loop dumping full output into the caller's own\n" +
    "  transcript on every poll. With --until it also watches reviews and comments, one event line per change\n" +
    "  --number <n>       the pull-request number\n" +
    "  --repo <owner/name>  the repository; default the current checkout's `origin` remote\n" +
    "  --wait             poll with a stepped backoff until every check reaches a terminal state, or the\n" +
    "                     timeout expires, instead of reporting the current state once and exiting\n" +
    "  --until <mode>     implies --wait, and prints only CHANGES as event lines (HEAD, CI PASS|FAIL, REVIEW,\n" +
    "                     COMMENT, MERGED|CLOSED, WATCH-DONE) instead of a status line per poll: `ci` stops on\n" +
    "                     the CI verdict, `review` on the first new review of the current head, `any` on the\n" +
    "                     first of those or a comment, `merge` only when the pull request merges or closes.\n" +
    "                     A rate-limited read prints RATE-LIMITED until <reset> and waits for it; a reset past\n" +
    "                     the timeout, or any other failed read, ends on WATCH-FAILED and exits 1 — a pipe\n" +
    "                     reports its LAST command's exit, so read that line rather than the pipe's status\n" +
    "  --since <iso>      the cursor for --until: only a review or comment after this UTC ISO-8601 instant\n" +
    "                     (ending in Z) is an event; default now. Reviews by you, and comments by you or a\n" +
    "                     [bot], are never events\n" +
    "  --timeout-seconds <n>  how long `--wait` may poll before giving up (default 1200 — roughly double\n" +
    "                     this repository's own measured 9m23s typical CI lap)\n" +
    "  --limit <1..100>   cap the number of individual checks requested (default 100, the connection maximum)\n" +
    "  --log              print what the FAILED checks actually printed — every ##[error] annotation in full,\n" +
    "                     then the tail of each failing step — instead of a status line. The same read as\n" +
    "                     `github run-log`, reached from a pull request so no run id has to be found. One\n" +
    "                     shot: it cannot be combined with --wait or --until\n" +
    "  --lines <0..2000>  how many trailing lines of each failing step --log prints (default 40)\n" +
    "  --json             emit one machine-readable document with the final snapshot instead of status lines\n" +
    "  --home <dir>       resolve the credential from this Slopweaver state home"
  );
}

/**
 * The usage text for `github ci-timing`.
 *
 * @returns exact command help, including only the flags its parser accepts
 */
export function githubCiTimingUsage(): string {
  return (
    "usage: slopweaver github ci-timing --run-id <n> [--repo <owner/name>] [--home <dir>]\n" +
    "  Print every job of ONE workflow run with its wall time, slowest first, and exit 0 whenever a report\n" +
    "  was produced. It never fails on a job's time: CI timing is reported, not red. Every ATTEMPT of the\n" +
    "  run is read and each job timed on the last attempt that ran it, so a re-run of failed jobs does not\n" +
    "  report the jobs it left alone as never run. A skipped job, or one with no start or end instant,\n" +
    "  prints `not measured` with the reason rather than a number. The `ci-timing` job's own row is left\n" +
    "  out, because it is still running while it reads. docs/toolchain/ci-timing.md\n" +
    "  --run-id <n>       the workflow run to report; inside a workflow this is $GITHUB_RUN_ID. Omitted,\n" +
    "                     the verb refuses rather than guessing which run you meant\n" +
    "  --repo <owner/name>  the repository; default the current checkout's `origin` remote\n" +
    "  --home <dir>       resolve the credential from this Slopweaver state home"
  );
}

/**
 * The usage text for `github ci-runs`.
 *
 * @returns exact command help, including only the flags its parser accepts
 */
export function githubCiRunsUsage(): string {
  return (
    "usage: slopweaver github ci-runs [--repo <owner/name>] [--branch <name>] [--event push|pull_request|merge_group]\n" +
    "                                [--runs <1..100>] [--workflow <file>] [--steps] [--json] [--home <dir>]\n" +
    "  Times every CI JOB over a window of workflow runs — the measurement `github checks` cannot make,\n" +
    "  because that verb reports a pull request's check STATE and never how long a job took.\n" +
    "  Each job reports three figures kept apart on purpose: WALL (started→completed, the job's own work,\n" +
    "  which is what a five-minute bar is about), QUEUE (created→started) and the total a watcher sees.\n" +
    "  A job with `needs` reports its whole wait for those dependencies as queue time, so those jobs print\n" +
    "  `(needs)` rather than a number a reader would mistake for runner contention.\n" +
    "  --repo <owner/name>  the repository; default the current checkout's `origin` remote\n" +
    "  --branch <name>    the HEAD branch whose runs are read (default main), or `any` for no branch\n" +
    "                     filter at all. `any` is required to see a `pull_request` run: GitHub filters on\n" +
    "                     the run's own head ref, which for a pull request is the feature branch and never\n" +
    "                     the base — so `--event pull_request --branch main` matches nothing, every time\n" +
    "  --event <name>     push, pull_request or merge_group (default push). It MATTERS: a job declared\n" +
    "                     `if:` on one event is absent from another event's runs, and an absent job is not\n" +
    "                     a fast job\n" +
    "  --runs <1..100>    how many of the most recent runs to read (default 20)\n" +
    "  --workflow <file>  the workflow file name (default ci.yml)\n" +
    "  --steps            also break each job into its own steps, in declared order — the half that names\n" +
    "                     WHICH of install, lint or test a slow job is slow in, rather than that it is\n" +
    "  --json             emit one machine-readable document instead of the ranked table\n" +
    "  --home <dir>       resolve the credential from this Slopweaver state home"
  );
}
