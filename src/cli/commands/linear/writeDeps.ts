/**
 * The injectable edges of `slopweaver linear issue` (`./run.ts`), and the production wiring behind them — the
 * one place that verb reaches the token, the network, the identity rosters and the clock.
 */
import { readFileSync } from "node:fs";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import { linearToken } from "../../../config.js";
import { type LinearWriteApi, makeLinearWriteApi } from "../../../corpus/linear/write.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { AssigneeResolution } from "../../../outbound/linear/assigneeIndex.js";
import type { StateCatalog } from "../../../outbound/linear/stateCatalog.js";
import { linearWritePrivacy } from "../../../outbound/linear/writePrivacy.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { bareRefContext as bareRefContextFor } from "../../bareRefContext.js";
import {
  assigneeFromIdentity,
  assigneeFromIdentityUnrefreshed,
  type LinearMentionResolver,
  mentionsFromIdentity,
  mentionsFromIdentityUnrefreshed,
  stateCatalogFor,
} from "./wiring.js";

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface LinearWriteDeps {
  readonly readForm: (args: { source: string }) => string;
  /**
   * One environment variable, injected rather than read at the point of use — the above-the-fold override is
   * a DECISION, and a decision reached through ambient state is one no test can make.
   */
  readonly env: (args: { name: string }) => string | undefined;
  /** What this write's bare `#N`/`SUP-123` references can resolve against — see `../../bareRefContext.js`. */
  readonly bareRefContext: (args: { home: string }) => BareRefContext;
  readonly resolveToken: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => LinearWriteApi;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Resolve the form's `assignee` key against the store's identity roster, refreshing it just-in-time. */
  readonly resolveAssignee: (args: {
    home: string;
    person: string | undefined;
  }) => Promise<Result<AssigneeResolution, IdentityRosterError>>;
  /** The same resolution WITHOUT the refresh, so a dry run leaves no trace. */
  readonly previewAssignee: (args: {
    home: string;
    person: string | undefined;
  }) => Promise<Result<AssigneeResolution, IdentityRosterError>>;
  /** Resolve the body's `@{key}` mentions against the store's identity roster, refreshing it just-in-time. */
  readonly resolveMentions: LinearMentionResolver;
  /** The dry run's reading: the same resolution against the rosters as they STAND, leaving no trace. */
  readonly previewMentions: LinearMentionResolver;
  /** What `linear states` last read for the destination team, or undefined when it never has. */
  readonly stateCatalog: (args: { home: string; teamId: string }) => StateCatalog | undefined;
  /** The autonomy ledger an `--unasked` write records its act in. */
  readonly autonomy: AutonomyLedgerPort;
  /** The door ledger the write's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionLinearWriteDeps(): LinearWriteDeps {
  // One bag per verb call, so this is the write's ask instant — what the roster's freshness is judged against.
  const askedAtIso = new Date().toISOString();
  // The composition root for the roster port, as it is for the door ledger below.
  const identityRoster = identityRosterPort();
  return {
    autonomy: autonomyLedgerPort(),
    bareRefContext: ({ home }) => bareRefContextFor({ home }),
    doorLedger: doorLedgerPort(),
    env: ({ name }) => process.env[name],
    err: (line) => process.stderr.write(`linear issue: ${line}\n`),
    makeApi: ({ home, token }) => makeLinearWriteApi({ privacy: linearWritePrivacy({ home }), token }),
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    previewAssignee: ({ home, person }) => assigneeFromIdentityUnrefreshed({ home, identityRoster, person }),
    previewMentions: ({ home, keys, verified }) =>
      mentionsFromIdentityUnrefreshed({ home, identityRoster, keys, verified }),
    readForm: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
    resolveAssignee: ({ home, person }) => assigneeFromIdentity({ askedAtIso, home, identityRoster, person }),
    resolveMentions: ({ home, keys, verified }) =>
      mentionsFromIdentity({ askedAtIso, home, identityRoster, keys, verified }),
    resolveToken: ({ home }) => linearToken({ home }),
    stateCatalog: ({ home, teamId }) => stateCatalogFor({ home, teamId }),
  };
}
