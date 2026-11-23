/**
 * The typed refusals `slack edit --as bot` authors about its TARGET once it has read the message back: a kind this
 * verb has no renderer for, a form of the wrong kind for the message, an identity the message should carry and
 * does not, a poll whose local record cannot be trusted, and a poll edit that would move the ballot.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to the per-kind edit paths
 * (`./lifecycleRunEdit.ts`, `./lifecycleRunEditChecklist.ts`, `./lifecycleRunEditPoll.ts`); the card and draft
 * lifecycle's own refusals stay in `./lifecycleErrors.ts`. Every message ends saying nothing was changed, because
 * each is raised before the door.
 */

/** A kind of message this bot posts, as `slack edit` and `slack delete` sort them by event type. */
export type BotMessageKind = "card" | "answer" | "checklist" | "poll" | "progress" | "notice";

/** The message is one this bot posted, of a kind no renderer re-draws: a retired progress spinner or a plain notice. */
export interface EditTargetUnsupportedError {
  readonly code: "EDIT_TARGET_UNSUPPORTED";
  readonly message: string;
  readonly kind: "progress" | "notice";
}

/** The message is a different kind from the form: re-rendering it would swap one message shape for another. */
export interface EditFormMismatchError {
  readonly code: "EDIT_FORM_MISMATCH";
  readonly message: string;
  readonly found: BotMessageKind;
  readonly formKind: BotMessageKind;
}

/** The message carries no readable id of the thing it belongs to, so the edit cannot inherit it. */
export interface EditInheritedIdMissingError {
  readonly code: "EDIT_INHERITED_ID_MISSING";
  readonly message: string;
  readonly field: "turnId" | "pollId";
}

/** A poll's local record is missing, unreadable or names another message, so its ballot cannot be checked. */
export interface EditPollRecordUnusableError {
  readonly code: "EDIT_POLL_RECORD_UNUSABLE";
  readonly message: string;
  readonly pollId: string;
}

/** The form's ballot differs from the recorded one, which would re-point votes already cast. */
export interface EditPollBallotChangedError {
  readonly code: "EDIT_POLL_BALLOT_CHANGED";
  readonly message: string;
  readonly recorded: readonly string[];
}

/** Slack would not say whether the poll's conversation is a DM, so its footer's claim about who sees a vote is unknown. */
export interface EditPollSurfaceUnknownError {
  readonly code: "EDIT_POLL_SURFACE_UNKNOWN";
  readonly message: string;
  readonly channel: string;
}

/** The profile gives two kinds the same event type, so which renderer re-draws the message cannot be told. */
export interface EditTargetAmbiguousError {
  readonly code: "EDIT_TARGET_AMBIGUOUS";
  readonly message: string;
  readonly eventType: string;
  readonly kinds: readonly BotMessageKind[];
}

/** The event type names one kind and the renderer another, so which renderer re-draws the message cannot be told. */
export interface EditRendererMismatchError {
  readonly code: "EDIT_RENDERER_MISMATCH";
  readonly message: string;
  readonly kind: BotMessageKind;
  readonly renderer: string;
}

/** Every refusal the per-kind edit paths author about their target. */
export type SlackEditTargetError =
  | EditTargetAmbiguousError
  | EditRendererMismatchError
  | EditTargetUnsupportedError
  | EditFormMismatchError
  | EditInheritedIdMissingError
  | EditPollRecordUnusableError
  | EditPollBallotChangedError
  | EditPollSurfaceUnknownError;

/** The form kind each message kind is edited with, as `kind` is spelled in the form. */
const FORM_KIND_OF: Readonly<Record<BotMessageKind, string>> = {
  answer: 'a `"kind": "answer"` form',
  card: "a card form (`update`, `digest`, …)",
  checklist: 'a `"kind": "checklist"` form',
  notice: "no form",
  poll: 'a `"kind": "poll"` form',
  progress: "no form",
};

