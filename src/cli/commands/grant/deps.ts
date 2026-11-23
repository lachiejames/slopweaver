/**
 * What every `grant` verb is handed: the journal port, REQUIRED, so no verb can reach the record any other way.
 * The production composition is built only once a verb has parsed its argv, so `--help` and a usage refusal open
 * no connection. A unit test passes `src/__tests__/grantJournalFixture.ts`'s in-memory port instead.
 */
import { type GrantJournalPort, grantJournalPort } from "../../../grants/port.js";
import type { GrantStoreError } from "../../../grants/storeErrors.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/** The effects a `grant` verb runs over. */
export interface GrantCommandDeps {
  readonly journal: GrantJournalPort;
  /** Where the writing verbs read which visible session is acting. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * The production deps: the store-backed journal and the process environment.
 *
 * @returns the deps every shipped `grant` verb runs over
 */
export function productionGrantCommandDeps(): GrantCommandDeps {
  return { env: process.env, journal: grantJournalPort() };
}

/**
 * Report a store refusal the way every `grant` verb does — the typed error on stdout under `--json`, its message
 * on stderr otherwise — and answer the exit code.
 *
 * @param verb the verb reporting, which prefixes the human line
 * @param error the store's refusal
 * @param json whether the caller asked for machine output
 * @returns `EXIT_ERROR`, always: a store that refused is a fault, not a finding about a row
 */
export function reportGrantStoreError({
  verb,
  error,
  json,
}: {
  verb: string;
  error: GrantStoreError;
  json: boolean;
}): number {
  if (json) {
    logger.out({ line: JSON.stringify({ error, ok: false }) });
  } else {
    logger.error({ msg: `grant ${verb}: ${error.code} — ${error.message}` });
  }
  return EXIT_ERROR;
}
