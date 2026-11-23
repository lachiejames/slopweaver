/**
 * `slopweaver org-health status` — where the organisation stands, off the last snapshot `org-health read` wrote.
 *
 * The quiet channel, read on demand: the console sidebar's Incidents
 * indicator that once polled it no longer exists. It reads the local store and the home only
 * and makes no Slack call: the snapshot row
 * always, and while an incident is open the board's `incident-*` rows, their journals and the hand register, for
 * whether the fleet is looking into it (`../../../orgHealth/investigationRead.ts`, never a board scan), and the
 * acknowledgement rows, for whether they acknowledged it since it last moved (`../../../orgHealth/acknowledgement.ts`).
 * The judgement is `../../../orgHealth/standing.ts`, the same one the `org-health` monitor makes, so this verb and
 * the note never disagree about whether the snapshot can be believed. A reading that cannot be believed — a store
 * that cannot be reached included — still exits 0: the document says `unmeasurable` and why.
 */
import { logger } from "#lib/logger.js";

import { type Acknowledgement, acknowledgementsOf } from "../../../orgHealth/acknowledgement.js";
import type { Investigation } from "../../../orgHealth/investigation.js";
import { readInvestigations } from "../../../orgHealth/investigationRead.js";
import { type OrgHealthPort, orgHealthPort } from "../../../orgHealth/port.js";
import { orgHealthStanding, orgHealthStatus } from "../../../orgHealth/standing.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { orgHealthReadOptions, statusLines } from "./core.js";
import { ORG_HEALTH_STATUS_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own arguments: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The seams `org-health status` runs through. */
export interface OrgHealthStatusDeps {
  readonly nowMs: () => number;
  /** The store the snapshot and the acknowledgements are read from. */
  readonly orgHealthPort: OrgHealthPort;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `org-health status` against injected seams.
 *
 * @param rest the argv tail after `org-health status`
 * @param deps the clock, the store and the two sinks
 * @returns the process exit code
 */
export async function runOrgHealthStatus({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OrgHealthStatusDeps;
}): Promise<number> {
  const options = orgHealthReadOptions({ rest });
  if (options.isErr()) {
    for (const line of [...options.error, ORG_HEALTH_STATUS_USAGE]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: options.value.home });
  let nowMs = deps.nowMs();
  if (options.value.nowMs !== undefined) {
    nowMs = options.value.nowMs;
  }
  const standing = orgHealthStanding({ nowMs, snapshot: await deps.orgHealthPort.readSnapshot({ home }) });
  let investigations: ReadonlyMap<string, Investigation> = new Map();
  let acknowledgements: ReadonlyMap<string, Acknowledgement> = new Map();
  if (standing.state === "measured") {
    investigations = readInvestigations({ home, open: standing.open });
    const ledger = await deps.orgHealthPort.readAcknowledgements({ home });
    acknowledgements = acknowledgementsOf({
      ledger: ledger.isOk() ? { rows: ledger.value } : { because: ledger.error.message },
      open: standing.open,
    });
  }
  const status = orgHealthStatus({ acknowledgements, investigations, standing });
  for (const line of statusLines({ json: options.value.json, status })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/** `slopweaver org-health status`. */
export const orgHealthStatusCommand = defineCommand({
  run: (argv) =>
    runOrgHealthStatus({
      deps: {
        nowMs: () => Date.now(),
        orgHealthPort: orgHealthPort(),
        writeDiagnostic: (line) => {
          logger.error({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
