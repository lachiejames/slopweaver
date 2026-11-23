/**
 * The injectable edges of `slopweaver linear initiative` (`./initiativeRun.ts`) and their live wiring — the
 * form reader, the environment, the bare-reference context, the token, the Linear initiative API, the clock,
 * the output sinks and the door ledger. A test supplies plain functions in their place; nothing here is a mock.
 */
import { readFileSync } from "node:fs";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { linearToken } from "../../../config.js";
import { type LinearInitiativeWriteApi, makeLinearInitiativeWriteApi } from "../../../corpus/linear/writeInitiative.js";
import { logger } from "../../../lib/logger.js";
import { linearWritePrivacy } from "../../../outbound/linear/writePrivacy.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { bareRefContext as bareRefContextFor } from "../../bareRefContext.js";

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface LinearInitiativeWriteDeps {
  readonly readForm: (args: { source: string }) => string;
  /** One environment variable, injected rather than read at the point of use — see `./projectRun.ts`. */
  readonly env: (args: { name: string }) => string | undefined;
  /** What this write's bare `#N`/`SUP-123` references can resolve against. */
  readonly bareRefContext: (args: { home: string }) => BareRefContext;
  readonly resolveToken: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => LinearInitiativeWriteApi;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The door ledger the write's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionLinearInitiativeWriteDeps(): LinearInitiativeWriteDeps {
  return {
    bareRefContext: ({ home }) => bareRefContextFor({ home }),
    doorLedger: doorLedgerPort(),
    env: ({ name }) => process.env[name],
    err: (line) => process.stderr.write(`linear initiative: ${line}\n`),
    makeApi: ({ home, token }) => makeLinearInitiativeWriteApi({ privacy: linearWritePrivacy({ home }), token }),
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    readForm: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
    resolveToken: ({ home }) => linearToken({ home }),
  };
}
