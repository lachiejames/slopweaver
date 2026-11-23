/**
 * The injectable edges of `slopweaver alias` (`./run.ts`) and their live wiring: the Cloudflare Email Routing
 * operations bound to one guarded client, the token, the output sinks and the door ledger. A test supplies
 * plain functions in their place; nothing here is a mock.
 */

import type Cloudflare from "cloudflare";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { AliasError } from "../../../alias/errors.js";
import type { AliasRule } from "../../../alias/rules.js";
import { createCloudflareClient } from "../../../atlas/cloudflare/client.js";
import { cloudflareToken } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import {
  type CatchAllTarget,
  createForwardRule,
  getCatchAll,
  listRules,
  type ResolvedZone,
  requireRoutingEnabled,
  requireVerifiedDestination,
  resolveZone,
  setCatchAll,
} from "../../../live/cloudflare/emailRouting.js";

/**
 * Every Cloudflare Email Routing operation this verb performs, already bound to one client.
 *
 * Bound rather than taking a client per call so a test supplies six plain functions and never a client at
 * all — there is no mock here, and nothing under test has to pretend to be an SDK.
 */
export interface AliasRouting {
  readonly resolveZone: (args: { zone: string }) => Promise<Result<ResolvedZone, AliasError>>;
  readonly requireRoutingEnabled: (args: { zone: ResolvedZone }) => Promise<Result<undefined, AliasError>>;
  readonly listRules: (args: { zone: ResolvedZone }) => Promise<Result<readonly AliasRule[], AliasError>>;
  readonly requireVerifiedDestination: (args: {
    zone: ResolvedZone;
    destination: string;
  }) => Promise<Result<undefined, AliasError>>;
  readonly createForwardRule: (args: {
    zone: ResolvedZone;
    address: string;
    destination: string;
  }) => Promise<Result<AliasRule, AliasError>>;
  readonly getCatchAll: (args: { zone: ResolvedZone }) => Promise<Result<AliasRule, AliasError>>;
  readonly setCatchAll: (args: {
    zone: ResolvedZone;
    target: CatchAllTarget;
  }) => Promise<Result<AliasRule, AliasError>>;
}

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface AliasDeps {
  readonly resolveToken: (args: { home: string }) => string | undefined;
  readonly makeRouting: (args: { token: string }) => AliasRouting;
  readonly out: (args: { line: string }) => void;
  readonly err: (args: { line: string }) => void;
  /** The door ledger each alias write's decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/**
 * Bind every routing operation to one guarded Cloudflare client.
 *
 * @param client the guarded client every call runs through
 * @returns the bound operations
 */
function cloudflareAliasRouting({ client }: { client: Cloudflare }): AliasRouting {
  return {
    createForwardRule: ({ zone, address, destination }) => createForwardRule({ address, client, destination, zone }),
    getCatchAll: ({ zone }) => getCatchAll({ client, zone }),
    listRules: ({ zone }) => listRules({ client, zone }),
    requireRoutingEnabled: ({ zone }) => requireRoutingEnabled({ client, zone }),
    requireVerifiedDestination: ({ zone, destination }) =>
      requireVerifiedDestination({ accountId: zone.accountId, client, destination }),
    resolveZone: ({ zone }) => resolveZone({ client, zone }),
    setCatchAll: ({ zone, target }) => setCatchAll({ client, target, zone }),
  };
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionAliasDeps(): AliasDeps {
  return {
    doorLedger: doorLedgerPort(),
    err: ({ line }) => {
      logger.error({ msg: line });
    },
    makeRouting: ({ token }) => cloudflareAliasRouting({ client: createCloudflareClient({ apiToken: token }) }),
    out: ({ line }) => {
      logger.out({ line });
    },
    resolveToken: ({ home }) => cloudflareToken({ home }),
  };
}
