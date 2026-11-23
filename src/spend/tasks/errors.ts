/**
 * Reading an Airwallex task-reminder mail and the receipts beside it — its own bounded domain, separate from the
 * card-export errors in `../errors.ts`, because a reminder is mail Airwallex writes, not a page the owner pasted, and a
 * refusal here names what the mail said rather than a line of an export.
 */

/** The body does not open the way every reminder does, so nothing in it is read as an expense. */
export interface NotAReminderError {
  readonly code: "NOT_A_REMINDER";
  readonly message: string;
}

/** An expense block is there but one of its lines is not in the shape the reminder prints. */
export interface ExpenseMalformedError {
  readonly code: "EXPENSE_MALFORMED";
  readonly message: string;
  /** The 1-based position of the expense in the mail. */
  readonly position: number;
  readonly text: string;
}

/** The expenses listed, plus the `+ N more` tail, do not add up to the mail's `<n> card expenses` count. */
export interface CountMismatchError {
  readonly code: "COUNT_MISMATCH";
  readonly message: string;
  readonly stated: number;
  readonly listed: number;
}

/** A Gmail read the verb depends on failed — the door's own message carried, so the fix it names survives. */
export interface MailboxReadFailedError {
  readonly code: "MAILBOX_READ_FAILED";
  readonly message: string;
  /** What was being read: the reminder search, one expense's receipt search, or a receipt's PDF. */
  readonly step: string;
}

/** Every way reading one reminder can fail. */
export type TaskReminderError = NotAReminderError | ExpenseMalformedError | CountMismatchError | MailboxReadFailedError;

/** Factories for {@link TaskReminderError}, so every refusal carries its message in one wording. */
export const TaskReminderErrors = {
  mailboxReadFailed: ({ step, cause }: { step: string; cause: { message: string } }): MailboxReadFailedError => ({
    code: "MAILBOX_READ_FAILED",
    message: `${step}: ${cause.message}`,
    step,
  }),
  countMismatch: ({ stated, listed }: { stated: number; listed: number }): CountMismatchError => ({
    code: "COUNT_MISMATCH",
    listed,
    message: `the reminder states ${String(stated)} card expense(s) but lists ${String(listed)} — its shape changed`,
    stated,
  }),
  expenseMalformed: ({ position, text }: { position: number; text: string }): ExpenseMalformedError => ({
    code: "EXPENSE_MALFORMED",
    message: `expense ${String(position)} in the reminder is not a merchant and an amount: ${JSON.stringify(text)}`,
    position,
    text,
  }),
  notAReminder: (): NotAReminderError => ({
    code: "NOT_A_REMINDER",
    message: "the mail does not open with `You have <n> tasks to complete`, so it is not an Airwallex task reminder",
  }),
} as const;
