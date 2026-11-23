/**
 * The card-deferral module's typed errors — its own union, never shared (`.claude/rules/error-handling.md`).
 */

/** The kind and id named no card the owner's Queue draws. */
export interface NotDeferrableError {
  readonly code: "NOT_DEFERRABLE";
  readonly message: string;
  readonly kind: string;
  readonly id: string;
}

/** The deferral ledger could not be read or written. */
export interface DeferralLedgerIoError {
  readonly code: "LEDGER_IO";
  readonly message: string;
  readonly path: string;
}

/** Every way deferring or reading a deferral fails. */
export type CardDeferralError = NotDeferrableError | DeferralLedgerIoError;

/** The one place each variant's message is worded. */
export const CardDeferralErrors = {
  ledgerIo: ({ path, cause }: { path: string; cause: unknown }): DeferralLedgerIoError => ({
    code: "LEDGER_IO",
    message: `the card-deferral ledger at ${path} could not be used — ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  notDeferrable: ({ kind, id }: { kind: string; id: string }): NotDeferrableError => ({
    code: "NOT_DEFERRABLE",
    id,
    kind,
    message: `${kind}:${id} is not a card the owner's Queue draws — expected --kind <hand|ask|draft|post|review|import|pr> and an id of letters, digits, '.', '_' or '-'`,
  }),
} as const;
