/**
 * One message out of a ChatGPT export conversation, and what it is to a reader of that conversation: visible (the owner's
 * turn, or the assistant's reply TO THE OWNER, typed or spoken), withheld (system and tool turns, the assistant's calls
 * to its own tools, hidden context, the model's working), or unknown (a role, content kind or part kind this module
 * has never seen, on a message that may be carrying words the owner saw — counted by name, never kept or quietly dropped).
 *
 * The tree the messages sit in is `exportConversation.ts`'s. This file is the per-message read and the schema of a
 * message, so the bounds every field is read at are declared once beside the read that relies on them.
 *
 * Pure.
 */

import { z } from "zod";
import { epochSecondsToIso } from "#lib/date.js";

import type { ChatHistoryMessage, ChatHistoryRole } from "../chatHistory/types.js";
import { classifyChatgptPart } from "./parts.js";

/**
 * The longest id — a conversation's, a node's, a message's — this reader accepts. Every id here is a UUID or a short
 * fixed name, and an id is what a refusal names, so an element choosing a 100 MiB one would otherwise choose the size
 * of every error that quotes it. A choice, well clear of any id an export carries.
 */
export const EXPORT_ID_CHARS = 200;

/** What a refusal says of an id {@link isPrototypeName} catches. */
export const PROTOTYPE_NAME_ISSUE = "a name every JavaScript object already carries, which no real id is";

/**
 * Whether an id is a name every JavaScript object already answers to (`__proto__`, `constructor`, `toString`, …). The
 * tree is walked by looking ids up in the parsed `mapping`, a plain object, so such an id would resolve through the
 * prototype — a parent that is "there" when the mapping never held it — and Zod's record skips an own `__proto__` key
 * outright, so a node keyed that way would drop out with every message under it. No real id is one; refusing it by
 * name is cheaper than proving every lookup safe.
 *
 * @param id the id as the export spelled it
 * @returns true when it is one of those names
 */
export function isPrototypeName({ id }: { id: string }): boolean {
  return id in Object.prototype;
}

/**
 * An id field, non-empty, bounded to {@link EXPORT_ID_CHARS} and never a {@link isPrototypeName} name; the schema's
 * refusal names the field, never the value. Non-empty because an id is a dedup key: two nodes or messages sharing
 * `""` would collapse into one.
 */
export const idSchema = z
  .string()
  .min(1)
  .max(EXPORT_ID_CHARS)
  .refine((id) => !isPrototypeName({ id }), PROTOTYPE_NAME_ISSUE);

/** What a refusal says of a time {@link epochSecondsSchema} catches. */
export const UNREPRESENTABLE_TIME_ISSUE = "a time no date can hold";

/** An instant in years 0000–9999, the only ISO strings whose text order is their time order. */
const FOUR_DIGIT_YEAR_ISO = /^\d{4}-/;

/**
 * An export's epoch-seconds time field: absent, `null`, or one a date can be built from. A number past what a date
 * can hold is refused by its field rather than read as absent, which would date the message by its conversation and
 * call the export clean. So is one outside years 0000–9999: its ISO year is signed and six digits (`+010000-…`), so
 * it sorts before 2026 as text, and the merge orders versions by that text.
 */
export const epochSecondsSchema = z
  .number()
  .refine((seconds) => {
    const iso = epochSecondsToIso({ seconds });
    return iso !== undefined && FOUR_DIGIT_YEAR_ISO.test(iso);
  }, UNREPRESENTABLE_TIME_ISSUE)
  .nullable()
  .optional();

/**
 * The longest content kind or role this reader accepts. An unknown one is counted BY NAME across the whole export and
 * named in a gap, so its length is the archive's to choose otherwise. Real ones are short snake_case words.
 */
const CONTENT_KIND_CHARS = 100;

/**
 * What a server-chosen token (a role, a recipient, a content or part kind) must look like to be NAMED in a gap. Real
 * ones are snake_case or dotted words; anything else (a space, a colon) could be a conversation's words, and a gap
 * prints on stderr, so it is named by its length instead.
 */
const KIND_TOKEN = /^[A-Za-z0-9_.\-/]+$/;

/** A server-chosen token as a gap may name it: itself when it reads as an identifier, else only its length. */
function kindToken({ token }: { token: string }): string {
  if (KIND_TOKEN.test(token)) {
    return token.slice(0, CONTENT_KIND_CHARS);
  }
  return `(unnamed, ${String(token.length)} chars)`;
}

/** The content kinds whose `parts` are what the owner or the assistant SAID. */
const PARTS_CONTENT = new Set(["text", "multimodal_text"]);

/**
 * The content kinds that are the model's working or the app's scaffolding, never its answer — withheld by
 * name, so a kind NOT here is a new one and reported rather than lost.
 */
const WORKING_CONTENT = new Set([
  "execution_output",
  "model_editable_context",
  "reasoning_recap",
  "sonic_webpage",
  "system_error",
  "tether_browsing_display",
  "tether_quote",
  "thoughts",
  "user_editable_context",
]);

/** The author roles that are never the conversation the owner saw: the app's own framing and a tool's output. */
const WITHHELD_ROLES = new Set(["system", "tool"]);

