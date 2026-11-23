/**
 * `slopweaver atlas jumpcloud sync [--json] [--home <dir>]` — walk the Directory API and publish a
 * generation, or refuse and say exactly which family stopped it.
 *
 * The verb is deliberately thin. Every decision worth reviewing — what may be called, what may be stored,
 * whether a family completed, whether the generation may be published — lives under `src/atlas/jumpcloud`
 * where it is testable without a network call. What is here is argument parsing, the credential lookup, and
 * turning a report into lines.
 *
 * A refusal exits non-zero with the reasons on stderr, because a sync that published nothing and exited
 * zero is a sync a scheduler would record as a success.
 */
import { syncJumpcloudAtlas } from "../../../../atlas/jumpcloud/sync.js";
import { productionJumpcloudSyncDeps } from "../../../../atlas/jumpcloud/syncDeps.js";
import type { JumpcloudSyncReport } from "../../../../atlas/jumpcloud/syncPublish.js";
import { logger } from "../../../../lib/logger.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../../optionParsers.js";

/** Where a JumpCloud verb sits: past the runtime, the script, the `atlas` noun and the `jumpcloud` platform. */
const JUMPCLOUD_VERB_INDEX = 4;

/**

 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const JUMPCLOUD_SYNC_USAGE = "usage: slopweaver atlas jumpcloud sync [--json] [--home <dir>]";

/**
 * Run the `atlas jumpcloud sync` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runJumpcloudSync(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: JUMPCLOUD_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: JUMPCLOUD_SYNC_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: JUMPCLOUD_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  const home = resolveHome({ named: values["home"] });
  const json = flags.has("json");
  const deps = productionJumpcloudSyncDeps({
    env: process.env,
    home,
    // Progress goes to stderr so `--json` stdout stays a single parseable document. A five-figure walk that
    // printed nothing for an hour is indistinguishable from one that has hung.
    progress: (line) => process.stderr.write(`jumpcloud sync: ${line}\n`),
  });
  if (deps.isErr()) {
    deps.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  const report = await syncJumpcloudAtlas({ deps: deps.value, home });
  if (report.isErr()) {
    report.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  return reportJumpcloudSync({ json, report: report.value });
}

/**
 * Print one sync report and decide the exit code.
 *
 * @param report what the sync did
 * @param json whether the caller asked for the machine-readable form
 * @returns the process exit code — non-zero when nothing was published
 * @internal
 */
export function reportJumpcloudSync({ report, json }: { report: JumpcloudSyncReport; json: boolean }): number {
  if (json) {
    logger.out({ line: JSON.stringify(report, null, 2) });
    return report.published ? EXIT_OK : EXIT_ERROR;
  }
  for (const kind of report.kinds) {
    logger.out({ line: `${kind.kind}: ${kind.state} — ${String(kind.entityCount)} entity(ies); ${kind.reason}` });
  }
  for (const refusal of report.refusals) {
    logger.error({ msg: refusal });
  }
  logger.out({
    line: report.published
      ? `published ${String(report.written.length)} file(s)`
      : "nothing was published — see the refusals above",
  });
  return report.published ? EXIT_OK : EXIT_ERROR;
}

export const jumpcloudSyncCommand = defineCommand({ run: runJumpcloudSync });
