/**
 * The ways a live read of the owner's Airwallex card page is refused before anything is stored.
 *
 * No message here carries a value off the page — no amount, merchant, id or nickname — because a refusal is
 * printed to a terminal and read back into a transcript. A backend CODE (a status, a window type) is named,
 * since a code is the page's vocabulary rather than card data, and naming it is what makes the next fix one line.
 */

/** No response of an operation the snapshot is built from answered on the page. */
interface LiveOperationMissingError {
  readonly code: "LIVE_OPERATION_MISSING";
  readonly message: string;
  readonly operation: string;
}

/** An operation answered, but not in the shape discovery recorded. */
interface LiveBodyInvalidError {
  readonly code: "LIVE_BODY_INVALID";
  readonly message: string;
  readonly operation: string;
  readonly problems: readonly string[];
}

/** No card on the page carries the nickname the stored snapshot for `--last4` holds. */
interface LiveCardNotOnPageError {
  readonly code: "LIVE_CARD_NOT_ON_PAGE";
  readonly message: string;
  readonly last4: string;
}

/** The capture could not be calibrated against the stored snapshot — every reason found in one pass. */
interface LiveUncalibratedError {
  readonly code: "LIVE_UNCALIBRATED";
  readonly message: string;
  readonly problems: readonly string[];
}

/** Every way a live card read is refused. */
export type LiveCaptureError =
  LiveOperationMissingError | LiveBodyInvalidError | LiveCardNotOnPageError | LiveUncalibratedError;

/** Build one typed live-read refusal. */
export const LiveCaptureErrors = {
  bodyInvalid: ({ operation, problems }: { operation: string; problems: readonly string[] }): LiveBodyInvalidError => ({
    code: "LIVE_BODY_INVALID",
    message: `${operation} answered in a shape discovery did not record: ${problems.join("; ")} — run \`spend capture --discover\` and compare`,
    operation,
    problems,
  }),
  cardNotOnPage: ({ last4 }: { last4: string }): LiveCardNotOnPageError => ({
    code: "LIVE_CARD_NOT_ON_PAGE",
    last4,
    message: `no card on the page carries the nickname the stored snapshot ending ${last4} holds — is --url that card's page, and --last4 its number?`,
  }),
  operationMissing: ({ operation }: { operation: string }): LiveOperationMissingError => ({
    code: "LIVE_OPERATION_MISSING",
    message: `the card page never answered ${operation}, so there is nothing to build the snapshot from — did the page finish loading?`,
    operation,
  }),
  uncalibrated: ({ problems }: { problems: readonly string[] }): LiveUncalibratedError => ({
    code: "LIVE_UNCALIBRATED",
    message: `the live read does not calibrate against the stored snapshot, so nothing was stored:\n  ${problems.join("\n  ")}`,
    problems,
  }),
} as const;
