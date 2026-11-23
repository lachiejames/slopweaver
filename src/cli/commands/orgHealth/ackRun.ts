/**
 * `slopweaver org-health ack` — they acknowledged an open incident, so `org-health status` stops asking for their attention
 * about it until it moves (`../../../orgHealth/acknowledgement.ts`).
 *
 * It is LOCAL: one `org_health_acknowledgement` row in the local store (`../../../orgHealth/port.ts`), nothing sent to
 * incident.io, Slack or any person. The row's fingerprint is taken from the live snapshot, judged by the same
 * `orgHealthStanding` `org-health status` reads, never from the caller, so an ack can only acknowledge the state the snapshot holds now. A
 * snapshot that cannot be believed — a store that cannot be reached included — a reference that is not open, or one
 * the snapshot holds open more than once, writes nothing.
 */
import { logger } from "#lib/logger.js";

import { acknowledgementRowFor, ambiguousRefBecause } from "../../../orgHealth/acknowledgement.js";
import { AcknowledgementErrors } from "../../../orgHealth/acknowledgementErrors.js";
import { type OrgHealthPort, orgHealthPort } from "../../../orgHealth/port.js";
import { orgHealthStanding } from "../../../orgHealth/standing.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { ackLines, orgHealthAckOptions } from "./core.js";
import { ORG_HEALTH_ACK_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own arguments: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The seams `org-health ack` runs through. */
export interface OrgHealthAckDeps {
  readonly nowMs: () => number;
  /** The store the snapshot is judged from and the press is recorded in. */
  readonly orgHealthPort: OrgHealthPort;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Say a refusal on the diagnostic sink and, under `--json`, as the one stdout line.
 *
 * @returns the exit code
 */
function refuse({
  deps,
  json,
  code,
  message,
  exit,
}: {
  deps: OrgHealthAckDeps;
  json: boolean;
  code: string;
  message: string;
  exit: number;
}): number {
  deps.writeDiagnostic(`org-health ack: ${message}`);
  if (json) {
    deps.writeOut(JSON.stringify({ code, ok: false, why: message }));
  }
  return exit;
}

/**
 * Run `org-health ack` against injected seams.
 *
 * @param rest the argv tail after `org-health ack`
 * @param deps the clock, the store and the two sinks
 * @returns the process exit code
 */
export async function runOrgHealthAck({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OrgHealthAckDeps;
}): Promise<number> {
  const options = orgHealthAckOptions({ rest });
  if (options.isErr()) {
    for (const line of [...options.error, ORG_HEALTH_ACK_USAGE]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const { json, ref, bySession } = options.value;
  const home = resolveHome({ named: options.value.home });
  let nowMs = deps.nowMs();
  if (options.value.nowMs !== undefined) {
    nowMs = options.value.nowMs;
  }
  const standing = orgHealthStanding({ nowMs, snapshot: await deps.orgHealthPort.readSnapshot({ home }) });
  if (standing.state === "unmeasurable") {
    const { code, message } = AcknowledgementErrors.notMeasured({ because: standing.because });
    return refuse({ code, deps, exit: EXIT_EXPECTED_EMPTY, json, message });
  }
  const matches = standing.open.filter((open) => open.ref === ref);
  const incident = matches.at(0);
  if (incident === undefined) {
    const { code, message } = AcknowledgementErrors.notOpen({ ref });
    return refuse({ code, deps, exit: EXIT_EXPECTED_EMPTY, json, message });
  }
  if (matches.length > 1) {
    const because = ambiguousRefBecause({ count: matches.length, ref });
    const { code, message } = AcknowledgementErrors.ambiguousRef({ because, ref });
    return refuse({ code, deps, exit: EXIT_EXPECTED_EMPTY, json, message });
  }
  // Read before appending: behind a row that will not decode, status calls every acknowledgement unmeasured, so a
  // press that appended anyway would report a quiet status can never print.
  const ledger = await deps.orgHealthPort.readAcknowledgements({ home });
  if (ledger.isErr()) {
    return refuse({ code: ledger.error.code, deps, exit: EXIT_ERROR, json, message: ledger.error.message });
  }
  const row = acknowledgementRowFor({ acknowledgedIso: new Date(nowMs).toISOString(), bySession, incident });
  const appended = await deps.orgHealthPort.appendAcknowledgement({ home, row });
  if (appended.isErr()) {
    return refuse({ code: appended.error.code, deps, exit: EXIT_ERROR, json, message: appended.error.message });
  }
  for (const line of ackLines({ json, row })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/** `slopweaver org-health ack`. */
export const orgHealthAckCommand = defineCommand({
  run: (argv) =>
    runOrgHealthAck({
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