/** The suffix every refusal here ends on: each is raised before the door. */
const NOTHING_CHANGED = "Nothing was changed.";

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const SlackEditTargetErrors = {
  ambiguous: ({
    at,
    eventType,
    kinds,
  }: {
    at: string;
    eventType: string;
    kinds: readonly BotMessageKind[];
  }): EditTargetAmbiguousError => ({
    code: "EDIT_TARGET_AMBIGUOUS",
    eventType,
    kinds,
    message:
      `refusing to re-render ${at}: its event type ${eventType} marks more than one kind of message (` +
      `${kinds.join(", ")}) in this profile, so which renderer re-draws it cannot be told. Give each kind its own ` +
      `event type in the profile; \`slopweaver slack delete\` still accepts it. ${NOTHING_CHANGED}`,
  }),
  formMismatch: ({
    at,
    found,
    formKind,
  }: {
    at: string;
    found: BotMessageKind;
    formKind: BotMessageKind;
  }): EditFormMismatchError => ({
    code: "EDIT_FORM_MISMATCH",
    formKind,
    found,
    message:
      `refusing to re-render ${at} from a ${formKind} form: it is a ${found}, and each kind is re-drawn only by ` +
      `its own renderer. Edit it with ${FORM_KIND_OF[found]}. ${NOTHING_CHANGED}`,
  }),
  inheritedIdMissing: ({
    at,
    field,
    owner,
  }: {
    at: string;
    field: "turnId" | "pollId";
    owner: string;
  }): EditInheritedIdMissingError => ({
    code: "EDIT_INHERITED_ID_MISSING",
    field,
    message:
      `refusing to re-render ${at}: it carries no readable ${field}, so this edit cannot inherit which ${owner} it ` +
      `belongs to, and minting one would detach the message from it. ${NOTHING_CHANGED}`,
  }),
  pollBallotChanged: ({ recorded }: { recorded: readonly string[] }): EditPollBallotChangedError => ({
    code: "EDIT_POLL_BALLOT_CHANGED",
    message:
      "refusing to change this poll's ballot: votes are reactions bound to each option's emoji, so relabelling, " +
      `reordering, adding or dropping an option re-points every vote already cast. Recorded options: ` +
      `${JSON.stringify(recorded)}. A changed ballot is a new poll: post it with \`slopweaver slack poll --form -\` ` +
      `and take this one down with \`slopweaver slack delete\`. ${NOTHING_CHANGED}`,
    recorded,
  }),
  pollRecordUnusable: ({
    at,
    pollId,
    why,
  }: {
    at: string;
    pollId: string;
    why: string;
  }): EditPollRecordUnusableError => ({
    code: "EDIT_POLL_RECORD_UNUSABLE",
    message:
      `refusing to re-render ${at} as a poll: its record ${pollId} ${why}, so the ballot its votes are bound to ` +
      `cannot be checked. ${NOTHING_CHANGED}`,
    pollId,
  }),
  rendererMismatch: ({
    at,
    kind,
    renderer,
  }: {
    at: string;
    kind: BotMessageKind;
    renderer: string;
  }): EditRendererMismatchError => ({
    code: "EDIT_RENDERER_MISMATCH",
    kind,
    message:
      `refusing to re-render ${at}: its event type marks a ${kind} but it was laid out by renderer ` +
      `${JSON.stringify(renderer)}, so which renderer re-draws it cannot be told. ` +
      `\`slopweaver slack delete\` still accepts it. ${NOTHING_CHANGED}`,
    renderer,
  }),
  pollSurfaceUnknown: ({ channel }: { channel: string }): EditPollSurfaceUnknownError => ({
    channel,
    code: "EDIT_POLL_SURFACE_UNKNOWN",
    message:
      `could not read what kind of conversation ${channel} is, so the poll's footer cannot state truthfully who ` +
      `sees a vote. ${NOTHING_CHANGED}`,
  }),
  unsupported: ({ at, kind }: { at: string; kind: "progress" | "notice" }): EditTargetUnsupportedError => ({
    code: "EDIT_TARGET_UNSUPPORTED",
    kind,
    message:
      `refusing to re-render ${at}: it is a ${kind === "progress" ? "standalone progress message, a retired shape" : "plain bot notice, worded in code"}, ` +
      `and no renderer re-draws one. Take it down with \`slopweaver slack delete\`, which accepts it. ${NOTHING_CHANGED}`,
  }),
} as const;
