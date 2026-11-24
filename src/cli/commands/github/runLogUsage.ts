/**
 * `github run-log`'s usage text and the one bound it quotes.
 *
 * A leaf, for the reason `.claude/rules/area-cli.md` § "Metadata is eager" gives: the manifest reads a
 * verb's usage EAGERLY, so a manifest that reached into `./runLogCore.ts` would pull that module's parser
 * and read seams onto the load path of every unrelated invocation. `commands/listen/listenUsage.ts` is the
 * shape; this file imports nothing but the constants its own text quotes.
 */

import { DEFAULT_TAIL_LINES, MAX_LINE_CHARS } from "../../../live/github/jobLog.js";

/**
 * The most lines one job may report — trailing ones, or with `--from` the ones from its first match.
 *
 * MEASURED over the last 20 failed `ci.yml` runs of `lachiejames/slopweaver`: the `lint` job's
 * whole log is ~1,115 lines and the `unit` job's reaches 25,195. A ceiling of 2,000 therefore covers a lint
 * lane's failing step several times over while refusing to turn a unit lane's log into the wall of text
 * this verb exists to replace. Reproduce:
 *
 * ```bash
 * slopweaver github run-log <run-id> --repo lachiejames/slopweaver --json | jq '.jobs[].log.regionLines'
 * ```
 *
 * A red lint step's log can exceed it, and a gate that fails with no annotation then prints its finding above
 * the window. `--from` is the way past that, not a higher ceiling.
 */
export const MAX_TAIL_LINES = 2000;

/** The whole `github run-log` usage block. */
export const GITHUB_RUN_LOG_USAGE =
  `usage: slopweaver github run-log <run-id> [--repo <owner/name>] [--job <name>] [--lines <0..${String(MAX_TAIL_LINES)}>]\n` +
  "                                [--from <text>] [--json] [--home <dir>]\n" +
  "  Prints what a failed CI job actually PRINTED, so a red leg is READ rather than reproduced. Without it\n" +
  "  the shortest path to `what did the lint lane say` was running the whole lane in this seat, which is\n" +
  "  the offload AGENTS.md § Toolchain forbids.\n" +
  "  Every ##[error]/##[warning] annotation comes FIRST and in full, then the tail of the failing step:\n" +
  "  measured, a red lint job's annotations sat 860 lines above the end of that step, so a report led by a\n" +
  "  tail prints the gates that PASSED and none of the answer.\n" +
  "  <run-id>           the Actions run — the number in an /actions/runs/<id> URL\n" +
  "  --repo <owner/name>  the repository; default the current checkout's `origin` remote\n" +
  "  --job <name>       read this job's log instead of every unsuccessful job in the run. A job that\n" +
  "                     PASSED is only ever reachable this way\n" +
  `  --lines <0..${String(MAX_TAIL_LINES)}>  how many trailing lines of each failing step to print, or with --from how\n` +
  `                     many from its match (default ${String(DEFAULT_TAIL_LINES)}).\n` +
  "                     The whole log is never printed: it is streamed and only this window is kept,\n" +
  "                     because a job log is data-sized and GitHub's log host serves no byte range\n" +
  "  --from <text>      keep, instead of the tail, the first line of each job's WHOLE log containing <text>\n" +
  "                     (plain, case-sensitive substring) and the lines after it, at most --lines of them.\n" +
  '                     For a finding printed far above the end of the step: --from "dev lint: <gate>"\n' +
  "                     opens a red lint job at that gate's own section. Annotations still come first.\n" +
  `                     A line past ${String(MAX_LINE_CHARS)} characters is matched only on what was kept of it\n` +
  "  --json             emit one machine-readable document instead of the text report\n" +
  "  --home <dir>       resolve the credential from this Slopweaver state home";
