/**
 * `slopweaver dev capture-conflicts` — count, against the corpus on disk, the rows whose winner the capture
 * marker decides.
 *
 * This is the verb that keeps `latestRecords.supersedes`'s first tie-break honest. That rule exists because a
 * repaired capture is byte-for-byte its truncated predecessor MINUS the marker that says it was truncated, so
 * a length-only tie-break systematically kept the truncated row. The number is a property of the real corpus
 * and cannot be derived from a fixture, so it is measured here rather than asserted anywhere.
 *
 * A count is never a verdict: bronze is append-only, so a conflicting pair is the NORMAL, permanent record of
 * a repair having happened, and the verb exits clean whatever it finds. Only an unreadable file makes it fail,
 * because a count over part of a source is not a count. Effectful shell only; the tally and the rendering are
 * {@link ./captureConflictsCore}.
 */
import { type BronzeListError, listBronzeFiles } from "../../../corpus/bronzeStorage.js";
import { parseRow } from "../../../corpus/corpusRowCore.js";
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import type { CorpusSource } from "../../../corpus/types.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  absorbCaptureRecord,
  type CaptureConflictCount,
  DEV_CAPTURE_CONFLICTS_USAGE,
  deriveCaptureConflicts,
  emptyCaptureConflictTally,
  parseCaptureConflictsSource,
  parseDevCaptureConflictsArgs,
  renderCaptureConflicts,
} from "./captureConflictsCore.js";

/**
 * Stream one source's whole bronze tree through the tally.
 *
 * A corrupt line is SKIPPED, exactly as every other reader skips it — a row nobody can read is not in the
 * corpus whose view this measures. A source the owner's protect list refuses is the listing's own error, never a
 * count over nothing.
 */
function scan({ home, source }: { home: string; source: CorpusSource }): Result<CaptureConflictCount, BronzeListError> {
  const listed = listBronzeFiles({ home, source });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const tally = emptyCaptureConflictTally();
  const unreadable: string[] = [];
  for (const file of listed.value) {
    try {
      readJsonlLines({
        onLine: ({ line }) => {
          if (line.trim().length === 0) {
            return;
          }
          const parsed = parseRow({ line, projection: "retrieval" });
          if ("record" in parsed) {
            absorbCaptureRecord({ record: parsed.record, tally });
          }
        },
        path: file.path,
      });
    } catch {
      unreadable.push(file.path);
    }
  }
  return ok(deriveCaptureConflicts({ source, tally, unreadable }));
}

/** Parse the flag tail and the source it names, reporting every usage error through the logger. */
function parseOrReportUsage({
  rest,
  log,
}: {
  rest: readonly string[];
  log: Pick<Logger, "error">;
}): { home: string | undefined; json: boolean; source: CorpusSource } | undefined {
  const parsed = parseDevCaptureConflictsArgs({ rest });
  if (parsed.isErr()) {
    [...parsed.error, DEV_CAPTURE_CONFLICTS_USAGE].forEach((error) => {
      log.error({ msg: error });
    });
    return undefined;
  }
  const { values } = parsed.value;
  const source = parseCaptureConflictsSource({
    value: typeof values["source"] === "string" ? values["source"] : undefined,
  });
  if (source.isErr()) {
    [...source.error, DEV_CAPTURE_CONFLICTS_USAGE].forEach((error) => {
      log.error({ msg: error });
    });
    return undefined;
  }
  return {
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
    source: source.value,
  };
}

/**
 * Run the capture-conflicts verb over an injected logger — the testable shell.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev capture-conflicts <tail>`)
 * @param log the diagnostic + data sinks
 * @returns EXIT_OK when the whole source was read, EXIT_ERROR when part of it could not be, EXIT_USAGE on a
 *   bad flag
 */
export function runDevCaptureConflictsWithDeps({
  argv,
  log,
}: {
  argv: readonly string[];
  log: Pick<Logger, "error" | "out">;
}): number {
  const rest = argv.slice(4);
  if (rest.includes("--help") || rest.includes("-h")) {
    log.out({ line: DEV_CAPTURE_CONFLICTS_USAGE });
    return EXIT_OK;
  }
  const args = parseOrReportUsage({ log, rest });
  if (args === undefined) {
    return EXIT_USAGE;
  }
  const scanned = scan({ home: resolveHome({ named: args.home }), source: args.source });
  if (scanned.isErr()) {
    log.error({ msg: scanned.error.message });
    return EXIT_ERROR;
  }
  const count = scanned.value;
  if (args.json) {
    log.out({ line: JSON.stringify(count) });
  } else {
    for (const line of renderCaptureConflicts({ count })) {
      log.out({ line });
    }
  }
  return count.unreadable.length === 0 ? EXIT_OK : EXIT_ERROR;
}

/**
 * Run the capture-conflicts verb.
 *
 * @param argv the full process argv (verb tail starts at index 4 — `dev capture-conflicts <tail>`)
 * @returns the process exit code — see {@link runDevCaptureConflictsWithDeps}
 */
export function runDevCaptureConflicts(argv: readonly string[]): number {
  return runDevCaptureConflictsWithDeps({ argv, log: logger });
}

export const devCaptureConflictsCommand = defineCommand({ run: runDevCaptureConflicts });
