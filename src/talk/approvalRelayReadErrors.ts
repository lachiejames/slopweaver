/**
 * Why the relays the owner made after a yes could not be read off the call that yes was said on
 * (`./approvalRelayRead.ts`). Its own union, per `.claude/rules/error-handling.md`: each says the record cannot prove
 * what the owner said next, never that they said nothing — so a caller binding a yes refuses on every one of them.
 */

/** No call file holds the relay or landing the yes was said on, so what the owner said after it cannot be read. */
export interface AnchorCallMissingError {
  readonly code: "ANCHOR_CALL_MISSING";
  readonly message: string;
  readonly anchor: string;
}

/** More than one call file holds the same relay turn, so which call's later relays count is unknown. */
export interface AnchorCallAmbiguousError {
  readonly code: "ANCHOR_CALL_AMBIGUOUS";
  readonly message: string;
  readonly anchor: string;
  readonly callIds: readonly string[];
}

/** A call that may hold the yes, or the one that does, could not be read whole. */
export interface AnchorCallUnreadableError {
  readonly code: "ANCHOR_CALL_UNREADABLE";
  readonly message: string;
  readonly anchor: string;
  readonly why: string;
}

/** A relay after the yes, inside the window, cannot say what the owner said or which card it was about. */
export interface LaterRelayUnreadableError {
  readonly code: "LATER_RELAY_UNREADABLE";
  readonly message: string;
  readonly anchor: string;
  /** The later relay's turn, or `null` when the call line carries none. */
  readonly turnId: string | null;
  readonly why: string;
}

/** Why the relays after a yes could not be read. */
export type ApprovalRelayReadError =
  AnchorCallMissingError | AnchorCallAmbiguousError | AnchorCallUnreadableError | LaterRelayUnreadableError;

/** The one place an {@link ApprovalRelayReadError} is constructed. */
export const ApprovalRelayReadErrors = {
  callAmbiguous: ({ anchor, callIds }: { anchor: string; callIds: readonly string[] }): AnchorCallAmbiguousError => ({
    anchor,
    callIds,
    code: "ANCHOR_CALL_AMBIGUOUS",
    message: `${anchor} is relayed on ${String(callIds.length)} calls (${callIds.join(", ")}), so which call's later relays count is unknown`,
  }),
  callMissing: ({ anchor }: { anchor: string }): AnchorCallMissingError => ({
    anchor,
    code: "ANCHOR_CALL_MISSING",
    message: `no call file holds ${anchor}, so what the owner said after it cannot be read`,
  }),
  callUnreadable: ({ anchor, why }: { anchor: string; why: string }): AnchorCallUnreadableError => ({
    anchor,
    code: "ANCHOR_CALL_UNREADABLE",
    message: `the call ${anchor} was said on cannot be read whole (${why}), so what the owner said after it is unknown`,
    why,
  }),
  laterRelayUnreadable: ({
    anchor,
    turnId,
    why,
  }: {
    anchor: string;
    turnId: string | null;
    why: string;
  }): LaterRelayUnreadableError => {
    let which = "a relay after it that carries no turn";
    if (turnId !== null) {
      which = `talk:${turnId}, a relay after it,`;
    }
    return {
      anchor,
      code: "LATER_RELAY_UNREADABLE",
      message: `${which} cannot be read (${why}), so whether the owner took ${anchor} back is unknown`,
      turnId,
      why,
    };
  },
} as const;
