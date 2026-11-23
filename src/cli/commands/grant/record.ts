/**
 * `slopweaver grant record` — the supervisor writes down ONE decision the owner already made, in a shape the
 * session that performs it can check.
 *
 * It refuses to run outside a visible session, because a row whose recorder is a bare process names nobody.
 * It records whether the recording session held the supervisor pin, as ONE fact a reader may weigh —
 * `grants/grant.ts` says why that is never the property that makes a row trustworthy.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import type { GrantRow } from "../../../grants/grant.js";
import { logger } from "../../../lib/logger.js";
import { isRegisteredSupervisor } from "../../../sessions/supervisorPin.js";
import { readSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { detectSupervisorSession, supervisorSessionProblem } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type GrantRecordOptions, grantUsage, parseGrantRecordArgs, VERB_ARG_OFFSET } from "./core.js";
import { type GrantCommandDeps, productionGrantCommandDeps, reportGrantStoreError } from "./deps.js";

/**
 * Run `grant record` over the store-backed journal.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runGrantRecord(argv: readonly string[]): Promise<number> {
  return runGrantRecordWithDeps({ argv, deps: productionGrantCommandDeps() });
}

/**
 * Run `grant record` over whichever journal and environment it is handed. One id is minted and written once; a
 * lost insert is `GRANT_ID_TAKEN`, and is never answered by minting another and trying again.
 *
 * @param argv the full process argv
 * @param deps the journal port and the environment naming the recording session
 * @returns the process exit code
 */
export async function runGrantRecordWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GrantCommandDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: grantUsage({ verb: "record" }) });
    return EXIT_OK;
  }
  const parsed = parseGrantRecordArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: grantUsage({ verb: "record" }) });
    return EXIT_USAGE;
  }
  const detection = detectSupervisorSession({ env: deps.env });
  if (detection.kind !== "active") {
    logger.error({ msg: `grant record: ${supervisorSessionProblem({ detection })}` });
    return EXIT_ERROR;
  }
  const options = parsed.value;
  const change = changeText({ source: options.change });
  if (change === undefined) {
    logger.error({ msg: "grant record: could not read the change named by --change-file" });
    return EXIT_ERROR;
  }
  const home = resolveHome({ named: options.home });
  const pin = readSupervisorPin({ home });
  const grant: GrantRow = {
    anchor: options.anchor,
    change,
    changeKind: options.changeKind,
    id: `g-${randomUUID().slice(0, 8)}`,
    pinnedAtRecord: isRegisteredSupervisor({ record: pin, session: detection.session }),
    recordedAtIso: new Date().toISOString(),
    recordedBySessionId: detection.session.id,
    target: options.target,
  };
  const written = await deps.journal.appendEntry({ entry: { grant, kind: "grant" }, home });
  if (written.isErr()) {
    return reportGrantStoreError({ error: written.error, json: options.json, verb: "record" });
  }
  printRecorded({ grant, json: options.json });
  return EXIT_OK;
}

/** The change text, inline or read from `--change-file`; `undefined` when that file could not be read. */
function changeText({ source }: { source: GrantRecordOptions["change"] }): string | undefined {
  if (source.kind === "inline") {
    return source.text;
  }
  try {
    return readFileSync(source.path, "utf8");
  } catch {
    return undefined;
  }
}

/** Print the recorded row: the row itself under `--json`, else where to read it and what it does not buy. */
function printRecorded({ grant, json }: { grant: GrantRow; json: boolean }): void {
  if (json) {
    logger.out({ line: JSON.stringify(grant) });
    return;
  }
  logger.out({
    line: `grant record: RECORDED ${grant.id} — the performing session reads it with \`slopweaver grant show ${grant.id}\``,
  });
  logger.out({
    line: "grant record: this row is ORIGIN, not authority — it does not widen access, address a new audience, authorise spend, or make an irreversible act safe.",
  });
}

export const grantRecordCommand = defineCommand({ run: runGrantRecord });
