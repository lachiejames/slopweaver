/**
 * The incident domain's failures: a note form that does not describe a whole write-up, a register holding more
 * than one open revision of the same incident's note, a seen ledger that cannot be read or written, and a
 * postmortem card that cannot be composed or placed.
 */

/** The seen ledger could not be read or appended to. */
export interface IncidentLedgerUnreadableError {
  readonly code: "LEDGER_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A line of the seen ledger is not a ledger row. */
export interface IncidentLedgerCorruptError {
  readonly code: "LEDGER_CORRUPT";
  readonly message: string;
  readonly lineNumber: number;
}

/** Every way the seen ledger can fail. */
export type IncidentLedgerError = IncidentLedgerUnreadableError | IncidentLedgerCorruptError;

/** Constructors for {@link IncidentLedgerError}. */
export const IncidentLedgerErrors = {
  corrupt: ({ lineNumber, why }: { lineNumber: number; why: string }): IncidentLedgerCorruptError => ({
    code: "LEDGER_CORRUPT",
    lineNumber,
    message: `incidents seen ledger line ${String(lineNumber)}: ${why} — repair or remove the line; until then no incident is registered, since a misread ledger would register one twice`,
  }),
  unreadable: ({ path, cause }: { path: string; cause: string }): IncidentLedgerUnreadableError => ({
    code: "LEDGER_UNREADABLE",
    message: `incidents seen ledger ${path}: ${cause}`,
    path,
  }),
} as const;

/** What a sweep was doing to a channel's claim file when the filesystem refused. */
export type IncidentClaimAction = "list" | "write" | "read" | "restamp" | "remove";

/** A channel's claim, or the claims directory, could not be listed, written, read, restamped or removed. */
export interface IncidentClaimIoError {
  readonly code: "CLAIM_IO";
  readonly message: string;
  readonly path: string;
  readonly action: IncidentClaimAction;
}

/** Every way a channel's claim can fail (`./claim.ts`). */
export type IncidentClaimError = IncidentClaimIoError;

/** Constructors for {@link IncidentClaimError}. */
export const IncidentClaimErrors = {
  io: ({
    path,
    action,
    cause,
  }: {
    path: string;
    action: IncidentClaimAction;
    cause: string;
  }): IncidentClaimIoError => ({
    action,
    code: "CLAIM_IO",
    message: `${path} would not ${action}: ${cause}`,
    path,
  }),
} as const;

/** A field of the incident note form is missing or malformed. */
export interface IncidentFormInvalidError {
  readonly code: "FORM_INVALID";
  readonly message: string;
  readonly field: string;
  /** What the field must be, without the form's name — so a check shared with the postmortem form re-homes it. */
  readonly why: string;
}

/** More than one revision of one incident's note is open, so which one a re-cut replaces is ambiguous. */
export interface IncidentRevisionsOpenError {
  readonly code: "REVISIONS_OPEN";
  readonly message: string;
  readonly open: readonly string[];
}

/** Every way composing an incident note can fail. */
export type IncidentNoteError = IncidentFormInvalidError | IncidentRevisionsOpenError;

/** Constructors for {@link IncidentNoteError}, so a message is written once. */
export const IncidentNoteErrors = {
  formInvalid: ({ field, why }: { field: string; why: string }): IncidentFormInvalidError => ({
    code: "FORM_INVALID",
    field,
    message: `incident note form: ${field} ${why}`,
    why,
  }),
  revisionsOpen: ({ open }: { open: readonly string[] }): IncidentRevisionsOpenError => ({
    code: "REVISIONS_OPEN",
    message:
      `incident note: ${String(open.length)} revisions of this incident's note are open (${open.join(", ")}) — ` +
      "settle all but one with `slopweaver hand done <id>` so the re-cut knows which it replaces",
    open,
  }),
} as const;

/** A field of the postmortem card form is missing or malformed. */
export interface PostmortemFormInvalidError {
  readonly code: "POSTMORTEM_FORM_INVALID";
  readonly message: string;
  readonly field: string;
}

/** More than one revision of one incident's postmortem card is open. */
export interface PostmortemRevisionsOpenError {
  readonly code: "POSTMORTEM_REVISIONS_OPEN";
  readonly message: string;
  readonly open: readonly string[];
}

/** The parked ask is not the reply the card says it is: another channel, the bot's voice, nobody tagged, another row. */
export interface PostmortemDraftMisplacedError {
  readonly code: "POSTMORTEM_DRAFT_MISPLACED";
  readonly message: string;
  readonly draft: string;
}

/** A resolved incident worth a postmortem card names no channel, so neither its row nor its ask can be placed. */
export interface PostmortemChannelMissingError {
  readonly code: "POSTMORTEM_CHANNEL_MISSING";
  readonly message: string;
  readonly ref: string;
}

/** Two candidate incidents name one channel, and a postmortem row and card are keyed by channel. */
export interface PostmortemChannelSharedError {
  readonly code: "POSTMORTEM_CHANNEL_SHARED";
  readonly message: string;
  readonly refs: readonly string[];
}

/** A resolved incident's snapshot channel is no Slack channel id, so the row slug built from it would be refused. */
export interface PostmortemChannelMalformedError {
  readonly code: "POSTMORTEM_CHANNEL_MALFORMED";
  readonly message: string;
  readonly ref: string;
  readonly channelId: string;
}

/** The form's channel is not the one incident.io's own announcement names for the incident the form references. */
export interface PostmortemChannelUnboundError {
  readonly code: "POSTMORTEM_CHANNEL_UNBOUND";
  readonly message: string;
  readonly ref: string;
  readonly channelId: string;
}

/** Every way composing a postmortem card, or choosing which incidents earn one, can fail. */
export type IncidentPostmortemError =
  | PostmortemFormInvalidError
  | PostmortemRevisionsOpenError
  | PostmortemDraftMisplacedError
  | PostmortemChannelMissingError
  | PostmortemChannelSharedError
  | PostmortemChannelMalformedError
  | PostmortemChannelUnboundError;

/** Constructors for {@link IncidentPostmortemError}, so a message is written once. */
export const IncidentPostmortemErrors = {
  channelMissing: ({ ref }: { ref: string }): PostmortemChannelMissingError => ({
    code: "POSTMORTEM_CHANNEL_MISSING",
    message:
      `incident postmortems: ${ref} is resolved and not Minor, but its announcement names no channel — ` +
      "its row and its ask are keyed by the incident channel, so read the incident page for it before registering",
    ref,
  }),
  channelShared: ({
    channelId,
    refs,
  }: {
    channelId: string;
    refs: readonly string[];
  }): PostmortemChannelSharedError => ({
    code: "POSTMORTEM_CHANNEL_SHARED",
    message:
      `incident postmortems: ${refs.join(" and ")} both name channel ${channelId}, and a postmortem row and card ` +
      "are keyed by channel — which incident the channel belongs to cannot be told here",
    refs,
  }),
  channelMalformed: ({ ref, channelId }: { ref: string; channelId: string }): PostmortemChannelMalformedError => ({
    channelId,
    code: "POSTMORTEM_CHANNEL_MALFORMED",
    message:
      `incident postmortems: ${ref} is resolved and not Minor, but the snapshot's channel ${JSON.stringify(channelId)} ` +
      "is no Slack channel id (C… or G…, at most 21 characters) — read the incident page for its channel before registering",
    ref,
  }),
  channelUnbound: ({
    ref,
    channelId,
    why,
  }: {
    ref: string;
    channelId: string;
    why: string;
  }): PostmortemChannelUnboundError => ({
    channelId,
    code: "POSTMORTEM_CHANNEL_UNBOUND",
    message: `incident postmortem: channel ${channelId} cannot be bound to ${ref} — ${why}`,
    ref,
  }),
  draftMisplaced: ({ draft, why }: { draft: string; why: string }): PostmortemDraftMisplacedError => ({
    code: "POSTMORTEM_DRAFT_MISPLACED",
    draft,
    message: `incident postmortem: the ask ${draft} ${why}`,
  }),
  formInvalid: ({ field, why }: { field: string; why: string }): PostmortemFormInvalidError => ({
    code: "POSTMORTEM_FORM_INVALID",
    field,
    message: `incident postmortem form: ${field} ${why}`,
  }),
  revisionsOpen: ({ open }: { open: readonly string[] }): PostmortemRevisionsOpenError => ({
    code: "POSTMORTEM_REVISIONS_OPEN",
    message:
      `incident postmortem: ${String(open.length)} revisions of this incident's postmortem card are open ` +
      `(${open.join(", ")}) — settle all but one with \`slopweaver hand done <id>\` so the re-cut knows which it replaces`,
    open,
  }),
} as const;
