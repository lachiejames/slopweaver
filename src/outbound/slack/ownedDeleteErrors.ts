/**
 * Why an ownership-checked delete did NOT remove a message — the typed refusals `./deleteOwnedMessage.ts`
 * answers with.
 *
 * Its own domain union rather than the boolean `SlackWriteTransport.deleteMessage` answers, and the reason
 * is what each caller does next. `slack delete`'s CLI needs to pick an exit code — a door refusal is
 * `EXIT_EXPECTED_EMPTY` and a transport fault is `EXIT_ERROR`, which one bit cannot tell apart — and a
 * supersession has to write WHICH refusal into a journal somebody reads later. A single `false` made
 * "somebody else posted that", "the door held it" and "the network broke" the same fact.
 *
 * `DELETE_UNCONFIRMED` and `DELETE_ROUTE_FAILED` are the pair worth reading twice. The first means the
 * delete call itself was entered and did not come back with a result anyone can stand on — the message may
 * or may not be gone. The second means the failure happened BEFORE that call started, so the message is
 * certainly untouched. Collapsing them would put "it might have been deleted" and "it was not" in one arm,
 * which is exactly the ambiguity a destructive operation's journal exists to remove.
 */
import type { DoorStoreError } from "../../admit/doorStoreErrors.js";
import type { DoorDecision } from "../../admit/types.js";

/** The target timestamp named no message — the read-back found nothing at that exact `ts`. */
export interface TargetAbsentError {
  readonly code: "TARGET_ABSENT";
  readonly message: string;
  readonly channel: string;
  readonly ts: string;
}

/** The message is there and this bot did not post it — a human's, or another Slack app's. */
export interface NotOursError {
  readonly code: "NOT_OURS";
  readonly message: string;
  readonly ts: string;
  /** The `bot_id` the message actually carries, absent on a human's message. */
  readonly messageBotId: string | undefined;
}

/** The message carries no slopweaver metadata at all, so nothing says this program laid it out. */
export interface MissingMetadataError {
  readonly code: "MISSING_METADATA";
  readonly message: string;
  readonly ts: string;
}

/** The message carries metadata of a kind this operation does not accept. */
export interface WrongEventTypeError {
  readonly code: "WRONG_EVENT_TYPE";
  readonly message: string;
  readonly ts: string;
  readonly found: string;
}

/** The message was laid out by a renderer this build does not recognise. */
export interface UnknownRendererError {
  readonly code: "UNKNOWN_RENDERER";
  readonly message: string;
  readonly ts: string;
  readonly found: string | undefined;
}

/** One of the two reads the ownership check needs threw rather than answering. */
export interface OwnershipReadFailedError {
  readonly code: "OWNERSHIP_READ_FAILED";
  readonly message: string;
  readonly ts: string;
  /** Which read failed — the message read-back, or `auth.test`. */
  readonly operation: "read-message" | "who-am-i";
}

/** The door held the delete. Carries the decision so a caller can render its findings through the one renderer. */
export interface DoorRefusedError {
  readonly code: "DOOR_REFUSED";
  readonly message: string;
  readonly ts: string;
  readonly decision: DoorDecision;
}

/**
 * The door's audit trail could not record the decision, so nothing was performed even though the door may have
 * passed. Infrastructure, not policy: a caller must not render it as the door holding the delete.
 */
export interface DoorRecordingRefusedError {
  readonly code: "DOOR_RECORDING_REFUSED";
  readonly message: string;
  readonly ts: string;
}

/** Something failed before the delete call was entered, so the message is certainly still there. */
export interface DeleteRouteFailedError {
  readonly code: "DELETE_ROUTE_FAILED";
  readonly message: string;
  readonly ts: string;
}

/** The delete call was entered and did not confirm removal — the message may or may not be gone. */
export interface DeleteUnconfirmedError {
  readonly code: "DELETE_UNCONFIRMED";
  readonly message: string;
  readonly ts: string;
  /** Slack's own words about why, when it gave any. */
  readonly reason: string;
}

/**
 * The message was edited after the caller's own record of it, so the words being deleted are not the words
 * that were judged. Raised only by a caller that asked for the check, on the read immediately before the
 * delete — an edit that lands after the caller's own earlier read still has to be caught here.
 */
export interface EditedSinceError {
  readonly code: "EDITED_SINCE";
  readonly message: string;
  readonly ts: string;
  /** Slack's own `edited.ts` for the repair that disqualified it. */
  readonly editedTs: string;
}

