/**
 * `slopweaver atlas graphql-hive report [--json] [--home <dir>]` — where the two surfaces disagree.
 *
 * No network call, and it resolves nothing. Owner's ruling, `docs/atlas-intent/04-corroboration.md`: a disagreement is an
 * OUTPUT, both records are kept, and which surface wins is the owner's call once they can see real instances. So this
 * prints the instances and picks no winner.
 */
import { hiveDisagreementReport } from "../../../atlas/graphqlHive/disagreement.js";
import { hiveAtlasPaths, readHiveKindFile } from "../../../atlas/graphqlHive/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

import { HIVE_VERB_INDEX } from "./syncRun.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const HIVE_REPORT_USAGE = "usage: slopweaver atlas graphql-hive report [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseReportOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * Run the GraphQL Hive corroboration report.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function graphqlHiveAtlasReportCommand(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: HIVE_VERB_INDEX, verbs: ["report"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HIVE_REPORT_USAGE });
    return EXIT_OK;
  }
  const options = parseReportOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: HIVE_REPORT_USAGE });
    return EXIT_USAGE;
  }
  const file = readHiveKindFile({ kind: "page", paths: hiveAtlasPaths({ home: options.value.home }) });
  if (file.isErr()) {
    file.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  if (file.value === null) {
    logger.error({
      msg: "the graphql-hive atlas holds no page generation yet — run `slopweaver atlas graphql-hive sync`",
    });
    return EXIT_ERROR;
  }
  const report = hiveDisagreementReport({ pages: file.value.entities });
  if (options.value.json) {
    logger.out({ line: JSON.stringify(report, null, 1) });
    return EXIT_OK;
  }
  logger.out({
    line:
      `graphql-hive surfaces — ${String(report.declaredCount)} declared address(es), ` +
      `${String(report.witnessedCount)} witnessed by a walk, ` +
      `${String(report.disagreements.length)} disagreement(s)`,
  });
  report.disagreements.forEach((finding) => {
    const reason = finding.reason === null ? "" : `  ${finding.reason}`;
    logger.out({ line: `  ${finding.finding}  ${finding.providerId}${reason}` });
  });
  return EXIT_OK;
}
