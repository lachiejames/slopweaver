/**
 * Drafting a forward of one matched receipt to Airwallex's receipts address — its own bounded domain beside
 * `./errors.ts`, because what fails here is the one-draft-per-receipt claim and the files the forward carries, not
 * the reading of a reminder.
 */

/** Another `spend forward` run holds this receipt's claim right now. */
export interface ForwardInFlightError {
  readonly code: "FORWARD_IN_FLIGHT";
  readonly message: string;
  readonly receiptId: string;
}

/** A run that died holding this receipt's claim left it behind — Gmail may or may not hold its draft. */
export interface ForwardClaimAbandonedError {
  readonly code: "FORWARD_CLAIM_ABANDONED";
  readonly message: string;
  readonly path: string;
}

/** The claim could not be written or read back, so nothing could promise one draft. */
export interface ForwardClaimUnwrittenError {
  readonly code: "FORWARD_CLAIM_UNWRITTEN";
  readonly message: string;
}

/** A receipt id that cannot name a claim file. */
export interface ForwardReceiptIdInvalidError {
  readonly code: "FORWARD_RECEIPT_ID_INVALID";
  readonly message: string;
}

/** A file pulled from the receipt could not be read back to attach. */
export interface ForwardAttachmentUnreadableError {
  readonly code: "FORWARD_ATTACHMENT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Every way drafting one forward can fail before or around the Gmail call. */
export type SpendForwardError =
  | ForwardInFlightError
  | ForwardClaimAbandonedError
  | ForwardClaimUnwrittenError
  | ForwardReceiptIdInvalidError
  | ForwardAttachmentUnreadableError;

/** Factories for {@link SpendForwardError}, so every refusal carries its message in one wording. */
export const SpendForwardErrors = {
  attachmentUnreadable: ({ path, cause }: { path: string; cause: string }): ForwardAttachmentUnreadableError => ({
    code: "FORWARD_ATTACHMENT_UNREADABLE",
    message: `the pulled file ${path} could not be read to attach: ${cause}`,
    path,
  }),
  claimAbandoned: ({ path, pid }: { path: string; pid: number }): ForwardClaimAbandonedError => ({
    code: "FORWARD_CLAIM_ABANDONED",
    message:
      `a run (pid ${String(pid)}) died holding ${path}, and may have stored its draft first — look in Gmail's ` +
      `Drafts for a mail to receipts@expenses.airwallex.com before removing that file; this run drafts nothing for it`,
    path,
  }),
  claimUnwritten: ({ cause }: { cause: string }): ForwardClaimUnwrittenError => ({
    code: "FORWARD_CLAIM_UNWRITTEN",
    message: `the one-draft claim could not be taken: ${cause}`,
  }),
  inFlight: ({ receiptId, pid }: { receiptId: string; pid: number }): ForwardInFlightError => ({
    code: "FORWARD_IN_FLIGHT",
    message: `another run (pid ${String(pid)}) is drafting the forward of receipt ${receiptId} right now`,
    receiptId,
  }),
  receiptIdInvalid: ({ receiptId }: { receiptId: string }): ForwardReceiptIdInvalidError => ({
    code: "FORWARD_RECEIPT_ID_INVALID",
    message: `receipt id ${JSON.stringify(receiptId)} is not a Gmail message id, so it cannot name a claim`,
  }),
} as const;
