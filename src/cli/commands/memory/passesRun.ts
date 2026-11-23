/**
 * `slopweaver memory passes` — when the memory hygiene pass last ran, and how stale that is.
 *
 * The atlas page shows how long since the last memory hygiene pass. Nothing
 * answered it: `memory hygiene` RUNS a pass and `memory sweep` lays out the corpus, so the only way to know
 * was to read the ledger by hand. This verb is that read, and nothing else — it proposes nothing, writes
 * nothing, and never touches a memory file.
 *
 * The effectful edge is this file: it resolves the home, reads the ledger's lines and takes the clock. The
 * fold is `src/memory/hygiene/passes.ts`.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { hygieneLedgerPath, readHygieneLedgerRows } from "../../../memory/hygiene/ledger.js";
import { hygienePasses } from "../../../memory/hygiene/passes.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";

const USAGE = "usage: slopweaver memory passes [--home <dir>] [--json]";

/** Every flag this verb accepts, exported so `helpTruth` compares its behaviour rather than its prose. */
export const MEMORY_PASSES_FLAG_NAMES: readonly string[] = ["--home", "--json"];

/** What the verb was asked for. */
export interface MemoryPassesArgs {
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse the verb tail through the real parser the runner uses.
 *
 * Returns the default `Result<T>` rather than a domain union, per `.claude/rules/error-handling.md`: these
 * are display-only messages no caller branches on.
 *
 * @param rest the verb tail, after `slopweaver memory passes`
 * @returns the parsed arguments, or the refusal lines to print
 */
export function parseMemoryPassesArgs({ rest }: { rest: readonly string[] }): Result<MemoryPassesArgs> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: { boolean: ["json"], string: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const home = parsed.value.values["home"];
  let resolved: string | undefined;
  if (typeof home === "string") {
    resolved = home;
  }
  return ok({ home: resolved, json: parsed.value.values["json"] === true });
}

/**
 * Run the verb.
 *
 * @param argv the full process argv (the verb tail starts at index 3)
 * @returns the process exit code
 */
export function runMemoryPasses(argv: readonly string[]): number {
  const rest = argv.slice(3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseMemoryPassesArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: `memory passes: ${problem}` });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const { home, json } = parsed.value;
  const scoped = home === undefined ? {} : { home };
  const report = hygienePasses({
    ledgerPath: hygieneLedgerPath(scoped),
    nowIso: new Date().toISOString(),
    rows: readHygieneLedgerRows(scoped),
  });
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "memory passes report", value: report }) });
    return EXIT_OK;
  }
  if (report.lastPassIso === undefined) {
    logger.out({ line: `memory passes: no hygiene pass has ever run on this home (${report.ledgerPath})` });
    return EXIT_OK;
  }
  const days = report.daysSinceLastPass;
  let age = "today";
  if (days !== undefined && days > 0) {
    age = `${String(days)} day(s) ago`;
  }
  logger.out({
    line:
      `memory passes: ${String(report.passes.length)} pass(es) recorded; the last ran ${age} ` +
      `(${report.lastPassIso})\n  ledger: ${report.ledgerPath}`,
  });
  for (const pass of report.passes) {
    logger.out({
      line:
        `  ${pass.tsIso}  ${String(pass.proposals)} proposal(s) · ` +
        `${String(pass.accepted)} accepted · ${String(pass.refused)} refused`,
    });
  }
  return EXIT_OK;
}

export const memoryPassesCommand = defineCommand({ run: runMemoryPasses });
