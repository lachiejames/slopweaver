/**
 * One conversation out of ChatGPT's official data export, turned into the provider-neutral
 * {@link ChatHistoryConversation} every chat-history source projects through.
 *
 * ## The shape
 *
 * Each element of an export's conversations file is a TREE rather than a list: `mapping` holds every node ever
 * written, each pointing at its `parent`, because editing a message or regenerating an answer forks a new branch
 * beside the old one. `current_node` names the leaf the owner last had on screen.
 *
 * Every visible message on EVERY branch is kept, the path from `current_node` to the root marked `current` and the
 * rest `alternate` (`../chatHistory/types.ts` § ChatHistoryBranch says why both). What one message is to a reader —
 * visible, withheld, or unknown — is `exportMessage.ts`'s. A tree that does not hold together (a dangling parent, a
 * node keyed under another id, a second root, a loop) is refused whole: every walk here would otherwise stop short
 * and place the messages under the break as if the branch above did not exist. Whether an element is a shape that
 * may be walked at all — the schema, its bounds, the conversation's id — is `exportSchema.ts`'s.
 *
 * Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { ChatHistoryBranch, ChatHistoryConversation, ChatHistoryMessage } from "../chatHistory/types.js";
import { type ChatgptConversationError, ChatgptConversationErrors } from "./errors.js";
import { isoOf, type MessageFacts, readExportMessage } from "./exportMessage.js";
import { conversationIdOf, type Mapping, type ParsedConversation, readExportSchema } from "./exportSchema.js";

/** Where a conversation's permalink points. */
const CHATGPT_CONVERSATION_ORIGIN = "https://chatgpt.com/c/";

/**
 * The node ids from the leaf the owner last saw up to the root.
 *
 * @param mapping every node of the conversation, by id
 * @param leaf the `current_node` id
 * @returns the ids, leaf first, or `undefined` when the walk meets a cycle
 */
export function currentPath({ mapping, leaf }: { mapping: Mapping; leaf: string }): readonly string[] | undefined {
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = leaf;
  while (typeof cursor === "string") {
    if (seen.has(cursor)) {
      return undefined;
    }
    const node: Mapping[string] | undefined = mapping[cursor];
    if (node === undefined) {
      break;
    }
    seen.add(cursor);
    path.push(cursor);
    cursor = node.parent;
  }
  return path;
}

/** One node's place among the visible messages: how deep, and the nearest visible message above it. */
interface VisiblePlace {
  readonly depth: number;
  readonly parentMessageId: string | undefined;
}

/**
 * The nodes from `start` up to (not including) the first one already placed, or `undefined` on a loop. Ends at a
 * root otherwise, since the tree check has already refused a dangling parent.
 */
function unplacedChain({
  mapping,
  places,
  start,
}: {
  mapping: Mapping;
  places: ReadonlyMap<string, VisiblePlace>;
  start: string;
}): { readonly chain: readonly string[]; readonly placedAbove: string | undefined } | undefined {
  const chain: string[] = [];
  const onChain = new Set<string>();
  let cursor: string | null | undefined = start;
  while (typeof cursor === "string" && !places.has(cursor)) {
    if (onChain.has(cursor)) {
      return undefined;
    }
    onChain.add(cursor);
    chain.push(cursor);
    cursor = mapping[cursor]!.parent;
  }
  return { chain, placedAbove: typeof cursor === "string" ? cursor : undefined };
}

/** The place of a node sitting directly under `aboveId`: one deeper, and parented on it, only when it is visible. */
function placeBelow({
  above,
  aboveId,
  messageIds,
}: {
  above: VisiblePlace;
  aboveId: string | undefined;
  messageIds: ReadonlyMap<string, string>;
}): VisiblePlace {
  const aboveMessageId = aboveId === undefined ? undefined : messageIds.get(aboveId);
  if (aboveMessageId === undefined) {
    return above;
  }
  return { depth: above.depth + 1, parentMessageId: aboveMessageId };
}

/**
 * Every node's place among the visible messages, or `undefined` when a parent chain loops.
 *
 * A node's depth counts the VISIBLE messages above it, so the two answers a regenerate forked sit at the same
 * depth and a hidden context node between them and the question shifts neither. The parent named is the visible
 * node's MESSAGE id, the one its own record carries, never the mapping key it sits under — the two differ.
 */
function visiblePlaces({
  mapping,
  messageIds,
}: {
  mapping: Mapping;
  messageIds: ReadonlyMap<string, string>;
}): ReadonlyMap<string, VisiblePlace> | undefined {
  const places = new Map<string, VisiblePlace>();
  for (const start of Object.keys(mapping)) {
    const walked = unplacedChain({ mapping, places, start });
    if (walked === undefined) {
      return undefined;
    }
    // Walk back down from the first placed node above the chain, giving each node its own place — which is what
    // the node BELOW it sees as "above".
    let aboveId = walked.placedAbove;
    let above: VisiblePlace = { depth: 0, parentMessageId: undefined };
    if (aboveId !== undefined) {
      above = places.get(aboveId)!;
    }
    for (const id of walked.chain.toReversed()) {
      const place = placeBelow({ above, aboveId, messageIds });
      places.set(id, place);
      above = place;
      aboveId = id;
    }
  }
  return places;
}

/**
 * Refuse a tree that does not hold together: a node keyed under an id it does not carry, a parent the mapping lacks,
 * or a second root — each would let a walk stop short and place messages as if the branch above were absent, or
 * carry a second, disconnected conversation in under this one's id.
 */
