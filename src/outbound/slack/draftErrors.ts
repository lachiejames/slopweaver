/**
 * The typed failures of the as-me DRAFT register — the one a session parks a message in for the owner to
 * read before anything is sent (`./draftRegister.ts`).
 *
 * Its own union rather than the withheld-reply queue's strings, because every one of these is branched on
 * rather than only displayed: a release refuses differently for a row that is already spent than for one
 * whose bytes have drifted since the owner read them. A line the register cannot read is not here at all: the reader
 * passes over it by name (`./draftRegister.ts`) rather than failing the whole register. Per
 * `.claude/rules/error-handling.md` the union stands alone; nothing here is shared with another domain.
 */

/** No row in the register carries that id. */
export interface DraftNotFoundError {
  readonly code: "DRAFT_NOT_FOUND";
  readonly message: string;
  readonly id: string;
}

/** The row is no longer held: it has already been released, or dropped. */
export interface DraftSpentError {
  readonly code: "DRAFT_SPENT";
  readonly message: string;
  readonly id: string;
  readonly state: "released" | "dropped";
}

/**
 * Another row with the same digest — the same words, identity, place and media — was already released, so
 * this one would post that message a second time. A double post must be structurally impossible to repeat.
 */
export interface DraftReleasedTwinError {
  readonly code: "DRAFT_RELEASED_TWIN";
  readonly message: string;
  readonly id: string;
  /** The released row this one repeats. */
  readonly twinId: string;
  /** Where the twin landed, its permalink when the release journalled one. */
  readonly outcome: string;
}

/** What is about to be posted is not what the row records — the approval does not cover these bytes. */
export interface DraftDigestMismatchError {
  readonly code: "DRAFT_DIGEST_MISMATCH";
  readonly message: string;
  readonly id: string;
  readonly recorded: string;
  readonly offered: string;
}

