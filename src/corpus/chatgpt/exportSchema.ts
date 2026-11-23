/**
 * The schema one element of a ChatGPT export's conversations file is read against, the bounds that read runs at,
 * and the one id the conversation is known by. What the tree MEANS — branches, places, the transcript — is
 * `exportConversation.ts`'s; this file is only whether the element is a shape that may be walked at all.
 *
 * ## Why the schema is not a strict boundary
 *
 * `defineBoundary` is the house read for a provider ENDPOINT, and it refuses any key it was not told about. An
 * export is not an endpoint: it is an archive whose per-message `metadata` and per-conversation keys grow with
 * every ChatGPT feature, none of which this reads. A strict read would refuse the owner's whole history the first time
 * OpenAI added a flag. So every field this module READS is declared and typed, and a missing or retyped one is
 * refused by name, per conversation; keys it never reads pass through. That keeps the property the boundary
 * rule exists for — a rename of something read is a refusal, never a silent misread — without making an
 * unread flag a reason to lose the archive.
 *
 * Pure.
 */

import { z } from "zod";
import { err, ok, type Result } from "#lib/result.js";

import { type ChatgptConversationError, ChatgptConversationErrors } from "./errors.js";
import { epochSecondsSchema, idSchema, isPrototypeName, messageSchema, PROTOTYPE_NAME_ISSUE } from "./exportMessage.js";

/**
 * A conversation id: the UUID in `chatgpt.com/c/<id>`. The ONE definition — `chatgpt conversation` refuses an
 * argument by it and `live/recordReadPlan.ts` plans a read by it, so the two cannot disagree on what is readable.
 */
export const CHATGPT_CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A conversation's `id` or `conversation_id`: {@link CHATGPT_CONVERSATION_ID}'s shape, so every chat that ingests is
 * one the live read can address, and an id the provider changed the shape of is refused by name rather than
 * indexed under a key the merge would never match against an earlier export's.
 */
const conversationIdSchema = idSchema.regex(CHATGPT_CONVERSATION_ID, "not a conversation id the live read accepts");

const nodeSchema = z
  .object({
    id: idSchema,
    message: messageSchema.nullable().optional(),
    parent: idSchema.nullable().optional(),
  })
  .loose();

const conversationSchema = z
  .object({
    conversation_id: conversationIdSchema.optional(),
    create_time: epochSecondsSchema,
    current_node: idSchema.nullable().optional(),
    id: conversationIdSchema.optional(),
    mapping: z.record(idSchema, nodeSchema),
    title: z.string().nullable().optional(),
    update_time: epochSecondsSchema,
  })
  .loose();

/** A conversation's nodes, by id, as the schema reads them. */
export type Mapping = Readonly<Record<string, z.infer<typeof nodeSchema>>>;

/** The conversation as the schema reads it. */
export type ParsedConversation = z.infer<typeof conversationSchema>;

/**
 * The most nodes one conversation's `mapping` may hold. Every message, branch and hidden turn is one node, so a
 * conversation a person could have had sits orders of magnitude below; the bound exists for what Zod does with a mapping
 * past it (see {@link readExportSchema}). A choice, not a measurement.
 */
export const EXPORT_MAPPING_NODES = 50_000;

/**
 * How many keys `value.mapping` holds, counted no further than one past the bound so a huge mapping costs no key
 * array, and the first key {@link isPrototypeName} refuses; zero and none for anything that is not a plain object,
 * which the schema refuses on its own.
 */
function scanMapping({ value }: { value: unknown }): { count: number; prototypeKey: string | undefined } {
  const none = { count: 0, prototypeKey: undefined };
  if (typeof value !== "object" || value === null || !("mapping" in value)) {
    return none;
  }
  const mapping = value.mapping;
  if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) {
    return none;
  }
  let count = 0;
  let prototypeKey: string | undefined;
  for (const key in mapping) {
    if (!Object.hasOwn(mapping, key)) {
      continue;
    }
    count += 1;
    if (prototypeKey === undefined && isPrototypeName({ id: key })) {
      prototypeKey = key;
    }
    if (count > EXPORT_MAPPING_NODES) {
      break;
    }
  }
  return { count, prototypeKey };
}

/** How many schema issues a shape refusal names; the rest are counted. A choice: enough to diagnose, never a list. */
const SHAPE_ISSUES_SHOWN = 5;

/** The longest one named issue line runs to. A choice, sized to read as one line. */
const SHAPE_ISSUE_CHARS = 200;

/**
 * The element read against the schema, bounded twice over, because both sizes are the element's to choose: a hostile
 * mapping raises one issue per entry, and a key in an issue's path can be as long as the element itself.
 *
 * @param value the element, already parsed from its own text
 * @returns the element as the schema reads it, or the shape refusal naming at most five issues
 */
export function readExportSchema({ value }: { value: unknown }): Result<ParsedConversation, ChatgptConversationError> {
  // Before the schema, never after: Zod raises one issue per bad mapping entry and keeps every one, so a mapping of
  // millions of entries would build millions of issues before the five-issue cut below ever ran. A prototype-named
  // key is refused here too, because Zod's record skips an own `__proto__` key without an issue.
  const scanned = scanMapping({ value });
  if (scanned.count > EXPORT_MAPPING_NODES) {
    const issue = `mapping: more than ${String(EXPORT_MAPPING_NODES)} nodes, past what one conversation is read at`;
    return err(ChatgptConversationErrors.shape({ issueCount: 1, issues: [issue] }));
  }
  if (scanned.prototypeKey !== undefined) {
    const issue = `mapping.${scanned.prototypeKey}: ${PROTOTYPE_NAME_ISSUE}`;
    return err(ChatgptConversationErrors.shape({ issueCount: 1, issues: [issue] }));
  }
  const parsed = conversationSchema.safeParse(value);
  if (parsed.success) {
    return ok(parsed.data);
  }
  // Each path segment is cut before the join, never after it, so no copy of a hostile key is ever built whole.
  const issues = parsed.error.issues.slice(0, SHAPE_ISSUES_SHOWN).map((issue) => {
    const where =
      issue.path.length === 0
        ? "(conversation)"
        : issue.path.map((segment) => String(segment).slice(0, SHAPE_ISSUE_CHARS)).join(".");
    return `${where}: ${issue.message}`.slice(0, SHAPE_ISSUE_CHARS);
  });
  return err(ChatgptConversationErrors.shape({ issueCount: parsed.error.issues.length, issues }));
}

/**
 * The one id a conversation is known by. Newer exports carry `id`, older ones only `conversation_id`, and both name
 * the same conversation — so when both are present they must agree: a chat taken by one in this export and the
 * other in the next would sit under two keys, and the merge would never weigh its versions against each other.
 *
 * @param conversation the element as the schema read it
 * @returns the id, or the refusal naming a disagreeing pair or no id at all
 */
export function conversationIdOf({
  conversation,
}: {
  conversation: ParsedConversation;
}): Result<string, ChatgptConversationError> {
  const { id, conversation_id: conversationId } = conversation;
  if (id !== undefined && conversationId !== undefined && id !== conversationId) {
    return err(ChatgptConversationErrors.idConflict({ conversationId, id }));
  }
  if (id !== undefined) {
    return ok(id);
  }
  if (conversationId !== undefined) {
    return ok(conversationId);
  }
  return err(ChatgptConversationErrors.unidentified());
}
