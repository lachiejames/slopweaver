/**
 * The provider-neutral shape of one assistant-chat conversation, as the chat-history corpus sources share it.
 *
 * ChatGPT is the first provider and Claude.ai is the next, and its history gets the same treatment. Both hand
 * their history over as an export archive whose
 * per-provider shape is nothing alike — ChatGPT's conversation is a TREE of nodes with a pointer to the branch
 * the owner last saw, Claude's is a flat list — so each provider owns exactly one thing: turning its archive into
 * {@link ChatHistoryConversation}s. Everything after that, the projection into bronze records included, is
 * written once in `./project.ts` and shared. A flat-list provider marks every message `current`.
 */

/** Who said a message — the person who owns the account, or the assistant that answered that person. */
export type ChatHistoryRole = "user" | "assistant";

/**
 * Whether a message sits on the branch the owner last had on screen, or on one an edit or a regenerate forked away from.
 *
 * Both are kept because bronze is append-only: a later export that moved the current branch cannot retract the
 * records an earlier one wrote, so dropping alternates would leave the corpus holding them anyway, unlabelled.
 * Labelled, a reader can prefer the current path and still find the answer the owner regenerated past.
 */
export type ChatHistoryBranch = "current" | "alternate";

/** One visible message in a conversation. */
export interface ChatHistoryMessage {
  /** The provider's own id for the message, stable across exports. */
  readonly id: string;
  readonly role: ChatHistoryRole;
  /** When the message was written, when the provider recorded an instant. */
  readonly createdIso: string | undefined;
  /** Its words: typed text, a voice turn's transcription — never a tool's raw output. */
  readonly text: string;
  /** The model that wrote an assistant message, when the provider recorded one. */
  readonly model: string | undefined;
  /** How the message reached the conversation — `voice` for a spoken turn, `typed` otherwise. */
  readonly modality: "voice" | "typed";
  /** Attachments named but not carried (an image, a file), counted so a record can say words are missing. */
  readonly attachments: number;
  readonly branch: ChatHistoryBranch;
  /** The nearest visible message this one answers or follows, when there is one. */
  readonly parentMessageId: string | undefined;
  /** Its depth among visible messages from the conversation's start — the same on every branch at one depth. */
  readonly turnIndex: number;
}

/** One conversation, normalised. */
export interface ChatHistoryConversation {
  /** The provider's own conversation id — what its URL carries. */
  readonly id: string;
  readonly title: string | undefined;
  readonly createdIso: string | undefined;
  readonly updatedIso: string | undefined;
  /** Its permalink, for a citation. */
  readonly url: string;
  /** The visible messages: the current branch oldest first, then every alternate. */
  readonly messages: readonly ChatHistoryMessage[];
  /** Messages the provider holds that were NOT kept — a tool call, a hidden system turn, the model's working. */
  readonly withheld: number;
  /**
   * User or assistant messages whose content kind this parser does not know, by kind — reported, never silently
   * lost, because the archive format grows with every ChatGPT feature and a kind first seen in a real export is
   * exactly what a synthetic fixture cannot anticipate. A `Map`, never a plain object: a kind is the archive's own
   * string, and one named `__proto__` would land on an object's prototype rather than as a key anything iterates.
   */
  readonly unknownKinds: ReadonlyMap<string, number>;
}
