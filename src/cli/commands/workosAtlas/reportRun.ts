/**
 * `slopweaver atlas workos report [--json] [--home <dir>]` — where the surfaces disagree.
 *
 * No network call, and it resolves nothing. Owner's ruling, `docs/atlas-intent/04-corroboration.md`: a disagreement is an
 * OUTPUT, both records are kept, and which surface wins is the owner's call once they can see real instances. So this
 * prints the instances and picks no winner.
 *
 * ## Two halves, because this atlas has two things that can disagree
 *
 * The page half is the usual one — the API channel's declared addresses against the browser channel's
 * witnesses. The family half is this atlas's own, and it is the one that has real instances TODAY: it is
 * the running API disagreeing with this repository's candidate table, family by family. A family with
 * absent rows is where the local denominator and the running server part company, which is the finding a
 * reader can act on before any browser has ever run.
 */
import { workosDisagreementReport, workosFamilyCoverage } from "../../../atlas/workos/disagreement.js";
import { readWorkosKindFile, workosAtlasPaths } from "../../../atlas/workos/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

import { WORKOS_VERB_INDEX } from "./syncRun.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const WORKOS_REPORT_USAGE = "usage: slopweaver atlas workos report [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseReportOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * Run the WorkOS corroboration report.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function workosAtlasReportCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: WORKOS_VERB_INDEX, verbs: ["report"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: WORKOS_REPORT_USAGE });
    return EXIT_OK;
  }
  const options = parseReportOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: WORKOS_REPORT_USAGE });
    return EXIT_USAGE;
  }
  const paths = workosAtlasPaths({ home: options.value.home });
  const pages = readWorkosKindFile({ kind: "page", paths });
  if (pages.isErr()) {
    pages.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const operations = readWorkosKindFile({ kind: "operation", paths });
  if (operations.isErr()) {
    operations.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  if (pages.value === null || operations.value === null) {
    logger.error({ msg: "the workos atlas holds no generation yet — run `slopweaver atlas workos sync`" });
    return EXIT_ERROR;
  }
  const report = workosDisagreementReport({ pages: pages.value.entities });
  const families = workosFamilyCoverage({ operations: operations.value.entities });
  if (options.value.json) {
    logger.out({ line: JSON.stringify({ families, pages: report }, null, 1) });
    return EXIT_OK;
  }
  logger.out({
    line:
      `workos surfaces — ${String(report.declaredCount)} declared dashboard address(es), ` +
      `${String(report.witnessedCount)} witnessed by a walk, ` +
      `${String(report.disagreements.length)} disagreement(s)`,
  });
  report.disagreements.forEach((finding) => {
    const reason = finding.reason === null ? "" : ` — ${finding.reason}`;
    logger.out({ line: `  ${finding.finding}  ${finding.providerId}${reason}` });
  });
  logger.out({ line: "route families — present/absent, as the running server judged this repo's candidates" });
  families.forEach((family) => {
    logger.out({
      line: `  ${String(family.present)} present, ${String(family.absent)} absent  ${family.family}`,
    });
  });
  return EXIT_OK;
}
