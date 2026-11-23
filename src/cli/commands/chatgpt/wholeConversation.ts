/**
 * One ChatGPT conversation read whole through the owner's web session: `GET /backend-api/conversation/<id>`, the
 * singular endpoint, which answers the whole `mapping` tree, every branch and voice turn, in ONE response.
 *
 * MEASURED against the owner's account (one conversation of twelve nodes; a re-measure is one paced
 * GET of this path through the stored session, printing key names and value types only): the body is one conversation in the official
 * export's own shape, `conversation_id` and no `id`, epoch-second `create_time` and `update_time`, and the
 * thirty-seven top-level keys {@link wholeConversationWire} declares. So the body is read twice: first against that
 * strict key set, where a key the measurement never saw refuses by name, then through the export's own element reader
 * and parser (`corpus/chatgpt/exportElement.ts`, `exportConversation.ts`), exactly as one element of an export file is.
 * Reading it through the export's parser is what lets a live copy and an export copy of one chat project to the very
 * same records, so the merge weighs them as two versions of one conversation and bronze stores it once.
 *
 * The path is built from an id the listing already admitted, never from a response. Pure.
 */
import { z } from "zod";
import { defineBoundary } from "#lib/boundary.js";
import { err, ok, type Result } from "#lib/result.js";
import { parseExportConversation } from "../../../corpus/chatgpt/exportConversation.js";
import { readExportElement } from "../../../corpus/chatgpt/exportElement.js";
import { CHATGPT_CONVERSATION_ID } from "../../../corpus/chatgpt/exportSchema.js";
import type { ChatHistoryConversation } from "../../../corpus/chatHistory/types.js";
import { type ChatgptError, ChatgptErrors } from "./errors.js";
import { boundaryRefusal } from "./web.js";

/** A key the measurement saw and this read does not use: declared, so a NEW key still refuses. */
const unread = z.unknown().optional();

/** The whole-conversation body's top level. Key set MEASURED; the tree inside is the export parser's to read. */
const wholeConversationWire = z.strictObject({
  async_status: unread,
  atlas_mode_enabled: unread,
  blocked_urls: unread,
  context_scopes: unread,
  context_truncation_continuation: unread,
  conversation_id: z.string(),
  conversation_origin: unread,
  conversation_template_id: unread,
  create_time: unread,
  current_node: unread,
  default_model_slug: unread,
  disabled_tool_ids: unread,
  gizmo_id: unread,
  gizmo_type: unread,
  is_archived: unread,
  is_do_not_remember: unread,
  is_read_only: unread,
  is_starred: unread,
  is_study_mode: unread,
  is_temporary_chat: unread,
  // The tree is typed node by node by the export parser this body goes through next, never here.
  mapping: unread,
  memory_scope: unread,
  moderation_results: unread,
  owner: unread,
  pinned_time: unread,
  plugin_ids: unread,
  safe_urls: unread,
  sectioned_conversation: unread,
  sugar_item_id: unread,
  sugar_item_visible: unread,
  title: unread,
  update_time: unread,
  voice: unread,
});

const WHOLE_CONVERSATION_BOUNDARY = defineBoundary({
  endpoint: "GET /backend-api/conversation/:id",
  schema: wholeConversationWire,
});

/** One conversation read whole: parsed, and the exact text to hold as its live snapshot. */
export interface WholeChatgptConversation {
  readonly conversation: ChatHistoryConversation;
  readonly elementText: string;
}

/**
 * The path one conversation is read whole at. Pure.
 *
 * @param id a conversation id the listing admitted
 * @returns the path, or the refusal when the id is not one
 */
export function wholeConversationPath({ id }: { id: string }): Result<string, ChatgptError> {
  if (!CHATGPT_CONVERSATION_ID.test(id)) {
    return err(ChatgptErrors.pageMalformed({ path: "/backend-api/conversation", problems: ["not a conversation id"] }));
  }
  return ok(`/backend-api/conversation/${id}`);
}

/**
 * One whole-conversation body read: the strict top-level key set, then the export's own element reader and parser,
 * then the id it answers for checked against the one asked. Pure.
 *
 * @param expectedId the conversation the path asked for
 * @param path the path asked, named in a refusal
 * @param text the body
 * @returns the conversation and the text to hold, or the refusal naming what did not read
 */
export function parseWholeConversation({
  expectedId,
  path,
  text,
}: {
  expectedId: string;
  path: string;
  text: string;
}): Result<WholeChatgptConversation, ChatgptError> {
  const wire = WHOLE_CONVERSATION_BOUNDARY.parseJson({ text });
  if (wire.isErr()) {
    return err(boundaryRefusal({ error: wire.error, path }));
  }
  const element = readExportElement({ label: `chatgpt ${path}`, text });
  if (element.isErr()) {
    return err(ChatgptErrors.pageMalformed({ path, problems: [element.error.message] }));
  }
  const parsed = parseExportConversation({ value: element.value });
  if (parsed.isErr()) {
    return err(ChatgptErrors.pageMalformed({ path, problems: [parsed.error.message] }));
  }
  if (parsed.value.id !== expectedId) {
    return err(ChatgptErrors.pageMalformed({ path, problems: ["the body answers for another conversation"] }));
  }
  return ok({ conversation: parsed.value, elementText: text });
}
