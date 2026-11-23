/**
 * The typed failure kinds of the Codex fleet-cap record: reading the store's `codex_fleet_cap` row and filing a
 * fleet read's conclusion into it.
 *
 * Per `.claude/rules/error-handling.md` this union stands alone — it shares nothing with the plan register's union,
 * whose store row sits in the same database, because what a caller does about each is different: a fleet-cap
 * failure leaves one monitor unmeasurable, a register failure stops a seat.
 *
 * **No variant carries a credential.** A store message never carries the connection string, and these messages are
 * printed into logs and monitor cards.
 */

/** The store could not be selected, reached or queried. Nothing was read or written. */
export interface CodexFleetCapStoreUnavailableError {
  readonly code: "CODEX_FLEET_CAP_STORE_UNAVAILABLE";
  readonly message: string;
}

/** The row read fine and holds something this version cannot decode. */
export interface CodexFleetCapMalformedError {
  readonly code: "CODEX_FLEET_CAP_MALFORMED";
  readonly message: string;
  /** Which field stopped it decoding, as the decoder said. */
  readonly why: string;
}

/** Every way reading or filing the fleet-cap record can fail. */
export type CodexFleetCapError = CodexFleetCapStoreUnavailableError | CodexFleetCapMalformedError;

/** The constructors, so every site spells a variant the same way. */
export const CodexFleetCapErrors = {
  malformed: ({ why }: { why: string }): CodexFleetCapMalformedError => ({
    code: "CODEX_FLEET_CAP_MALFORMED",
    message: `the store's Codex fleet-cap row ${why}`,
    why,
  }),
  storeUnavailable: ({ doing, reason }: { doing: string; reason: string }): CodexFleetCapStoreUnavailableError => ({
    code: "CODEX_FLEET_CAP_STORE_UNAVAILABLE",
    message: `the store could not ${doing} the Codex fleet-cap record: ${reason}`,
  }),
} as const;
