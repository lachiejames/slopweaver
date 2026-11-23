/**
 * Typed refusals for `./draftRecordMessage.ts`'s `parkableMessage`: the two preparations that cannot park as one
 * message. Bounded to that one check, never `../../../outbound/slack/draftErrors.ts`'s register union, because these
 * refuse the SHAPE of a preparation before any register is read.
 *
 * Neither carries `NOTHING_PARKED`: a caller renders them with {@link parkableMessageLines}, one line each, exactly as
 * the string list they replaced, and adds its own trailer where it wants one.
 */

/** The preparation came from a raw `--body`, never a typed `--form`. */
export interface ParkableRawBodyError {
  readonly code: "RAW_BODY";
  readonly message: string;
}

/** The preparation planned some number of messages other than one. */
export interface ParkableDripError {
  readonly code: "NOT_ONE_MESSAGE";
  readonly message: string;
  readonly messages: number;
}

/** Every refusal `parkableMessage` raises. */
export type ParkableMessageError = ParkableRawBodyError | ParkableDripError;

/** The factory the check calls, so a test built the same way catches a drift. */
export const ParkableMessageErrors = {
  notOneMessage: ({ messages }: { messages: number }): ParkableDripError => ({
    code: "NOT_ONE_MESSAGE",
    message:
      `REFUSING to park a ${String(messages)}-message drip: a parked draft is ONE ` +
      "message, top-level or a thread reply, because that is the only shape the console can show them whole and the only one an " +
      'approval can bind to a single digest. Compose it as a {"kind":"one-card"} form instead.',
    messages,
  }),
  rawBody: (): ParkableRawBodyError => ({
    code: "RAW_BODY",
    message: "a parked draft is a typed --form, never a raw --body",
  }),
} as const;

/**
 * The lines a {@link ParkableMessageError} prints in a recording's refusal list.
 *
 * @returns the one line each variant has always printed
 */
export function parkableMessageLines({ error }: { error: ParkableMessageError }): readonly string[] {
  return [error.message];
}
