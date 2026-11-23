/**
 * The edges `linear document create|update` reaches through — the one bag a test swaps for plain fakes.
 */
import { readFileSync } from "node:fs";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { linearToken } from "../../../config.js";
import { type LinearDocumentWriteApi, makeLinearDocumentWriteApi } from "../../../corpus/linear/writeDocument.js";
import { logger } from "../../../lib/logger.js";
import { linearWritePrivacy } from "../../../outbound/linear/writePrivacy.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { bareRefContext as bareRefContextFor } from "../../bareRefContext.js";
import { type LinearMentionResolver, mentionsFromIdentity, mentionsFromIdentityUnrefreshed } from "./wiring.js";

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface LinearDocumentWriteDeps {
  readonly readForm: (args: { source: string }) => string;
  /** One environment variable, injected because the above-the-fold override is a DECISION a test must make. */
  readonly env: (args: { name: string }) => string | undefined;
  /** What the page's bare `#N`/`SUP-123` references can resolve against — see `../../bareRefContext.js`. */
  readonly bareRefContext: (args: { home: string }) => BareRefContext;
  /** Resolve the page's `@{key}` mentions against the store's identity roster, refreshing it just-in-time. */
  readonly resolveMentions: LinearMentionResolver;
  /** The dry run's reading: the same resolution against the rosters as they STAND, leaving no trace. */
  readonly previewMentions: LinearMentionResolver;
  readonly resolveToken: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => LinearDocumentWriteApi;
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
export function productionLinearDocumentWriteDeps(): LinearDocumentWriteDeps {
  // One bag per verb call, so this is the write's ask instant — what the roster's freshness is judged against.
  const askedAtIso = new Date().toISOString();
  // The composition root for the roster port, as it is for the door ledger below.
  const identityRoster = identityRosterPort();
  return {
    bareRefContext: ({ home }) => bareRefContextFor({ home }),
    doorLedger: doorLedgerPort(),
    env: ({ name }) => process.env[name],
    err: (line) => process.stderr.write(`linear document: ${line}\n`),
    makeApi: ({ home, token }) => makeLinearDocumentWriteApi({ privacy: linearWritePrivacy({ home }), token }),
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    previewMentions: ({ home, keys, verified }) =>
      mentionsFromIdentityUnrefreshed({ home, identityRoster, keys, verified }),
    readForm: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
    resolveMentions: ({ home, keys, verified }) =>
      mentionsFromIdentity({ askedAtIso, home, identityRoster, keys, verified }),
    resolveToken: ({ home }) => linearToken({ home }),
  };
}
