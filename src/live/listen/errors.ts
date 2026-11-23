/**
 * Typed domain errors for the listen surface — see `.claude/rules/error-handling.md` for the shape.
 *
 * Four independent unions live here, one per bounded concern within `listen/*`, none sharing a base type
 * with another. A concern with only one or two simple, never-branched-on failure messages (`recover.ts`'s
 * own `candidateSurfaceFromChannel`) stays on the default
 * `Result<T, readonly string[]>` rather than gaining a union for its own sake — see each source file's own
 * comments for why.
 */

// ---------------------------------------------------------------------------------------------------------
// SocketTicketError — opening a Socket Mode connection ticket (`appsConnections.ts`).
// ---------------------------------------------------------------------------------------------------------

/**
 * `apps.connections.open` answered JSON that is not either arm its strict boundary declares — a key added, the
 * `url` missing or not `wss://`. The message is the boundary's own, naming the key and never a value.
 */
export interface SocketTicketResponseChangedError {
  readonly code: "SOCKET_TICKET_RESPONSE_CHANGED";
  readonly message: string;
}

/** Slack answered `ok:false`, naming its own error code. */
export interface SocketTicketRefusedError {
  readonly code: "SOCKET_TICKET_REFUSED";
  readonly message: string;
  readonly slackErrorCode: string;
}

/** The `fetch` to `apps.connections.open` itself failed (network, abort, retry exhaustion). */
export interface SocketTicketUnreachableError {
  readonly code: "SOCKET_TICKET_UNREACHABLE";
  readonly message: string;
  readonly cause?: unknown;
}

/** Slack answered with an HTTP status but no parseable JSON body. */
export interface SocketTicketNoBodyError {
  readonly code: "SOCKET_TICKET_NO_BODY";
  readonly message: string;
  readonly status: number;
}

/** Every failure {@link ../listen/appsConnections.openSocketTicket} can produce. */
export type SocketTicketError =
  SocketTicketResponseChangedError | SocketTicketRefusedError | SocketTicketUnreachableError | SocketTicketNoBodyError;