/** Every way an ownership-checked delete can decline to remove a message. */
export type OwnedDeleteError =
  | EditedSinceError
  | TargetAbsentError
  | NotOursError
  | MissingMetadataError
  | WrongEventTypeError
  | UnknownRendererError
  | OwnershipReadFailedError
  | DoorRefusedError
  | DoorRecordingRefusedError
  | DeleteRouteFailedError
  | DeleteUnconfirmedError;

/** Build one {@link OwnedDeleteError}. The factory the real code calls, so a test built the same way stays honest. */
export const OwnedDeleteErrors = {
  deleteRouteFailed: ({ ts, reason }: { ts: string; reason: string }): DeleteRouteFailedError => ({
    code: "DELETE_ROUTE_FAILED",
    message: `the delete of ${ts} was never attempted — ${reason}`,
    ts,
  }),
  deleteUnconfirmed: ({ ts, reason }: { ts: string; reason: string }): DeleteUnconfirmedError => ({
    code: "DELETE_UNCONFIRMED",
    message: `chat.delete of ${ts} did not confirm removal — ${reason}; the message may still be visible`,
    reason,
    ts,
  }),
  editedSince: ({ ts, editedTs }: { ts: string; editedTs: string }): EditedSinceError => ({
    code: "EDITED_SINCE",
    editedTs,
    message: `${ts} was edited at ${editedTs}, after the record this delete was decided from — it is no longer the message that was judged`,
    ts,
  }),
  doorRecordingRefused: ({ ts, cause }: { ts: string; cause: DoorStoreError }): DoorRecordingRefusedError => ({
    code: "DOOR_RECORDING_REFUSED",
    message: `the delete of ${ts} was not performed: ${cause.message}`,
    ts,
  }),
  doorRefused: ({ ts, decision }: { ts: string; decision: DoorDecision }): DoorRefusedError => ({
    code: "DOOR_REFUSED",
    decision,
    message: `the door held the delete of ${ts}`,
    ts,
  }),
  missingMetadata: ({ ts }: { ts: string }): MissingMetadataError => ({
    code: "MISSING_METADATA",
    message: `${ts} carries no slopweaver metadata — nothing says this program posted it`,
    ts,
  }),
  notOurs: ({ ts, messageBotId }: { ts: string; messageBotId: string | undefined }): NotOursError => {
    // Spelled as an `if` rather than `??`, per `no-silent-fallback`: an ABSENT `bot_id` is not a missing
    // value to paper over, it is the finding — a human posted the message this delete was aimed at.
    let posterDescription = "absent — a person posted it";
    if (messageBotId !== undefined) {
      posterDescription = messageBotId;
    }
    return {
      code: "NOT_OURS",
      message: `${ts} was not posted by this bot (bot_id ${posterDescription})`,
      messageBotId,
      ts,
    };
  },
  ownershipReadFailed: ({
    ts,
    operation,
    reason,
  }: {
    ts: string;
    operation: "read-message" | "who-am-i";
    reason: string;
  }): OwnershipReadFailedError => ({
    code: "OWNERSHIP_READ_FAILED",
    message: `could not establish ownership of ${ts} — the ${operation} read failed: ${reason}`,
    operation,
    ts,
  }),
  targetAbsent: ({ channel, ts }: { channel: string; ts: string }): TargetAbsentError => ({
    channel,
    code: "TARGET_ABSENT",
    message:
      `no message at ${ts} in ${channel} — refusing to act on a target that is not there. A history read ` +
      "anchored at a missing ts returns the NEAREST message, so this is checked rather than assumed",
    ts,
  }),
  unknownRenderer: ({ ts, found }: { ts: string; found: string | undefined }): UnknownRendererError => {
    // Same reason as `notOurs` above: a message DECLARING no renderer and one declaring an unrecognised
    // renderer are two different things to have found, so the substitution is written out.
    let declared = "none declared";
    if (found !== undefined) {
      declared = found;
    }
    return {
      code: "UNKNOWN_RENDERER",
      found,
      message: `${ts} was laid out by a renderer this build does not recognise (${declared})`,
      ts,
    };
  },
  wrongEventType: ({ ts, found }: { ts: string; found: string }): WrongEventTypeError => ({
    code: "WRONG_EVENT_TYPE",
    found,
    message: `${ts} carries metadata of kind ${found}, which this operation does not accept`,
    ts,
  }),
} as const;