/**
 * The assistant recipients known to be one of its own tools, so a message addressed to one is the model's working,
 * not its reply. A recipient NOT here, and not `all`, may be a reply routed some new way, so it is reported rather
 * than withheld — the same rule {@link WORKING_CONTENT} applies to a content kind. MEASURED over the owner's
 * recorded chat (`grep -oh '"recipient":"[^"]*"' $SLOPWEAVER_HOME/live/chatgpt/conversations/*[0-9a-f]/messages.jsonl |
 * sort | uniq -c`): `all` 863, `api_tool.call_tool` 1, `api_tool.list_resources` 1. `python` is the code tool the
 * synthetic fixture's call is addressed to. `web.run` is ChatGPT's web search, learned off the first live-sync walk's gap
 * (`find $SLOPWEAVER_HOME/corpus/chatgpt/live/snapshots -name '[0-9a-f]*.json' -exec grep -oh '"recipient": *"[^"]*"'
 * {} + | sort | uniq -c` over 3 chats: `all` 28, `web.run` 5). Every other tool name is learned off a real gap, one
 * line each. The nine after `web.run` were learned off the first full live-sync walk's refresh over 226 chats, each
 * addressed by the assistant with a code-kind call and none of it words the owner saw: `bio` 34 (the memory tool),
 * `container.exec` 28, `genui.run` 3, `genui.search` 51, `hotline.get_local_hotline` 2, `web` 4 (a text-kind search
 * call, the older spelling of `web.run`), and three opaque connector ids spelled in the set below, 10, 2 and 50 calls
 * each in the order the set lists them. Counted by author role, recipient and content kind over the stored live copies, never reading
 * a message's words.
 */
const TOOL_RECIPIENTS = new Set([
  "api_tool.call_tool",
  "api_tool.list_resources",
  "bio",
  "container.exec",
  "de1d73e.create",
  "de1d73e.update",
  "genui.run",
  "genui.search",
  "hotline.get_local_hotline",
  "python",
  "q7dr546",
  "web",
  "web.run",
]);

/**
 * The part kinds known to carry no words of their own — an image the owner attached. Counted as an attachment. A part kind
 * NOT here, and not words or a recording, may be carrying words this reader would drop, so it is reported rather
 * than counted: the same rule {@link WORKING_CONTENT} applies to a whole message.
 */
const ATTACHMENT_PARTS = new Set(["image_asset_pointer"]);

export const messageSchema = z
  .object({
    author: z.object({ role: z.string().max(CONTENT_KIND_CHARS) }).loose(),
    content: z
      .object({
        content_type: z.string().max(CONTENT_KIND_CHARS),
        language: z.string().nullable().optional(),
        parts: z.array(z.unknown()).optional(),
        text: z.string().optional(),
      })
      .loose(),
    create_time: epochSecondsSchema,
    id: idSchema,
    metadata: z
      .object({
        is_visually_hidden_from_conversation: z.boolean().nullable().optional(),
        model_slug: z.string().nullable().optional(),
        voice_mode_message: z.boolean().nullable().optional(),
      })
      .loose()
      .optional(),
    recipient: z.string().nullable().optional(),
  })
  .loose();

/** One export message as this module reads it. */
type ExportMessage = z.infer<typeof messageSchema>;

/** A message's own facts, before its place in the tree is known. */
export type MessageFacts = Omit<ChatHistoryMessage, "branch" | "parentMessageId" | "turnIndex">;

/** What one export message is to a reader of the conversation. */
type MessageReading =
  | { readonly kind: "visible"; readonly facts: MessageFacts }
  /** Not part of the conversation the owner saw — a system turn, a tool call, hidden context, the model's working. */
  | { readonly kind: "withheld" }
  /** Would have been visible, but carries a role or kind this module does not know. */
  | { readonly kind: "unknown"; readonly contentType: string };

/** What a message said, before it is known to be worth keeping. */
interface Said {
  readonly text: string;
  readonly spoken: boolean;
  readonly attachments: number;
}

/**
 * An epoch-seconds instant as ISO, or undefined when the export recorded none.
 *
 * @returns the ISO instant, or undefined for a null or absent time
 */
export function isoOf({ seconds }: { seconds: number | null | undefined }): string | undefined {
  if (seconds === null || seconds === undefined) {
    return undefined;
  }
  return epochSecondsToIso({ seconds });
}

/** The words of a `text`/`multimodal_text` message, or the first part kind it does not know. */
function partWords({ parts }: { parts: readonly unknown[] }): Said | { readonly unknownPart: string } {
  const words: string[] = [];
  let spoken = false;
  let attachments = 0;
  let recorded = false;
  for (const part of parts) {
    const classified = classifyChatgptPart({ part });
    if (classified === undefined) {
      return { unknownPart: "(untyped part)" };
    }
    if (classified.kind === "words") {
      words.push(classified.text.trim());
      spoken = spoken || classified.spoken;
    } else if (classified.kind === "recording") {
      recorded = true;
    } else if (!ATTACHMENT_PARTS.has(classified.contentType)) {
      return { unknownPart: kindToken({ token: classified.contentType }) };
    } else {
      attachments += 1;
    }
  }
  const text = words.filter((word) => word.length > 0).join("\n\n");
  if (recorded && text.length === 0) {
    // A recording's words are the transcription beside it; with none, the owner said something this reader cannot carry,
    // so it is reported rather than read as an empty turn.
    return { unknownPart: "recording (no transcription)" };
  }
  return { attachments, spoken, text };
}