/** Factories for every {@link SocketTicketError} variant. */
export const SocketTicketErrors = {
  /** @returns a {@link SocketTicketNoBodyError} naming the HTTP status Slack answered with */
  noJsonBody: ({ status }: { status: number }): SocketTicketNoBodyError => ({
    code: "SOCKET_TICKET_NO_BODY",
    message: `Slack answered apps.connections.open with HTTP ${String(status)} and no JSON body`,
    status,
  }),

  /** @returns a {@link SocketTicketRefusedError} naming Slack's own refusal code */
  refused: ({ slackErrorCode }: { slackErrorCode: string }): SocketTicketRefusedError => ({
    code: "SOCKET_TICKET_REFUSED",
    message: `Slack refused apps.connections.open: ${slackErrorCode}`,
    slackErrorCode,
  }),

  /** @returns a {@link SocketTicketResponseChangedError} carrying the strict boundary's own message */
  responseChanged: ({ message }: { message: string }): SocketTicketResponseChangedError => ({
    code: "SOCKET_TICKET_RESPONSE_CHANGED",
    message,
  }),

  /** @returns a {@link SocketTicketUnreachableError} wrapping the underlying provider-call failure */
  unreachable: ({ message }: { message: string }): SocketTicketUnreachableError => ({
    code: "SOCKET_TICKET_UNREACHABLE",
    message: `could not reach Slack to open a Socket Mode connection: ${message}`,
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// MentionParseError — reading a raw Slack event into a `Mention` (`mention.ts`).
// ---------------------------------------------------------------------------------------------------------

/** Which surface a mention-parse error's prose is about — the two call sites word the same failure differently. */
export type MentionParseSurface = "channel" | "dm";

/** The event's own `type` was not `app_mention`. */
export interface NotAppMentionError {
  readonly code: "NOT_APP_MENTION";
  readonly message: string;
  readonly eventType?: string;
}

/** The event's own `type` was not `message`. */
export interface NotMessageError {
  readonly code: "NOT_MESSAGE";
  readonly message: string;
  readonly eventType?: string;
}

/** The event's own `type` was neither `app_mention` nor `message`. */
export interface UnknownEventTypeError {
  readonly code: "UNKNOWN_EVENT_TYPE";
  readonly message: string;
  readonly eventType?: string;
}

/**
 * The event was (or could not be told apart from) THIS INSTALL'S OWN app — refused so a reply never loops on
 * itself. A DIFFERENT bot's event is not refused here; it reaches the ordinary
 * responder whitelist like a human tag does.
 */
export interface MentionSelfAuthoredError {
  readonly code: "SELF_AUTHORED";
  readonly message: string;
  readonly surface: MentionParseSurface;
  /** See {@link ../listen/mention.SelfAuthoredReason} — never conflated, so the reply names the real cause. */
  readonly reason: "confirmed-match" | "unknown-self-identity" | "ambiguous-app-id-only";
}

/** The event carried a `subtype` — an edit, deletion, join or thread broadcast, never a person addressing the bot. */
export interface MentionHasSubtypeError {
  readonly code: "HAS_SUBTYPE";
  readonly message: string;
  readonly surface: MentionParseSurface;
  readonly subtype: string;
}

/** The event was missing one or more of `channel`/`ts`/`user`. */
export interface MentionMissingFieldsError {
  readonly code: "MISSING_FIELDS";
  readonly message: string;
  readonly surface: MentionParseSurface;
  readonly missing: readonly string[];
}

/** A `message` event's `channel_type` was not `im` — a channel or group DM has other people in it. */
export interface NotDirectMessageError {
  readonly code: "NOT_DIRECT_MESSAGE";
  readonly message: string;
  readonly channelType?: string;
}

/**
 * A 1:1 DM that did not explicitly tag the bot — refused, so the DM answers only what addresses it.
 *
 * `reason` separates "we know who we are and this text does not name us" from "we do not know who we are",
 * because the two have different corrections: the first is a person talking past the bot (or, as once
 * happened, drafting messages as the owner in the bot's own DM), and the second is a failed `auth.test` an
 * operator can fix. Conflating them would report a drafting habit as an outage.
 */
export interface DmNotAddressedError {
  readonly code: "DM_NOT_ADDRESSED";
  readonly message: string;
  readonly reason: "no-tag" | "self-identity-unknown";
}

/**
 * A channel `message` that is not a reply INSIDE a thread — nothing top-level ever wakes the bot.
 *
 * `reason` separates the two shapes because they are different mistakes: `no-thread-ts` is somebody talking
 * in the channel, which is the case this listener has always refused and always will; `is-the-root` is the
 * bot's own scheduled post arriving back as an event, which would otherwise be judged a reply to itself.
 */
export interface NotThreadReplyError {
  readonly code: "NOT_THREAD_REPLY";
  readonly message: string;
  readonly reason: "no-thread-ts" | "is-the-root";
}

/**
 * A channel thread reply whose ROOT was not posted by this install's own bot — the one widening of
 * only-when-addressed, refused everywhere it does not apply.
 *
 * Three reasons, never conflated. `another-author` is the ordinary case: people replying under a human's
 * message, which is the whole channel and must stay silent. `no-parent-user-id` is an event Slack delivered
 * without the field the check reads, refused because unreadable must never mean admitted.
 * `self-identity-unknown` is a failed `auth.test` an operator can fix — the same fail-closed direction
 * {@link DmNotAddressedError} takes for its own missing identity.
 */
export interface ThreadRootNotOursError {
  readonly code: "THREAD_ROOT_NOT_OURS";
  readonly message: string;
  readonly reason: "another-author" | "no-parent-user-id" | "self-identity-unknown";
}

/** A channel thread reply in a conversation thread-reply addressing has not been switched on for. */
export interface ThreadRepliesNotEnabledError {
  readonly code: "THREAD_REPLIES_NOT_ENABLED";
  readonly message: string;
  readonly channel: string;
}

/** Every failure {@link ../listen/mention.parseMentionEvent} (and its three arms) can produce. */
export type MentionParseError =
  | NotAppMentionError
  | NotMessageError
  | UnknownEventTypeError
  | MentionSelfAuthoredError
  | MentionHasSubtypeError
  | MentionMissingFieldsError
  | NotDirectMessageError
  | DmNotAddressedError
  | NotThreadReplyError
  | ThreadRootNotOursError
  | ThreadRepliesNotEnabledError;

/** Factories for every {@link MentionParseError} variant. */
export const MentionParseErrors = {
  /** @returns a {@link MentionSelfAuthoredError}, worded for the surface and for the exact refusal reason */
  selfAuthored: ({
    reason,
    surface,
  }: {
    reason: "confirmed-match" | "unknown-self-identity" | "ambiguous-app-id-only";
    surface: MentionParseSurface;
  }): MentionSelfAuthoredError => {
    const noun = surface === "dm" ? "the direct message" : "the mention";
    const messageByReason: Record<typeof reason, string> = {
      "ambiguous-app-id-only":
        `${noun} carried an app_id but no bot_id, so it cannot be told apart from this install's own app — ` +
        "refused defensively",
      "confirmed-match": `${noun} was posted by this install's own app — refused, because answering it would loop on our own reply`,
      "unknown-self-identity":
        `${noun} was posted by a bot, but this install's own identity is not yet known, so it cannot be ` +
        "confirmed as someone else's — refused defensively",
    };
    return { code: "SELF_AUTHORED", message: messageByReason[reason], reason, surface };
  },

  /** @returns a {@link DmNotAddressedError} naming which of the two causes applies */
  dmNotAddressed: ({ reason }: { reason: "no-tag" | "self-identity-unknown" }): DmNotAddressedError => ({
    code: "DM_NOT_ADDRESSED",
    message:
      reason === "no-tag"
        ? "the direct message did not tag the bot — a DM answers an explicit tag only, exactly like a channel"
        : "the direct message could not be checked for the bot's own tag, because this install's own user id " +
          "is not yet known — refused defensively rather than answering something that may not address us",
    reason,
  }),

  /** @returns a {@link MentionHasSubtypeError} naming the exact subtype, worded for the surface it was found on */
  hasSubtype: ({ surface, subtype }: { surface: MentionParseSurface; subtype: string }): MentionHasSubtypeError => ({
    code: "HAS_SUBTYPE",
    message:
      `${surface === "dm" ? "the direct message" : "the app_mention"} carried subtype \`${subtype}\` — only a ` +
      "plain human message is an address",
    subtype,
    surface,
  }),

  /** @returns a {@link MentionMissingFieldsError} naming every missing field at once, worded for the surface */
  missingFields: ({
    surface,
    missing,
  }: {
    surface: MentionParseSurface;
    missing: readonly string[];
  }): MentionMissingFieldsError => ({
    code: "MISSING_FIELDS",
    message: `${surface === "dm" ? "the direct message" : "the app_mention"} was missing ${missing.join(", ")}`,
    missing,
    surface,
  }),

  /** @returns a {@link NotAppMentionError} naming the event type actually seen */
  notAppMention: ({ eventType }: { eventType: string | undefined }): NotAppMentionError => ({
    code: "NOT_APP_MENTION",
    message: `not an app_mention (event type: ${eventType ?? "absent"}) — a channel answers tags only`,
    ...(eventType === undefined ? {} : { eventType }),
  }),

  /** @returns a {@link NotDirectMessageError} naming the `channel_type` actually seen */
  notDirectMessage: ({ channelType }: { channelType: string | undefined }): NotDirectMessageError => ({
    code: "NOT_DIRECT_MESSAGE",
    message:
      `a message in a ${channelType ?? "unstated"} conversation is not a direct message — only a 1:1 DM counts ` +
      "as addressing the bot, because a channel or group DM has other people in it",
    ...(channelType === undefined ? {} : { channelType }),
  }),

  /** @returns a {@link NotMessageError} naming the event type actually seen */
  notMessage: ({ eventType }: { eventType: string | undefined }): NotMessageError => ({
    code: "NOT_MESSAGE",
    message: `not a message (event type: ${eventType ?? "absent"}) — this parse reads direct messages only`,
    ...(eventType === undefined ? {} : { eventType }),
  }),

  /** @returns a {@link NotThreadReplyError} naming which of the two top-level shapes it was */
  notThreadReply: ({ reason }: { reason: "no-thread-ts" | "is-the-root" }): NotThreadReplyError => ({
    code: "NOT_THREAD_REPLY",
    message:
      reason === "no-thread-ts"
        ? "the channel message is not inside a thread — a channel answers a tag, or a reply under one of this " +
          "bot's own posts, and nothing top-level ever wakes it"
        : "the channel message IS the thread root rather than a reply under one — only a reply is an address",
    reason,
  }),

  /** @returns a {@link ThreadRepliesNotEnabledError} naming the conversation it was refused in */
  threadRepliesNotEnabled: ({ channel }: { channel: string }): ThreadRepliesNotEnabledError => ({
    channel,
    code: "THREAD_REPLIES_NOT_ENABLED",
    message:
      `thread-reply addressing is not switched on for ${channel} — it is opt-in per conversation ` +
      "(`listen --thread-replies <C1,…>`), so a channel nobody named answers tags only",
  }),

  /** @returns a {@link ThreadRootNotOursError} naming exactly which of the three causes applies */
  threadRootNotOurs: ({
    reason,
  }: {
    reason: "another-author" | "no-parent-user-id" | "self-identity-unknown";
  }): ThreadRootNotOursError => {
    const messageByReason: Record<typeof reason, string> = {
      "another-author":
        "the thread this reply sits in was started by somebody else — only a reply under one of this bot's " +
        "OWN posts is an address, so a thread rooted at a human takes the refusal every channel message takes",
      "no-parent-user-id":
        "the thread reply carried no `parent_user_id`, so who started the thread cannot be checked — refused " +
        "defensively rather than guessing that the root was ours",
      "self-identity-unknown":
        "the thread reply could not be checked against this install's own user id, because `auth.test` never " +
        "resolved one — refused defensively, exactly as an unaddressable direct message is",
    };
    return { code: "THREAD_ROOT_NOT_OURS", message: messageByReason[reason], reason };
  },

  /** @returns an {@link UnknownEventTypeError} naming the event type actually seen */
  unknownEventType: ({ eventType }: { eventType: string | undefined }): UnknownEventTypeError => ({
    code: "UNKNOWN_EVENT_TYPE",
    message:
      `neither an app_mention nor a message (event type: ${eventType ?? "absent"}) — this listener answers a ` +
      "channel tag or a direct message, and nothing else",
    ...(eventType === undefined ? {} : { eventType }),
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// RecoveryWindowError — the scheduled sweep's pure cadence/window math (`recoverSchedule.ts`).
// ---------------------------------------------------------------------------------------------------------

/** A Slack decimal `ts` string will not parse as `epochSeconds.micros`. */
export interface NotSlackTsError {
  readonly code: "NOT_SLACK_TS";
  readonly message: string;
  readonly ts: string;
}

/** A Slack decimal `ts` is already the epoch — no earlier timestamp to derive as its predecessor. */
export interface AtEpochError {
  readonly code: "AT_EPOCH";
  readonly message: string;
  readonly ts: string;
}

/** The bootstrap `--since` will not parse as an ISO-8601 instant. */
export interface InvalidSinceError {
  readonly code: "INVALID_SINCE";
  readonly message: string;
  readonly since: string;
}

/** The bootstrap `--since` is not before the current instant. */
export interface SinceNotBeforeNowError {
  readonly code: "SINCE_NOT_BEFORE_NOW";
  readonly message: string;
  readonly since: string;
  readonly untilIso: string;
}

/** The durably stored watermark will not parse as a Slack decimal timestamp. */
export interface MalformedWatermarkError {
  readonly code: "MALFORMED_WATERMARK";
  readonly message: string;
  readonly watermark: string;
}

/** The durably stored watermark is not before the current instant. */
export interface WatermarkNotBeforeNowError {
  readonly code: "WATERMARK_NOT_BEFORE_NOW";
  readonly message: string;
  readonly watermark: string;
  readonly untilIso: string;
}

/** Every failure {@link ../listen/recoverSchedule.recoveryWindow} (and its `predecessorSlackTs` helper) can produce. */
export type RecoveryWindowError =
  | NotSlackTsError
  | AtEpochError
  | InvalidSinceError
  | SinceNotBeforeNowError
  | MalformedWatermarkError
  | WatermarkNotBeforeNowError;

/** Factories for every {@link RecoveryWindowError} variant. */
export const RecoveryWindowErrors = {
  /** @returns an {@link AtEpochError} naming the timestamp */
  atEpoch: ({ ts }: { ts: string }): AtEpochError => ({
    code: "AT_EPOCH",
    message: `"${ts}" is already the epoch — no earlier timestamp to derive`,
    ts,
  }),

  /** @returns an {@link InvalidSinceError} naming the rejected `--since` value */
  invalidSince: ({ since }: { since: string }): InvalidSinceError => ({
    code: "INVALID_SINCE",
    message: `bootstrap --since "${since}" is not a valid ISO-8601 instant`,
    since,
  }),

  /** @returns a {@link MalformedWatermarkError} naming the stored watermark */
  malformedWatermark: ({ watermark }: { watermark: string }): MalformedWatermarkError => ({
    code: "MALFORMED_WATERMARK",
    message: `the stored watermark "${watermark}" is not a Slack decimal timestamp`,
    watermark,
  }),

  /** @returns a {@link NotSlackTsError} naming the rejected timestamp */
  notSlackTs: ({ ts }: { ts: string }): NotSlackTsError => ({
    code: "NOT_SLACK_TS",
    message: `"${ts}" is not a Slack decimal timestamp (epochSeconds.micros)`,
    ts,
  }),

  /** @returns a {@link SinceNotBeforeNowError} naming both the rejected `--since` and the current instant */
  sinceNotBeforeNow: ({ since, untilIso }: { since: string; untilIso: string }): SinceNotBeforeNowError => ({
    code: "SINCE_NOT_BEFORE_NOW",
    message: `bootstrap --since "${since}" is not before now (${untilIso})`,
    since,
    untilIso,
  }),

  /** @returns a {@link WatermarkNotBeforeNowError} naming both the stored watermark and the current instant */
  watermarkNotBeforeNow: ({
    watermark,
    untilIso,
  }: {
    watermark: string;
    untilIso: string;
  }): WatermarkNotBeforeNowError => ({
    code: "WATERMARK_NOT_BEFORE_NOW",
    message: `the stored watermark "${watermark}" is not before now (${untilIso})`,
    untilIso,
    watermark,
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// RecoverySweepStateError — the durable cadence file's schema and I/O (`recoverSchedule.ts` + `recoverScheduleStore.ts`).
// ---------------------------------------------------------------------------------------------------------

/** The decoded JSON value was not an object at all. */
export interface SweepStateNotAnObjectError {
  readonly code: "SWEEP_STATE_NOT_AN_OBJECT";
  readonly message: string;
}

/** The state file's `version` field was not the one supported version. */
export interface SweepStateUnsupportedVersionError {
  readonly code: "SWEEP_STATE_UNSUPPORTED_VERSION";
  readonly message: string;
  readonly foundVersion: unknown;
}

/** The state file's `nextDueAtIso` field was not a valid ISO-8601 instant. */
export interface SweepStateInvalidNextDueAtError {
  readonly code: "SWEEP_STATE_INVALID_NEXT_DUE_AT";
  readonly message: string;
  readonly value: unknown;
}

/** The state file's `completedThroughTs` field, when present, was not a Slack decimal timestamp. */
export interface SweepStateInvalidCompletedThroughError {
  readonly code: "SWEEP_STATE_INVALID_COMPLETED_THROUGH";
  readonly message: string;
  readonly value: unknown;
}

/** A V2 state file's `threadCheckpoints` field was not a well-formed `RecoveryThreadCheckpoints` map. */
export interface SweepStateInvalidThreadCheckpointsError {
  readonly code: "SWEEP_STATE_INVALID_THREAD_CHECKPOINTS";
  readonly message: string;
  readonly value: unknown;
}

/** The state file exists but could not be read (a permissions fault, a race, anything but ENOENT). */
export interface SweepStateUnreadableError {
  readonly code: "SWEEP_STATE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** The state file's bytes are not valid JSON — never silently treated as "never swept". */
export interface SweepStateMalformedJsonError {
  readonly code: "SWEEP_STATE_MALFORMED_JSON";
  readonly message: string;
  readonly path: string;
}

/** Writing the state file failed (a permissions fault, a full disk, a race on the temp-file rename). */
export interface SweepStateWriteFailedError {
  readonly code: "SWEEP_STATE_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/**
 * Every failure {@link ../listen/recoverSchedule.parseRecoverySweepState} and
 * {@link ../listen/recoverScheduleStore.readRecoverySweepState}/{@link ../listen/recoverScheduleStore.writeRecoverySweepState}
 * can produce.
 */
export type RecoverySweepStateError =
  | SweepStateNotAnObjectError
  | SweepStateUnsupportedVersionError
  | SweepStateInvalidNextDueAtError
  | SweepStateInvalidCompletedThroughError
  | SweepStateInvalidThreadCheckpointsError
  | SweepStateUnreadableError
  | SweepStateMalformedJsonError
  | SweepStateWriteFailedError;

/** Factories for every {@link RecoverySweepStateError} variant. */
export const RecoverySweepStateErrors = {
  /** @returns a {@link SweepStateInvalidCompletedThroughError} carrying the rejected value */
  invalidCompletedThrough: ({ value }: { value: unknown }): SweepStateInvalidCompletedThroughError => ({
    code: "SWEEP_STATE_INVALID_COMPLETED_THROUGH",
    message: `recovery sweep state's completedThroughTs ${JSON.stringify(value)} is not a Slack decimal timestamp`,
    value,
  }),

  /** @returns a {@link SweepStateInvalidThreadCheckpointsError} carrying the rejected value */
  invalidThreadCheckpoints: ({ value }: { value: unknown }): SweepStateInvalidThreadCheckpointsError => ({
    code: "SWEEP_STATE_INVALID_THREAD_CHECKPOINTS",
    message: `recovery sweep state's threadCheckpoints ${JSON.stringify(value)} is not a well-formed checkpoint map`,
    value,
  }),

  /** @returns a {@link SweepStateInvalidNextDueAtError} carrying the rejected value */
  invalidNextDueAt: ({ value }: { value: unknown }): SweepStateInvalidNextDueAtError => ({
    code: "SWEEP_STATE_INVALID_NEXT_DUE_AT",
    message: `recovery sweep state's nextDueAtIso ${JSON.stringify(value)} is not a valid ISO-8601 instant`,
    value,
  }),

  /** @returns a {@link SweepStateMalformedJsonError} naming the unreadable path */
  malformedJson: ({ path }: { path: string }): SweepStateMalformedJsonError => ({
    code: "SWEEP_STATE_MALFORMED_JSON",
    message: `recovery sweep state at ${path} is not valid JSON — refusing to treat a corrupt file as absent`,
    path,
  }),

  /** @returns a {@link SweepStateNotAnObjectError} */
  notAnObject: (): SweepStateNotAnObjectError => ({
    code: "SWEEP_STATE_NOT_AN_OBJECT",
    message: "recovery sweep state is not a JSON object",
  }),

  /** @returns a {@link SweepStateUnreadableError} wrapping the underlying I/O failure */
  unreadable: ({ path, cause }: { path: string; cause: unknown }): SweepStateUnreadableError => ({
    code: "SWEEP_STATE_UNREADABLE",
    message: `recovery sweep state at ${path} could not be read (${String(cause)})`,
    path,
    ...(cause === undefined ? {} : { cause }),
  }),

  /** @returns a {@link SweepStateUnsupportedVersionError} carrying the rejected version */
  unsupportedVersion: ({ foundVersion }: { foundVersion: unknown }): SweepStateUnsupportedVersionError => ({
    code: "SWEEP_STATE_UNSUPPORTED_VERSION",
    foundVersion,
    message: `recovery sweep state has unsupported version ${JSON.stringify(foundVersion)}, expected 1 or 2`,
  }),

  /**
   * @returns a {@link SweepStateWriteFailedError} — the underlying error's own message when it is a real
   *   `Error`, or a generic fallback naming the path, exactly matching the pre-existing write failure's
   *   own message selection
   */
  writeFailed: ({ path, cause }: { path: string; cause: unknown }): SweepStateWriteFailedError => ({
    cause,
    code: "SWEEP_STATE_WRITE_FAILED",
    message: cause instanceof Error ? cause.message : `failed to write recovery sweep state ${path}`,
    path,
  }),
} as const;
