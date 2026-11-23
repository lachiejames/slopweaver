/**
 * One ChatGPT conversation, paged newest-first out of the web backend and put back in order. Pure except
 * for the injected `fetchText`; each answer is read through its endpoint's strict boundary (`#lib/boundary.js`).
 *
 * **Two URLs exist in this module, both over the one id asked for**: the conversation itself, and its older
 * messages before a cursor. Listing the account is `listing.ts`'s; this module reads one named chat into a
 * readable transcript under `live/`.
 *
 * The page shape is the backend's own, MEASURED against their recording and a live read: a
 * `messages` array of ten turns and a `page_info` whose `start_cursor` is the `before` of the next-older
 * page while `has_previous_page` holds. A voice turn is `multimodal_text` whose parts are
 * `audio_transcription` objects carrying `text`; a typed turn is `text` whose parts are strings.
 */

import { z } from "zod";
import { defineBoundary } from "#lib/boundary.js";
import { epochSecondsToIso } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { CHATGPT_CONVERSATION_ID } from "../../../corpus/chatgpt/exportSchema.js";
import { classifyChatgptPart } from "../../../corpus/chatgpt/parts.js";
import { type ChatgptError, ChatgptErrors } from "./errors.js";
import { CHATGPT_ORIGIN } from "./web.js";

/** Turns per page — the value the web app itself asks with. */
const TURNS_PER_PAGE = 10;

/**
 * The argument as a conversation id, refused before any request when it is not one.
 *
 * @param given what the caller typed; a `chatgpt.com/c/<id>` link is accepted and reduced to its id
 * @returns the lowercase id, or `NOT_A_CONVERSATION_ID`
 */