/**
 * The speaker of a message that may be part of what the owner saw, judged before its content is read — or the reading that
 * says why it is not.
 *
 * Its author role is read first, so a role this reader does not know is reported even on a hidden message. A withheld
 * message's recipient and content are never read, so a recipient or kind this reader does not know on a system, tool
 * or hidden message, on the assistant's call to a tool this reader knows, or inside a content kind this reader names
 * as the model's working ({@link WORKING_CONTENT}), is not reported: tool output alone
 * carries many kinds no reader keeps (browsing displays, quotes, errors), and naming each would fail a real export
 * over words the owner never saw as a turn.
 */
function framing({ message }: { message: ExportMessage }): MessageReading | { readonly role: ChatHistoryRole } {
  const role = message.author.role;
  const speaker = role === "user" || role === "assistant" ? role : undefined;
  if (speaker === undefined && !WITHHELD_ROLES.has(role)) {
    // A role this reader has never seen may be carrying words the owner saw, so it is reported, never quietly withheld —
    // hidden or not, since the flag is the shape's own claim.
    return { contentType: `role ${kindToken({ token: role })}`, kind: "unknown" };
  }
  if (speaker === undefined || message.metadata?.is_visually_hidden_from_conversation === true) {
    return { kind: "withheld" };
  }
  // Every recipient is read before content can withhold a message: one addressed anywhere but `all`, or a tool an
  // assistant calls, is a shape this reader has not seen, whatever kind its content is. A user turn calls no tool.
  const recipient = typeof message.recipient === "string" ? message.recipient : "all";
  const toTool = role === "assistant" && TOOL_RECIPIENTS.has(recipient);
  if (!toTool && recipient !== "all") {
    return { contentType: `recipient ${kindToken({ token: recipient })}`, kind: "unknown" };
  }
  if (toTool || WORKING_CONTENT.has(message.content.content_type)) {
    return { kind: "withheld" };
  }
  return { role: speaker };
}

/** What a user or assistant message said, or the reading that says why its content cannot be read. */
function contentSaid({ message }: { message: ExportMessage }): Said | MessageReading {
  const { content } = message;
  const contentType = content.content_type;
  const named = kindToken({ token: contentType });
  // A content carrying words in BOTH `text` and `parts` is a shape this reader has not seen: each kind reads one of
  // them, so whatever the other held would go unread behind a receipt.
  if (typeof content.text === "string" && content.parts !== undefined) {
    return { contentType: `${named} (text and parts)`, kind: "unknown" };
  }
  if (contentType === "code" && typeof content.text === "string") {
    // A code block written TO the owner (recipient `all`), carried as a fenced block so it reads as one.
    const language = typeof content.language === "string" ? content.language : "";
    return { attachments: 0, spoken: false, text: `\`\`\`${language}\n${content.text.trim()}\n\`\`\`` };
  }
  if (!PARTS_CONTENT.has(contentType)) {
    return { contentType: named, kind: "unknown" };
  }
  // A words kind with no `parts` at all is not an empty turn — the root's empty turn carries `[""]` — so it is a
  // shape this reader has not seen, and reported rather than counted as nothing said.
  if (content.parts === undefined) {
    return { contentType: `${named} part (no parts)`, kind: "unknown" };
  }
  const read = partWords({ parts: content.parts });
  if ("unknownPart" in read) {
    return { contentType: `${named} part ${read.unknownPart}`, kind: "unknown" };
  }
  if (read.text.length === 0 && read.attachments > 0) {
    // An image sent with no caption is still a turn the owner saw, so it is kept, its words saying what it was.
    return { ...read, text: `(${String(read.attachments)} image(s), no caption)` };
  }
  return read;
}

/**
 * What one message is to a reader of the conversation.
 *
 * @param message the export message
 * @returns its words when it is visible, else why it is not
 */
export function readExportMessage({ message }: { message: ExportMessage }): MessageReading {
  const framed = framing({ message });
  if ("kind" in framed) {
    return framed;
  }
  const said = contentSaid({ message });
  if ("kind" in said) {
    return said;
  }
  if (said.text.length === 0) {
    // An empty turn — the untimed root's `[""]`. Nothing was said; counted, not kept.
    return { kind: "withheld" };
  }
  const { role } = framed;
  const model = message.metadata?.model_slug;
  const spoken = said.spoken || message.metadata?.voice_mode_message === true;
  return {
    facts: {
      attachments: said.attachments,
      createdIso: isoOf({ seconds: message.create_time }),
      id: message.id,
      modality: spoken ? "voice" : "typed",
      model: role === "assistant" && typeof model === "string" ? model : undefined,
      role,
      text: said.text,
    },
    kind: "visible",
  };
}