function checkTree({ id, mapping }: { id: string; mapping: Mapping }): Result<void, ChatgptConversationError> {
  let root: string | undefined;
  for (const [nodeId, node] of Object.entries(mapping)) {
    if (node.id !== nodeId) {
      return err(ChatgptConversationErrors.brokenLink({ conversationId: id, nodeId, why: "key-mismatch" }));
    }
    if (typeof node.parent === "string" && mapping[node.parent] === undefined) {
      return err(ChatgptConversationErrors.brokenLink({ conversationId: id, nodeId, why: "parent-missing" }));
    }
    if (typeof node.parent !== "string" && root !== undefined) {
      return err(ChatgptConversationErrors.brokenLink({ conversationId: id, nodeId, why: "second-root" }));
    }
    if (typeof node.parent !== "string") {
      root = nodeId;
    }
  }
  return ok(undefined);
}

/** The path from `current_node` up, refused when it is absent, outside the mapping, or loops. */
function currentBranch({
  conversation,
  id,
}: {
  conversation: ParsedConversation;
  id: string;
}): Result<ReadonlySet<string>, ChatgptConversationError> {
  const leaf = conversation.current_node;
  if (typeof leaf !== "string") {
    return err(ChatgptConversationErrors.leafAbsent({ conversationId: id }));
  }
  if (conversation.mapping[leaf] === undefined) {
    return err(ChatgptConversationErrors.leafNotInMapping({ conversationId: id, leaf }));
  }
  const path = currentPath({ leaf, mapping: conversation.mapping });
  if (path === undefined) {
    return err(ChatgptConversationErrors.loop({ conversationId: id, from: "current-node" }));
  }
  return ok(new Set(path));
}

/** Every node's message read: the visible ones' facts by node id, the unknown kinds counted, the withheld counted. */
function readMessages({ mapping }: { mapping: Mapping }): {
  readonly facts: ReadonlyMap<string, MessageFacts>;
  readonly unknownKinds: ReadonlyMap<string, number>;
  readonly withheld: number;
} {
  const facts = new Map<string, MessageFacts>();
  const unknownKinds = new Map<string, number>();
  let withheld = 0;
  for (const [nodeId, node] of Object.entries(mapping)) {
    if (node.message === null || node.message === undefined) {
      continue;
    }
    const reading = readExportMessage({ message: node.message });
    if (reading.kind === "visible") {
      facts.set(nodeId, reading.facts);
    } else if (reading.kind === "unknown") {
      const seenBefore = unknownKinds.get(reading.contentType);
      unknownKinds.set(reading.contentType, seenBefore === undefined ? 1 : seenBefore + 1);
    } else {
      withheld += 1;
    }
  }
  return { facts, unknownKinds, withheld };
}

/**
 * The first message id two visible nodes share, when one does. A record's identity is `<conversation>:<message>`, so
 * two such nodes would reach the store as ONE row and the other message would vanish behind a clean exit.
 */
function sharedMessageId({ facts }: { facts: Iterable<MessageFacts> }): string | undefined {
  const seen = new Set<string>();
  for (const fact of facts) {
    if (seen.has(fact.id)) {
      return fact.id;
    }
    seen.add(fact.id);
  }
  return undefined;
}

/**
 * The current branch first, as the transcript reads, oldest first; alternates after, by depth then id, so two reads
 * of one export project identically.
 */
function transcriptOrder(a: ChatHistoryMessage, b: ChatHistoryMessage): number {
  if (a.branch !== b.branch) {
    return a.branch === "current" ? -1 : 1;
  }
  if (a.turnIndex !== b.turnIndex) {
    return a.turnIndex - b.turnIndex;
  }
  return a.id < b.id ? -1 : Number(a.id > b.id);
}

/**
 * Parse one element of an export's conversations file into a conversation.
 *
 * @param value the element, already parsed from its own text
 * @returns the conversation, or the typed reason it will not parse
 */
export function parseExportConversation({
  value,
}: {
  value: unknown;
}): Result<ChatHistoryConversation, ChatgptConversationError> {
  const read = readExportSchema({ value });
  if (read.isErr()) {
    return err(read.error);
  }
  const conversation = read.value;
  const identified = conversationIdOf({ conversation });
  if (identified.isErr()) {
    return err(identified.error);
  }
  const id = identified.value;
  const tree = checkTree({ id, mapping: conversation.mapping }).andThen(() => currentBranch({ conversation, id }));
  if (tree.isErr()) {
    return err(tree.error);
  }
  const { facts, unknownKinds, withheld } = readMessages({ mapping: conversation.mapping });
  const messageIds = new Map([...facts].map(([nodeId, fact]) => [nodeId, fact.id] as const));
  const places = visiblePlaces({ mapping: conversation.mapping, messageIds });
  if (places === undefined) {
    return err(ChatgptConversationErrors.loop({ conversationId: id, from: "mapping" }));
  }
  const duplicate = sharedMessageId({ facts: facts.values() });
  if (duplicate !== undefined) {
    return err(ChatgptConversationErrors.duplicateMessage({ conversationId: id, messageId: duplicate }));
  }
  const messages = [...facts].map(([nodeId, fact]): ChatHistoryMessage => {
    const place = places.get(nodeId)!;
    const branch: ChatHistoryBranch = tree.value.has(nodeId) ? "current" : "alternate";
    return { ...fact, branch, parentMessageId: place.parentMessageId, turnIndex: place.depth };
  });
  return ok({
    createdIso: isoOf({ seconds: conversation.create_time }),
    id,
    messages: messages.toSorted(transcriptOrder),
    title: typeof conversation.title === "string" && conversation.title.length > 0 ? conversation.title : undefined,
    unknownKinds,
    updatedIso: isoOf({ seconds: conversation.update_time }),
    url: `${CHATGPT_CONVERSATION_ORIGIN}${id}`,
    withheld,
  });
}