export function parseConversationId({ given }: { given: string }): Result<string, ChatgptError> {
  const candidate = given
    .trim()
    .replace(/^https:\/\/chatgpt\.com\/c\//, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
  if (!CHATGPT_CONVERSATION_ID.test(candidate)) {
    return err(ChatgptErrors.notAConversationId({ given }));
  }
  return ok(candidate);
}

/**
 * The newest page of one conversation — the request the web app makes when the chat is opened.
 *
 * @param id a conversation id {@link parseConversationId} accepted
 * @returns the path, relative to {@link CHATGPT_ORIGIN}
 */
export function newestPagePath({ id }: { id: string }): string {
  return `/backend-api/conversations/${id}?num_turns=${String(TURNS_PER_PAGE)}&include_has_versions=true`;
}

/**
 * The page of the same conversation older than a cursor — the request the web app makes on scroll-up.
 *
 * @param id a conversation id {@link parseConversationId} accepted
 * @param before the `start_cursor` of the page already read
 * @returns the path, relative to {@link CHATGPT_ORIGIN}
 */
export function olderPagePath({ id, before }: { id: string; before: string }): string {
  return `/backend-api/conversations/${id}/messages?before=${encodeURIComponent(before)}&num_turns=${String(TURNS_PER_PAGE)}&include_has_versions=true`;
}

/** A key the answer carries that nothing here reads: declared, so one more is refused by name. */
const unread = z.unknown().optional();

/**
 * One content part: a typed turn's string, or an object naming its kind — a voice turn's `audio_transcription`, or
 * an attached image's `image_asset_pointer`, whose pointer, size and dimensions are declared and never read.
 */
const partWire = z.union([
  z.string(),
  z.strictObject({
    asset_pointer: unread,
    content_type: z.string(),
    decoding_id: unread,
    direction: unread,
    fovea: unread,
    height: unread,
    metadata: unread,
    mime_type: unread,
    size_bytes: unread,
    text: z.string().optional(),
    width: unread,
  }),
]);

const messageWire = z.strictObject({
  author: z.strictObject({ metadata: unread, name: unread, role: z.string() }),
  channel: unread,
  content: z.strictObject({
    content: unread,
    content_type: z.string(),
    language: unread,
    parts: z.array(partWire).optional(),
    response_format_name: unread,
    source_analysis_msg_id: unread,
    text: unread,
    thoughts: unread,
  }),
  create_time: z.number().nullable(),
  end_turn: unread,
  id: z.string(),
  metadata: unread,
  recipient: unread,
  status: unread,
  update_time: unread,
  weight: unread,
});

/** The page-level keys the newest page carries and nothing here reads. */
const UNREAD_PAGE_KEYS = {
  async_status: unread,
  atlas_mode_enabled: unread,
  blocked_urls: unread,
  context_scopes: unread,
  context_truncation_continuation: unread,
  conversation_id: unread,
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
  memory_scope: unread,
  moderation_results: unread,
  owner: unread,
  pinned_time: unread,
  plugin_ids: unread,
  safe_urls: unread,
  sectioned_conversation: unread,
  sugar_item_id: unread,
  sugar_item_visible: unread,
  update_time: unread,
  voice: unread,
};

/**
 * One page, either endpoint: the messages, the cursor and the title are read, every other key is declared. The
 * key sets are MEASURED, not guessed — the page level off the newest page in their recording, the message, author,
 * content and part levels off all 865 messages a live read of every page of their one chat stored:
 *
 * `jq -sc '[.[]|keys]|add|unique' $SLOPWEAVER_HOME/live/chatgpt/conversations/<id>/messages.jsonl`
 *
 * No older page was recorded whole, so its top level is held to the newest page's: a key only it carries is
 * refused by name, and one line here declares it.
 */
const pageWire = z.strictObject({
  ...UNREAD_PAGE_KEYS,
  messages: z.array(messageWire),
  page_info: z.strictObject({
    end_cursor: unread,
    has_next_page: unread,
    has_previous_page: z.boolean(),
    start_cursor: z.string().nullable(),
  }),
  title: z.string().nullable().optional(),
});

/** The two endpoints this module reads, one boundary each. */
const PAGE_BOUNDARIES = {
  newest: defineBoundary({ endpoint: "GET /backend-api/conversations/:id", schema: pageWire }),
  older: defineBoundary({ endpoint: "GET /backend-api/conversations/:id/messages", schema: pageWire }),
} as const;

/** One message as the backend sends it, every key it was read with kept. */
export type ChatgptMessage = z.infer<typeof messageWire>;

/** One page of messages, newest page first. */
export interface ChatgptPage {
  readonly messages: readonly ChatgptMessage[];
  readonly olderCursor: string | null;
  readonly title: string | null;
}

/**
 * Read one answer's body through its endpoint's strict boundary.
 *
 * @param path the path it answered, named in a refusal
 * @param text the body as sent
 * @param endpoint which of the two endpoints answered: the conversation's newest page, or an older one
 * @returns the page; `NOT_JSON` for a body that is not JSON; `PAGE_MALFORMED` carrying the boundary's own refusal,
 *   which names every field added, dropped, renamed or retyped
 */
export function parsePage({
  path,
  text,
  endpoint,
}: {
  path: string;
  text: string;
  endpoint: keyof typeof PAGE_BOUNDARIES;
}): Result<ChatgptPage, ChatgptError> {
  const parsed = PAGE_BOUNDARIES[endpoint].parseJson({ text });
  if (parsed.isErr()) {
    if (parsed.error.code === "BOUNDARY_NOT_JSON") {
      return err(ChatgptErrors.notJson({ contentType: "a body declared JSON that does not parse", path }));
    }
    return err(ChatgptErrors.pageMalformed({ path, problems: [parsed.error.message] }));
  }
  const { messages, page_info: pageInfo, title } = parsed.value;
  if (pageInfo.has_previous_page && pageInfo.start_cursor === null) {
    return err(ChatgptErrors.pageMalformed({ path, problems: ["has_previous_page with no start_cursor"] }));
  }
  return ok({
    messages,
    olderCursor: pageInfo.has_previous_page ? pageInfo.start_cursor : null,
    title: typeof title === "string" ? title : null,
  });
}

/** What {@link pullConversation} hands back. */
export interface PulledConversation {
  readonly messages: readonly ChatgptMessage[];
  readonly pages: number;
  readonly title: string | null;
}

/**
 * Read one conversation whole: the newest page, then each older page until none is left.
 *
 * Refuses rather than truncates at `maxPages`, because a transcript missing its opening reads exactly like a
 * whole one. Refuses a cursor that does not move, because the loop would otherwise never end.
 *
 * @param id a conversation id {@link parseConversationId} accepted
 * @param fetchText one GET of a path under {@link CHATGPT_ORIGIN}, answered as the body's text
 * @param maxPages the most pages to read before refusing
 * @returns every message in conversation order, or the first failure
 */
export async function pullConversation({
  id,
  fetchText,
  maxPages,
}: {
  id: string;
  fetchText: (args: { path: string }) => Promise<Result<string, ChatgptError>>;
  maxPages: number;
}): Promise<Result<PulledConversation, ChatgptError>> {
  const pages: ChatgptPage[] = [];
  let path = newestPagePath({ id });
  let endpoint: "newest" | "older" = "newest";
  let asked: string | null = null;
  for (;;) {
    const body = await fetchText({ path });
    if (body.isErr()) {
      return err(body.error);
    }
    const page = parsePage({ endpoint, path, text: body.value });
    if (page.isErr()) {
      return err(page.error);
    }
    pages.push(page.value);
    const cursor = page.value.olderCursor;
    if (cursor === null) {
      break;
    }
    if (cursor === asked) {
      return err(ChatgptErrors.cursorStalled({ cursor }));
    }
    if (pages.length >= maxPages) {
      return err(ChatgptErrors.pageBoundExceeded({ maxPages }));
    }
    asked = cursor;
    path = olderPagePath({ before: cursor, id });
    endpoint = "older";
  }
  const title = pages[0]!.title;
  return ok({ messages: mergeMessages({ pages }), pages: pages.length, title });
}

/**
 * Every message of every page once, oldest first. A message with no `create_time` keeps its page order and
 * sorts after every timed one — the backend leaves the root node untimed.
 *
 * @param pages the pages as read, newest first
 * @returns the messages in conversation order
 */
export function mergeMessages({ pages }: { pages: readonly ChatgptPage[] }): readonly ChatgptMessage[] {
  const byId = new Map<string, ChatgptMessage>();
  for (const page of pages.toReversed()) {
    for (const message of page.messages) {
      if (!byId.has(message.id)) {
        byId.set(message.id, message);
      }
    }
  }
  return [...byId.values()].toSorted((a, b) => {
    if (a.create_time === null && b.create_time === null) {
      return 0;
    }
    if (a.create_time === null) {
      return 1;
    }
    if (b.create_time === null) {
      return -1;
    }
    return a.create_time - b.create_time;
  });
}

/**
 * The words of one message: string parts as they are, an `audio_transcription` part's `text`, and any other
 * part named by its kind rather than dropped.
 *
 * @param message one backend message
 * @returns the text, parts joined by a blank line; empty when the message carries no parts
 */
export function messageText({ message }: { message: ChatgptMessage }): string {
  const parts = message.content.parts;
  if (parts === undefined) {
    return "";
  }
  const pieces: string[] = [];
  for (const part of parts) {
    const classified = classifyChatgptPart({ part });
    if (classified === undefined) {
      continue;
    }
    pieces.push(classified.kind === "words" ? classified.text : `[${classified.contentType}]`);
  }
  return pieces
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .join("\n\n");
}

/**
 * The conversation as a readable transcript: one heading per spoken or typed turn, in order. A message with
 * no words (a tool call, the untimed root) is counted in the header rather than printed as an empty turn.
 *
 * @param id the conversation id
 * @param title the conversation's title, when the backend gave one
 * @param messages the messages in conversation order
 * @returns the markdown
 */
export function renderTranscript({
  id,
  title,
  messages,
}: {
  id: string;
  title: string | null;
  messages: readonly ChatgptMessage[];
}): string {
  const turns: string[] = [];
  let wordless = 0;
  for (const message of messages) {
    const text = messageText({ message });
    if (text.length === 0) {
      wordless += 1;
      continue;
    }
    let when = "untimed";
    if (message.create_time !== null) {
      const iso = epochSecondsToIso({ seconds: message.create_time });
      if (iso !== undefined) {
        when = iso;
      }
    }
    turns.push(`## ${message.author.role} · ${when}\n\n${text}\n`);
  }
  const heading = title === null ? `# ChatGPT conversation ${id}` : `# ${title}`;
  const summary = `${CHATGPT_ORIGIN}/c/${id} — ${String(turns.length)} turn(s), ${String(wordless)} wordless message(s) not shown`;
  return `${heading}\n\n${summary}\n\n${turns.join("\n")}`;
}