/** The register could not be written, so nothing was parked. */
export interface DraftWriteFailedError {
  readonly code: "DRAFT_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The register exists and could not be read, so what it holds is unknown — never the same as holding nothing. */
export interface DraftRegisterUnreadableError {
  readonly code: "DRAFT_REGISTER_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** An attachment's bytes are not in the private media store at the path its hash names. */
export interface DraftMediaMissingError {
  readonly code: "DRAFT_MEDIA_MISSING";
  readonly message: string;
  readonly name: string;
  readonly sha256: string;
  readonly path: string;
}

/** The stored bytes at an attachment's path are not the bytes its row records — length or hash differs. */
export interface DraftMediaCorruptError {
  readonly code: "DRAFT_MEDIA_CORRUPT";
  readonly message: string;
  readonly name: string;
  readonly path: string;
  readonly recorded: { readonly sha256: string; readonly bytes: number };
  readonly observed: { readonly sha256: string; readonly bytes: number };
}

/** An attachment's stored bytes exist and could not be read. */
export interface DraftMediaReadFailedError {
  readonly code: "DRAFT_MEDIA_READ_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** An attachment's bytes could not be written into the private media store, so nothing was parked. */
export interface DraftMediaWriteFailedError {
  readonly code: "DRAFT_MEDIA_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** A directory or blob inside the media store is a symbolic link, so a write or read could land outside it. */
export interface DraftMediaLinkedError {
  readonly code: "DRAFT_MEDIA_LINKED";
  readonly message: string;
  readonly path: string;
}

/** A `--thread-ts` names no message in the channel, so there is no thread a reply could be parked under. */
export interface DraftThreadNotFoundError {
  readonly code: "DRAFT_THREAD_NOT_FOUND";
  readonly message: string;
  readonly channel: string;
  readonly threadTs: string;
}

/** A `--thread-ts` names a reply inside a thread rather than its root, so a reply under it would land elsewhere. */
export interface DraftThreadNotRootError {
  readonly code: "DRAFT_THREAD_NOT_ROOT";
  readonly message: string;
  readonly threadTs: string;
  readonly rootTs: string;
}

/** The thread a `--thread-ts` names could not be read, so nothing proves it is a root a reply can go under. */
export interface DraftThreadUnreadableError {
  readonly code: "DRAFT_THREAD_UNREADABLE";
  readonly message: string;
  readonly channel: string;
  readonly threadTs: string;
  readonly cause: unknown;
}

/** The conversation a draft lands in could not be read live, so the card has nothing current to draw above it. */
export interface DraftContextUnreadableError {
  readonly code: "DRAFT_CONTEXT_UNREADABLE";
  readonly message: string;
  readonly channel: string;
  readonly cause: unknown;
}

/** A draft addressed to a member id names no conversation `conversations.history` can read without opening one. */
export interface DraftContextNoConversationError {
  readonly code: "DRAFT_CONTEXT_NO_CONVERSATION";
  readonly message: string;
  readonly channel: string;
}

/**
 * A row cannot carry the approval its recording claims: the anchor does not resolve to the owner's own whole words, or
 * a re-cut would carry one approval across words the owner never heard. Nothing is parked, because a row recorded approved is one the
 * next chair pass SENDS (`./draftApproval.ts`).
 */
export interface DraftApprovalInvalidError {
  readonly code: "DRAFT_APPROVAL_INVALID";
  readonly message: string;
  /** What the recording claimed: the anchor it named, or the rows it re-cut. */
  readonly claimed: string;
}

/**
 * A `--self-evident` re-cut could not read the relay ledger, so nothing shows whether the owner sent an earlier cut back
 * for its receipts (`./draftSentBack.ts`) — and a cut sent back for them may not call itself self-evident.
 */
export interface DraftSentBackUnreadableError {
  readonly code: "DRAFT_SENT_BACK_UNREADABLE";
  readonly message: string;
}

/** Everything the as-me draft register can fail with. A drop ending the owner's yes is `./draftDropErrors.ts`'s. */
export type SlackDraftError =
  | DraftSentBackUnreadableError
  | DraftContextUnreadableError
  | DraftApprovalInvalidError
  | DraftContextNoConversationError
  | DraftNotFoundError
  | DraftSpentError
  | DraftReleasedTwinError
  | DraftDigestMismatchError
  | DraftWriteFailedError
  | DraftRegisterUnreadableError
  | DraftMediaMissingError
  | DraftMediaCorruptError
  | DraftMediaLinkedError
  | DraftMediaReadFailedError
  | DraftMediaWriteFailedError
  | DraftThreadNotFoundError
  | DraftThreadNotRootError
  | DraftThreadUnreadableError;

/** A thrown value's own words, or its string form when it is not an Error. */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The one place a {@link SlackDraftError} is constructed, so a test builds what the real code builds. */
export const SlackDraftErrors = {
  approvalInvalid: ({ claimed, why }: { claimed: string; why: string }): DraftApprovalInvalidError => ({
    claimed,
    code: "DRAFT_APPROVAL_INVALID",
    message: `${claimed}: ${why} — nothing was recorded`,
  }),
  contextNoConversation: ({ channel }: { channel: string }): DraftContextNoConversationError => ({
    channel,
    code: "DRAFT_CONTEXT_NO_CONVERSATION",
    message:
      `this draft is addressed to the member ${channel}, which names no conversation to read — only opening the ` +
      "DM would, and a read never opens one",
  }),
  contextUnreadable: ({ cause, channel }: { cause: unknown; channel: string }): DraftContextUnreadableError => ({
    cause,
    channel,
    code: "DRAFT_CONTEXT_UNREADABLE",
    message: `the conversation in ${channel} could not be read live: ${causeText({ cause })}`,
  }),
  digestMismatch: ({
    id,
    offered,
    recorded,
  }: {
    id: string;
    offered: string;
    recorded: string;
  }): DraftDigestMismatchError => ({
    code: "DRAFT_DIGEST_MISMATCH",
    id,
    message: `draft ${id} records digest ${recorded}, and what would be posted now digests to ${offered} — re-record it and read the new one before releasing`,
    offered,
    recorded,
  }),
  mediaCorrupt: ({
    name,
    observed,
    path,
    recorded,
  }: {
    name: string;
    observed: { sha256: string; bytes: number };
    path: string;
    recorded: { sha256: string; bytes: number };
  }): DraftMediaCorruptError => ({
    code: "DRAFT_MEDIA_CORRUPT",
    message:
      `attachment ${name} is stored at ${path} as ${String(observed.bytes)} bytes hashing ${observed.sha256}, and ` +
      `the draft records ${String(recorded.bytes)} bytes hashing ${recorded.sha256} — the stored bytes are not the ` +
      "ones the owner approved, so nothing was sent. Re-record the draft from the original file.",
    name,
    observed,
    path,
    recorded,
  }),
  mediaLinked: ({ path }: { path: string }): DraftMediaLinkedError => ({
    code: "DRAFT_MEDIA_LINKED",
    message:
      `${path} in the draft media store is a symbolic link, so its bytes could be written or read outside the ` +
      "store; nothing was parked or sent. Replace the link with a real directory or remove it, then re-record.",
    path,
  }),
  mediaMissing: ({ name, path, sha256 }: { name: string; path: string; sha256: string }): DraftMediaMissingError => ({
    code: "DRAFT_MEDIA_MISSING",
    message:
      `attachment ${name} (sha256 ${sha256}) is not in the draft media store at ${path}, so nothing was sent. ` +
      "Re-record the draft from the original file.",
    name,
    path,
    sha256,
  }),
  mediaReadFailed: ({ cause, path }: { cause: unknown; path: string }): DraftMediaReadFailedError => ({
    cause,
    code: "DRAFT_MEDIA_READ_FAILED",
    message: `the stored attachment at ${path} could not be read, so nothing was sent: ${causeText({ cause })}`,
    path,
  }),
  mediaWriteFailed: ({ cause, path }: { cause: unknown; path: string }): DraftMediaWriteFailedError => ({
    cause,
    code: "DRAFT_MEDIA_WRITE_FAILED",
    message: `the attachment could not be stored at ${path}, so nothing was parked: ${causeText({ cause })}`,
    path,
  }),
  notFound: ({ id }: { id: string }): DraftNotFoundError => ({
    code: "DRAFT_NOT_FOUND",
    id,
    message: `no as-me draft carries the id ${id} — \`slopweaver slack draft list\` prints every one that is held`,
  }),
  registerUnreadable: ({ cause, path }: { cause: unknown; path: string }): DraftRegisterUnreadableError => ({
    cause,
    code: "DRAFT_REGISTER_UNREADABLE",
    message: `the as-me draft register at ${path} could not be read: ${causeText({ cause })}`,
    path,
  }),
  sentBackUnreadable: ({ cause }: { cause: string }): DraftSentBackUnreadableError => ({
    code: "DRAFT_SENT_BACK_UNREADABLE",
    message:
      "--self-evident on a re-cut needs the relay ledger, to see whether the owner sent an earlier cut back for its " +
      `receipts, and it did not read: ${cause}`,
  }),
  releasedTwin: ({ id, twinId, outcome }: { id: string; twinId: string; outcome: string }): DraftReleasedTwinError => ({
    code: "DRAFT_RELEASED_TWIN",
    id,
    message:
      `as-me draft ${id} is the same message to the same place as ${twinId}, which was already released: ` +
      `${outcome} — the same words are never released twice; edit the landed message (\`slopweaver slack edit\`) ` +
      `and drop this row (\`slopweaver slack draft drop ${id} --note "duplicate of ${twinId}"\`)`,
    outcome,
    twinId,
  }),
  spent: ({
    id,
    state,
    outcome,
  }: {
    id: string;
    state: "released" | "dropped";
    outcome: string | undefined;
  }): DraftSpentError => ({
    code: "DRAFT_SPENT",
    id,
    message:
      outcome === undefined
        ? `as-me draft ${id} was already ${state}; a spent row is never performed twice`
        : `as-me draft ${id} was already ${state} (${outcome}); a spent row is never performed twice`,
    state,
  }),
  threadNotFound: ({ channel, threadTs }: { channel: string; threadTs: string }): DraftThreadNotFoundError => ({
    channel,
    code: "DRAFT_THREAD_NOT_FOUND",
    message: `--thread-ts ${threadTs}: no message with that ts in ${channel}, so there is no thread to reply under`,
    threadTs,
  }),
  threadNotRoot: ({ rootTs, threadTs }: { rootTs: string; threadTs: string }): DraftThreadNotRootError => ({
    code: "DRAFT_THREAD_NOT_ROOT",
    message:
      `--thread-ts ${threadTs} is a reply inside the thread rooted at ${rootTs}, not a root — pass ` +
      `--thread-ts ${rootTs} to reply in that thread`,
    rootTs,
    threadTs,
  }),
  threadUnreadable: ({
    cause,
    channel,
    threadTs,
  }: {
    cause: unknown;
    channel: string;
    threadTs: string;
  }): DraftThreadUnreadableError => ({
    cause,
    channel,
    code: "DRAFT_THREAD_UNREADABLE",
    message: `--thread-ts ${threadTs}: the thread in ${channel} could not be read (${causeText({ cause })}) — nothing was parked`,
    threadTs,
  }),
  writeFailed: ({ cause, path }: { cause: unknown; path: string }): DraftWriteFailedError => ({
    cause,
    code: "DRAFT_WRITE_FAILED",
    message: `the as-me draft register at ${path} could not be written, so nothing was parked: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;
