/**
 * `slopweaver checkout console` — which build the console at localhost:3000 serves, against the checkout it is
 * served from and that checkout's upstream. The console's sidebar polls `--json` once a minute and compares it
 * with the build its own bundle was baked from (`site/lib/buildStanding.ts`); the text form is the same reading
 * for a terminal.
 *
 * It stands in the directory it was run from: the console spawns it from its own `site/`, so the checkout it
 * reads is the one serving the page. It exits 0 whenever it produced a reading, even one with problems — a
 * failed fetch or a missing record is evidence the page reports, not a broken tool.
 */
import { type ConsoleBuildReport } from "../../../checkouts/consoleBuild.js";
import { readConsoleBuild } from "../../../checkouts/consoleBuildRead.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { checkoutUsage, parseCheckoutArgs, VERB_ARG_OFFSET } from "./core.js";

/**
 * The served console as one line.
 *
 * @param report the reading
 * @returns what serves, on which port, and whether it is down
 */
function servedLine({ report }: { report: ConsoleBuildReport }): string {
  const { served } = report;
  if (served.kind === "none") {
    return `console: no server is recorded for ${report.root}`;
  }
  const down = served.live ? "" : " (DOWN)";
  if (served.kind === "dev") {
    return `console: a dev server on :${String(served.port)}${down}`;
  }
  return `console: serving ${served.sha.slice(0, 9)} on :${String(served.port)} since ${served.startedIso}${down}`;
}

/**
 * The rebuild as one line, when there is one to report.
 *
 * @param rebuild the reading's rebuild state
 * @returns the waiting build or the running round, else `undefined`
 */
function rebuildLine({ rebuild }: { rebuild: ConsoleBuildReport["rebuild"] }): string | undefined {
  if (rebuild.waiting !== undefined) {
    return `rebuild: ${rebuild.waiting.sha.slice(0, 9)} is built and waiting for a live voice call to end`;
  }
  if (rebuild.running) {
    return `rebuild: running — ${rebuild.logPath}`;
  }
  return undefined;
}

/**
 * The installed desktop app as one line, when an app is installed.
 *
 * @param app the reading's installed app
 * @param ref the upstream it was compared with
 * @returns whether its source matches the upstream's, else `undefined`
 */
function appLine({ app, ref }: { app: ConsoleBuildReport["installedApp"]; ref: string }): string | undefined {
  if (app.kind === "absent") {
    return undefined;
  }
  if (app.kind === "unreadable") {
    return "app: installed, build not known";
  }
  const built = `app: built from ${app.stamp.sha.slice(0, 9)}`;
  if (app.stamp.tree === "dirty") {
    return `${built} with uncommitted app changes`;
  }
  if (app.shellDiffers === undefined) {
    return `${built} — not compared with ${ref}`;
  }
  if (app.shellDiffers) {
    return `${built} — ${ref}'s app differs: a new version is available`;
  }
  return `${built} — the same app source as ${ref}`;
}

/**
 * The reading as a few terminal lines.
 *
 * @param report the reading
 * @returns one line per fact, the problems last
 */
export function consoleReportLines({ report }: { report: ConsoleBuildReport }): readonly string[] {
  const lines: string[] = [servedLine({ report })];
  const { head, upstream, mainline, rebuild } = report;
  if (head !== undefined) {
    lines.push(`HEAD: ${head.sha.slice(0, 9)}`);
  }
  if (upstream !== undefined) {
    let fetched = "never fetched";
    if (upstream.fetchedAtIso !== undefined) {
      fetched = `fetched ${upstream.fetchedAtIso}`;
    }
    lines.push(
      `${upstream.ref}: ${upstream.sha.slice(0, 9)} — HEAD is ${String(upstream.behind)} behind, ${String(upstream.ahead)} ahead (${fetched})`,
    );
    const app = appLine({ app: report.installedApp, ref: upstream.ref });
    if (app !== undefined) {
      lines.push(app);
    }
  }
  const rebuilt = rebuildLine({ rebuild });
  if (rebuilt !== undefined) {
    lines.push(rebuilt);
  }
  lines.push(
    `mainline: ${String(mainline.commits.length)} commit(s)${mainline.truncated ? ", older ones beyond" : ""}`,
  );
  for (const problem of report.problems) {
    lines.push(`problem: ${problem}`);
  }
  return lines;
}

/**
 * `checkout console` — report which build the console serves.
 *
 * @param argv the full process argv
 * @returns the process exit code — 0 for any reading, `EXIT_USAGE` for a bad flag
 */
export function runCheckoutConsole(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: checkoutUsage({ verb: "console" }) });
    return EXIT_OK;
  }
  const parsed = parseCheckoutArgs({ rest, verb: "console" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: checkoutUsage({ verb: "console" }) });
    return EXIT_USAGE;
  }
  const report = readConsoleBuild({ cwd: process.cwd(), nowMs: Date.now() });
  if (parsed.value.values["json"] === true) {
    logger.out({ line: JSON.stringify(report) });
    return EXIT_OK;
  }
  for (const line of consoleReportLines({ report })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/** `checkout console`, wrapped as a command module for the lazy manifest. */
export const checkoutConsoleCommand = defineCommand({ run: runCheckoutConsole });
