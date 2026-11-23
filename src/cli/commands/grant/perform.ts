/**
 * `slopweaver grant perform` — the session journals what it ACTUALLY wrote, after writing it.
 *
 * The read-back is the point. A supervisor that quietly makes the edit itself leaves nothing to compare, so
 * an over-grant — a row that authorised one line and a session that wrote ten — is invisible forever. Here
 * the row and the result sit in one journal, and the comparison is byte for byte: a performance whose text is
 * not the row's change is refused on `CHANGE_MISMATCH` and NOT journalled, because a journal that accepts
 * anything records nothing.
 *
 * The check before the write is for the message; the write is what decides. Two sessions that both read
 * "not yet performed" race to one insert, and the store's one-performance-per-grant index lets exactly one land —
 * the other is `GRANT_ALREADY_PERFORMED`, never a second performance.
 */
import { readFileSync } from "node:fs";

import type { GrantCheckError } from "../../../grants/errors.js";
import type { GrantPerformance } from "../../../grants/grant.js";
import { logger } from "../../../lib/logger.js";
import { detectSupervisorSession, supervisorSessionProblem } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { checkRow } from "./checkRow.js";
import { type GrantPerformOptions, grantUsage, parseGrantPerformArgs, VERB_ARG_OFFSET } from "./core.js";
import { type GrantCommandDeps, productionGrantCommandDeps, reportGrantStoreError } from "./deps.js";

/**
 * Run `grant perform` over the store-backed journal.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runGrantPerform(argv: readonly string[]): Promise<number> {
  return runGrantPerformWithDeps({ argv, deps: productionGrantCommandDeps() });
}

/**
 * Run `grant perform` over whichever journal and environment it is handed.
 *
 * @param argv the full process argv
 * @param deps the journal port and the environment naming the acting session
 * @returns the process exit code — non-zero when a check failed, which is a finding rather than a fault
 */
export async function runGrantPerformWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GrantCommandDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: grantUsage({ verb: "perform" }) });
    return EXIT_OK;
  }
  const parsed = parseGrantPerformArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: grantUsage({ verb: "perform" }) });
    return EXIT_USAGE;
  }
  const detection = detectSupervisorSession({ env: deps.env });
  if (detection.kind !== "active") {
    logger.error({ msg: `grant perform: ${supervisorSessionProblem({ detection })}` });
    return EXIT_ERROR;
  }
  const { grantId, json, wrote } = parsed.value;
  const home = resolveHome({ named: parsed.value.home });
  const text = readBack({ wrote });
  if (text === undefined) {
    logger.error({ msg: "grant perform: could not read the read-back file named by --wrote-file" });
    return EXIT_ERROR;
  }
  const checked = await checkRow({ grantId, home, journal: deps.journal, proposedChange: text });
  if (checked.isErr()) {
    return reportGrantStoreError({ error: checked.error, json, verb: "perform" });
  }
  const { verified } = checked.value;
  if (verified.isErr()) {
    return reportCheckRefusal({ error: verified.error, grantId, json });
  }
  const performance: GrantPerformance = {
    grantId,
    performedAtIso: new Date().toISOString(),
    performedBySessionId: detection.session.id,
    wrote: text,
  };
  const written = await deps.journal.appendEntry({ entry: { kind: "performance", performance }, home });
  if (written.isErr()) {
    return reportGrantStoreError({ error: written.error, json, verb: "perform" });
  }
  if (json) {
    logger.out({ line: JSON.stringify({ ok: true, performance }) });
    return EXIT_OK;
  }
  logger.out({
    line: `grant perform: JOURNALLED against ${grantId} — the row and what was written are now comparable.`,
  });
  return EXIT_OK;
}

/** Report a failed check on the row: nothing was journalled, and the refusal verb that records why. */
function reportCheckRefusal({
  error,
  grantId,
  json,
}: {
  error: GrantCheckError;
  grantId: string;
  json: boolean;
}): number {
  if (json) {
    logger.out({ line: JSON.stringify({ error, ok: false }) });
    return EXIT_ERROR;
  }
  logger.error({ msg: `grant perform: REFUSED on ${error.code} — ${error.message}` });
  logger.error({
    msg: `grant perform: nothing was journalled. Record the refusal so it is readable: \`slopweaver grant refuse ${grantId} --check ${error.code} --why "…"\`.`,
  });
  return EXIT_ERROR;
}

/** The read-back text, or `undefined` when the named file could not be read. */
function readBack({ wrote }: { wrote: GrantPerformOptions["wrote"] }): string | undefined {
  if (wrote.kind === "inline") {
    return wrote.text;
  }
  try {
    return readFileSync(wrote.path, "utf8");
  } catch {
    return undefined;
  }
}

export const grantPerformCommand = defineCommand({ run: runGrantPerform });
