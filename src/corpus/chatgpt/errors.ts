/**
 * The typed failures of taking a ChatGPT data export in and reading it back — one domain, scoped to
 * `src/corpus/chatgpt/`, per `.claude/rules/error-handling.md`.
 */

/** The path named does not exist. */
export interface ExportPathMissingError {
  readonly code: "EXPORT_PATH_MISSING";
  readonly message: string;
  readonly path: string;
}

/** The path exists but holds no conversations file — not a ChatGPT export. */
export interface NotAnExportError {
  readonly code: "NOT_AN_EXPORT";
  readonly message: string;
  readonly path: string;
}

/** An archive member whose name would escape the directory it is extracted into, or collides with another. */
export interface UnsafeMemberError {
  readonly code: "UNSAFE_MEMBER";
  readonly message: string;
  readonly member: string;
}

/** A zip found while looking for an export holds conversations files, but not as one whole export. */
export interface MalformedExportError {
  readonly code: "MALFORMED_EXPORT";
  readonly message: string;
  readonly path: string;
}

/** A zip found while looking for an export will not list, so whether it is the export the owner just downloaded is unknown. */
export interface UnlistableZipError {
  readonly code: "UNLISTABLE_ZIP";
  readonly message: string;
  readonly path: string;
}

/** `unzip` could not list or extract the archive. */
export interface ArchiveUnreadableError {
  readonly code: "ARCHIVE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Taking an export in would write past the bytes allowed it — its cap, or the disk's free space less a reserve. */
export interface ExportTooLargeError {
  readonly code: "EXPORT_TOO_LARGE";
  readonly message: string;
  /** The archive or file being taken in. */
  readonly path: string;
  /** The bytes it was allowed. */
  readonly limitBytes: number;
}

/** A file could not be written into, or read out of, the managed export directory. */
export interface ExportStoreFailedError {
  readonly code: "EXPORT_STORE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** The owner's protect list covers a path the store would read or write, so nothing was written. */
export interface ExportProtectedError {
  readonly code: "EXPORT_PROTECTED";
  readonly message: string;
}

/** `refresh --source chatgpt` with no export ever taken in — the one step only the owner can take. */
export interface NoImportedExportError {
  readonly code: "NO_IMPORTED_EXPORT";
  readonly message: string;
}

/** A held export's `manifest.json` is missing, unreadable, or not the shape this writes. */
export interface ManifestUnreadableError {
  readonly code: "MANIFEST_UNREADABLE";
  readonly message: string;
  /** The export directory the manifest belongs to. */
  readonly directory: string;
}

/** A held export is no longer the export that was taken in: a member gone, resized, replaced, or rewritten. */
export interface HeldExportDamagedError {
  readonly code: "HELD_EXPORT_DAMAGED";
  readonly message: string;
  /** The export directory that no longer matches its manifest. */
  readonly directory: string;
}

/**
 * One or more held exports will not read back. Nothing is certified current while one does: a skipped export
 * would let the store's older rows stand in for an archive no longer there.
 */
export interface HeldExportUnreadableError {
  readonly code: "HELD_EXPORT_UNREADABLE";
  readonly message: string;
  /** One line per held export directory whose manifest will not read. */
  readonly unreadable: readonly string[];
}

/** The instant a sync certified is missing, unreadable, or dates an export that is no longer the newest held. */
export interface AsOfUnreadableError {
  readonly code: "AS_OF_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Every way taking an export in, or reading one back, fails. */
export type ChatgptExportError =
  | ExportPathMissingError
  | NotAnExportError
  | MalformedExportError
  | UnlistableZipError
  | UnsafeMemberError
  | ArchiveUnreadableError
  | ExportTooLargeError
  | ExportStoreFailedError
  | ExportProtectedError
  | NoImportedExportError
  | ManifestUnreadableError
  | HeldExportDamagedError
  | HeldExportUnreadableError
  | AsOfUnreadableError;

/** A conversation field this reader relies on is missing or retyped. */
export interface ConversationShapeError {
  readonly code: "CONVERSATION_SHAPE";
  readonly message: string;
  /** The first few offending fields, one `path: issue` line each — never the whole list, which data sizes. */
  readonly issues: readonly string[];
  /** How many issues the schema raised in all. */
  readonly issueCount: number;
}

/** A conversation that carries neither `id` nor `conversation_id`. */
export interface ConversationUnidentifiedError {
  readonly code: "CONVERSATION_UNIDENTIFIED";
  readonly message: string;
}

/** A conversation whose `id` and `conversation_id` are both present and name two different conversations. */
export interface ConversationIdConflictError {
  readonly code: "CONVERSATION_ID_CONFLICT";
  readonly message: string;
  readonly conversationId: string;
  readonly otherId: string;
}

/** A conversation whose `current_node` is absent, or names a node its own `mapping` does not hold. */
export interface ConversationNoLeafError {
  readonly code: "CONVERSATION_NO_LEAF";
  readonly message: string;
  readonly conversationId: string;
}

/** A conversation whose `mapping` parent chain loops. */
export interface ConversationLoopError {
  readonly code: "CONVERSATION_LOOP";
  readonly message: string;
  readonly conversationId: string;
}

/** A conversation where two visible messages carry one message id, so the store would keep only one of them. */
export interface ConversationDuplicateMessageError {
  readonly code: "CONVERSATION_DUPLICATE_MESSAGE";
  readonly message: string;
  readonly conversationId: string;
  readonly messageId: string;
}

/**
 * A conversation whose tree does not hold together — a node's parent missing from the mapping, or a node keyed under
 * an id it does not carry — so a walk up it would stop short and place messages as if the branch above were absent.
 */
export interface ConversationBrokenLinkError {
  readonly code: "CONVERSATION_BROKEN_LINK";
  readonly message: string;
  readonly conversationId: string;
  readonly nodeId: string;
}

/** Every way one export conversation fails to parse. */
export type ChatgptConversationError =
  | ConversationShapeError
  | ConversationUnidentifiedError
  | ConversationIdConflictError
  | ConversationNoLeafError
  | ConversationLoopError
  | ConversationDuplicateMessageError
  | ConversationBrokenLinkError;

/** What each way a conversation's tree fails to hold together says about the node it names. */
const BROKEN_LINK_WHY = {
  "key-mismatch": "is keyed under an id it does not carry",
  "parent-missing": "names a parent the mapping does not hold",
  "second-root": "is a second root, a conversation the first root's tree does not reach",
} as const;

export const ChatgptConversationErrors = {
  brokenLink: ({
    conversationId,
    nodeId,
    why,
  }: {
    conversationId: string;
    nodeId: string;
    why: keyof typeof BROKEN_LINK_WHY;
  }): ConversationBrokenLinkError => ({
    code: "CONVERSATION_BROKEN_LINK",
    conversationId,
    message: `${conversationId}: node ${nodeId} ${BROKEN_LINK_WHY[why]}`,
    nodeId,
  }),
  duplicateMessage: ({
    conversationId,
    messageId,
  }: {
    conversationId: string;
    messageId: string;
  }): ConversationDuplicateMessageError => ({
    code: "CONVERSATION_DUPLICATE_MESSAGE",
    conversationId,
    message: `${conversationId}: two visible messages carry the id ${messageId}, and the store would keep only one`,
    messageId,
  }),
  leafAbsent: ({ conversationId }: { conversationId: string }): ConversationNoLeafError => ({
    code: "CONVERSATION_NO_LEAF",
    conversationId,
    message: `${conversationId}: carries no \`current_node\`, so the branch the owner last saw cannot be told from the others`,
  }),
  leafNotInMapping: ({ conversationId, leaf }: { conversationId: string; leaf: string }): ConversationNoLeafError => ({
    code: "CONVERSATION_NO_LEAF",
    conversationId,
    message: `${conversationId}: \`current_node\` ${leaf} is not in its own \`mapping\``,
  }),
  loop: ({
    conversationId,
    from,
  }: {
    conversationId: string;
    from: "current-node" | "mapping";
  }): ConversationLoopError => ({
    code: "CONVERSATION_LOOP",
    conversationId,
    message:
      from === "current-node"
        ? `${conversationId}: the parent chain from \`current_node\` loops`
        : `${conversationId}: a parent chain in its \`mapping\` loops`,
  }),
  shape: ({ issues, issueCount }: { issues: readonly string[]; issueCount: number }): ConversationShapeError => ({
    code: "CONVERSATION_SHAPE",
    issueCount,
    issues,
    message: issues.join("; ") + (issueCount > issues.length ? `; and ${String(issueCount - issues.length)} more` : ""),
  }),
  idConflict: ({ id, conversationId }: { id: string; conversationId: string }): ConversationIdConflictError => ({
    code: "CONVERSATION_ID_CONFLICT",
    conversationId: id,
    message: `${id}: carries \`id\` ${id} and \`conversation_id\` ${conversationId}, which name two different conversations`,
    otherId: conversationId,
  }),
  unidentified: (): ConversationUnidentifiedError => ({
    code: "CONVERSATION_UNIDENTIFIED",
    message: "(conversation): carries neither `id` nor `conversation_id`",
  }),
} as const;

/** The cause of a thrown error as one line. */
function causeLine({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export const ChatgptExportErrors = {
  archiveUnreadable: ({ path, detail }: { path: string; detail: string }): ArchiveUnreadableError => ({
    code: "ARCHIVE_UNREADABLE",
    message: `could not read the archive ${path}: ${detail}`,
    path,
  }),
  asOfUnreadable: ({ path, detail }: { path: string; detail: string }): AsOfUnreadableError => ({
    code: "AS_OF_UNREADABLE",
    message: `chatgpt: no instant a sync certified the corpus current as of can be believed at ${path} (${detail})`,
    path,
  }),
  exportPathMissing: ({ path }: { path: string }): ExportPathMissingError => ({
    code: "EXPORT_PATH_MISSING",
    message: `${path} does not exist`,
    path,
  }),
  exportProtected: ({ lines }: { lines: readonly string[] }): ExportProtectedError => ({
    code: "EXPORT_PROTECTED",
    message: `${lines.join("; ")} — nothing was written`,
  }),
  exportStoreFailed: ({ path, cause }: { path: string; cause: unknown }): ExportStoreFailedError => ({
    code: "EXPORT_STORE_FAILED",
    message: `could not store the export at ${path}: ${causeLine({ cause })}`,
    path,
  }),
  exportTooLarge: ({ path, limitBytes }: { path: string; limitBytes: number }): ExportTooLargeError => ({
    code: "EXPORT_TOO_LARGE",
    limitBytes,
    message:
      `refused ${path}: its conversations files run past the ${String(limitBytes)} bytes allowed them (a cap, or the ` +
      "disk's free space less a reserve), so the copy was stopped and removed rather than left to fill the disk",
    path,
  }),
  heldExportDamaged: ({ directory, detail }: { directory: string; detail: string }): HeldExportDamagedError => ({
    code: "HELD_EXPORT_DAMAGED",
    directory,
    message: `${directory}: no longer the export taken in (${detail})`,
  }),
  heldExportUnreadable: ({
    root,
    unreadable,
  }: {
    root: string;
    unreadable: readonly string[];
  }): HeldExportUnreadableError => ({
    code: "HELD_EXPORT_UNREADABLE",
    message:
      `chatgpt: ${String(unreadable.length)} held export(s) under ${root} will not read or no longer match what was ` +
      "taken in, so no sync or refresh " +
      "counts as current until each directory is moved aside and its zip taken in again " +
      `(\`slopweaver chatgpt sync --from <zip>\`): ${unreadable.join("; ")}`,
    unreadable,
  }),
  manifestUnreadable: ({ directory, detail }: { directory: string; detail: string }): ManifestUnreadableError => ({
    code: "MANIFEST_UNREADABLE",
    directory,
    message: `${directory}: no readable manifest.json (${detail})`,
  }),
  noImportedExport: (): NoImportedExportError => ({
    code: "NO_IMPORTED_EXPORT",
    message:
      "chatgpt: no ChatGPT export has been taken in yet — download one (chatgpt.com → Settings → Data controls → " +
      "Export data), then run `slopweaver chatgpt sync`, or `slopweaver chatgpt import-export --from <zip>`",
  }),
  notAnExport: ({ path }: { path: string }): NotAnExportError => ({
    code: "NOT_AN_EXPORT",
    message: `${path} holds no conversations.json (nor a numbered conversations file), so it is not a ChatGPT export`,
    path,
  }),
  malformedExport: ({ path, detail }: { path: string; detail: string }): MalformedExportError => ({
    code: "MALFORMED_EXPORT",
    message:
      `${path} holds ChatGPT conversations files, but not as one whole export (${detail}) — so nothing is ` +
      "called current while it sits unread; download the export again, or move this zip out of the folder",
    path,
  }),
  unlistableZip: ({ path, detail }: { path: string; detail: string }): UnlistableZipError => ({
    code: "UNLISTABLE_ZIP",
    message:
      `${detail} — so whether that zip is a newer export cannot be told, and ` +
      "nothing is called current while it sits unread; download the export again, or move this zip out of the folder",
    path,
  }),
  unsafeMember: ({ member, why }: { member: string; why: string }): UnsafeMemberError => ({
    code: "UNSAFE_MEMBER",
    message: `refused the archive member ${JSON.stringify(member)}: ${why}`,
    member,
  }),
} as const;
