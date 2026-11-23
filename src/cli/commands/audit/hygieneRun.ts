/**
 * `slopweaver audit hygiene` — the leak gate, run over the CORPUS rather than over the repository.
 *
 * A read-only, local, zero-token check, exactly like its sibling `audit run`. The classification lives in
 * {@link ../../../hygiene/corpusScan}; this is the parse, the dispatch and the exit code.
 *
 * The exit code is the whole contract: 0 only when every enumerated file was READ and no CREDENTIAL shape
 * was found. An identifier and a private-denylist word are reported and never fail — see
 * {@link ../../../hygiene/corpusScan} for why the three arms mean different things on a corpus, and for the
 * measurement that moved identifiers out of the failing one. An unreadable bronze file fails, because a
 * file the gate did not check is not a file it found clean.
 */
import { type CorpusSource } from "../../../corpus/types.js";
import {
  type CorpusHit,
  type CorpusScanResult,
  renderCorpusScan,
  scanCorpusHygiene,
} from "../../../hygiene/corpusScan.js";
import { renderCorpusScrub, scrubCorpusCredentials } from "../../../hygiene/corpusScrub.js";
import { ALL_CORPUS_SOURCES } from "../../../integrations/corpusSources.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagTailSpec, parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";
import { type AuditArgsError, AuditArgsErrors, auditArgsErrorLines } from "./errors.js";
import { AUDIT_HYGIENE_USAGE } from "./hygieneUsage.js";

/** The flags this verb accepts, exported for the repo-wide help-truth ratchet. */
export const AUDIT_HYGIENE_FLAGS = {
  boolean: ["json", "scrub"],
  value: ["home", "source"],
} as const satisfies FlagTailSpec;

/** Every accepted flag, with the `--` callers type — both lists are declared on the literal above. */
export const AUDIT_HYGIENE_FLAG_NAMES: readonly string[] = [
  ...AUDIT_HYGIENE_FLAGS.value,
  ...AUDIT_HYGIENE_FLAGS.boolean,
].map((name) => `--${name}`);

/** What a valid invocation asks for. */
export interface AuditHygieneOptions {
  readonly home: string | undefined;
  readonly source: CorpusSource | undefined;
  readonly json: boolean;
  /** Rewrite the flagged lines instead of only reporting them. */
  readonly scrub: boolean;
}

/**
 * Parse the `audit hygiene` tail.
 *
 * @param rest the argv tail after `audit hygiene`
 * @returns the validated request, or the typed refusal — {@link auditArgsErrorLines} prints it
 */
export function parseAuditHygieneArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<AuditHygieneOptions, AuditArgsError> {
  const parsed = parseFlagTail({ rest, spec: AUDIT_HYGIENE_FLAGS });
  if (parsed.isErr()) {
    return err(AuditArgsErrors.flagsRefused({ reasons: parsed.error, usage: AUDIT_HYGIENE_USAGE }));
  }
  const raw = parsed.value.values["source"];
  const source = raw === undefined ? undefined : ALL_CORPUS_SOURCES.find((candidate) => candidate === raw);
  if (raw !== undefined && source === undefined) {
    return err(
      AuditArgsErrors.sourceUnknown({ expected: ALL_CORPUS_SOURCES, source: raw, usage: AUDIT_HYGIENE_USAGE }),
    );
  }
  return ok({
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    scrub: parsed.value.flags.has("scrub"),
    ...(source === undefined ? { source: undefined } : { source }),
  });
}

/**
 * Run `audit hygiene` against injected output sinks.
 *
 * @param rest the argv tail after `audit hygiene`
 * @param writeOut the stdout sink, for the `--json` document
 * @param writeDiagnostic the stderr sink, for the human report
 * @returns the process exit code
 */
export function runAuditHygiene({
  rest,
  writeOut,
  writeDiagnostic,
}: {
  rest: readonly string[];
  writeOut: (line: string) => void;
  writeDiagnostic: (line: string) => void;
}): number {
  const parsed = parseAuditHygieneArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of auditArgsErrorLines({ error: parsed.error })) {
      writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const { home, source, json, scrub } = parsed.value;
  const resolved = resolveHome({ named: home });
  const scanned = scanCorpusHygiene({ home: resolved, source });
  if (scanned.isErr()) {
    // A protected corpus is NOT CHECKED, so it fails exactly as an unreadable file does — never a clean report.
    for (const line of scanned.error) {
      writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  const result = scanned.value;
  emitScan({ json, result, source, writeDiagnostic, writeOut });
  const scanExit = result.leaks.length === 0 && result.unreadable.length === 0 ? EXIT_OK : EXIT_ERROR;
  if (!scrub) {
    return scanExit;
  }
  return repair({ home: resolved, leaks: result.leaks, scanExit, writeDiagnostic });
}

/**
 * Print the scan on the lane the caller asked for: the whole result as one `--json` document on stdout, else the
 * human report on stderr.
 *
 * @param result what the scan established
 * @param json whether `--json` was passed
 * @param source the source the scan was narrowed to, which the human report names
 * @param writeOut the stdout sink
 * @param writeDiagnostic the stderr sink
 */
function emitScan({
  result,
  json,
  source,
  writeOut,
  writeDiagnostic,
}: {
  result: CorpusScanResult;
  json: boolean;
  source: CorpusSource | undefined;
  writeOut: (line: string) => void;
  writeDiagnostic: (line: string) => void;
}): void {
  if (json) {
    writeOut(JSON.stringify(result, undefined, 2));
    return;
  }
  for (const line of renderCorpusScan({ result, source })) {
    writeDiagnostic(line);
  }
}

/**
 * Run the repair off the scan's own failing arm, so it can only ever touch a line this run just reported.
 *
 * The exit code still comes from the SCAN, never from the repair: a repair that succeeded does not make the
 * corpus it started from clean, and the honest way to say so is to re-run the verb.
 *
 * @param home the resolved Slopweaver home
 * @param leaks the scan's failing arm
 * @param scanExit what the scan alone decided
 * @param writeDiagnostic the stderr sink
 * @returns the process exit code
 */
function repair({
  home,
  leaks,
  scanExit,
  writeDiagnostic,
}: {
  home: string;
  leaks: readonly CorpusHit[];
  scanExit: number;
  writeDiagnostic: (line: string) => void;
}): number {
  const repaired = scrubCorpusCredentials({ home, leaks });
  for (const line of renderCorpusScrub({ result: repaired })) {
    writeDiagnostic(line);
  }
  return repaired.failed.length > 0 ? EXIT_ERROR : scanExit;
}

/** `slopweaver audit hygiene`. */
export const auditHygieneCommand = defineCommand({
  run: (argv) =>
    runAuditHygiene({
      rest: verbTail({ argv, verbs: ["hygiene"] }),
      writeDiagnostic: (line) => {
        logger.warn({ msg: line });
      },
      writeOut: (line) => {
        logger.out({ line });
      },
    }),
});
