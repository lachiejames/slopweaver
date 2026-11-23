/**
 * One message the owner sent an interactive Codex thread, as the `owner_capture` row it becomes. Pure: a history row and
 * its thread in, a row or a named refusal out.
 *
 * Codex keeps every thread item in `thread_history_1.sqlite`'s `thread_items`; a message they typed or said is the
 * `userMessage` item, whose `item_json` carries a `content` array of parts. MEASURED over the 713
 * interactive messages: every one has exactly one non-empty `text` part, and eleven also carry a `localImage` part.
 * So the one text part is the body, byte for byte, an attachment part is counted
 * and never read, and a message with no text part or with two is REFUSED rather than joined by a convention
 * nobody chose.
 *
 * Only an interactive thread's message is the owner's: the thread's `source` is `cli` or `vscode`. A `source = 'exec'`
 * thread is one of the fleet's own Codex passes, and the reader (`./codexMessageSource.ts`) never hands one here.
 */
import { parseJsonObject } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";
import type { NewOwnerCaptureRecord } from "../schema/ownerCapture.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";
import { captureBody, isJsonObject, stringField, unstorableTextReason } from "./ownerCapture.js";

/** The Codex surfaces whose threads the owner drives. */
export const CODEX_INTERACTIVE_SURFACES = ["cli", "vscode"] as const;

/** One of {@link CODEX_INTERACTIVE_SURFACES}. */
export type CodexInteractiveSurface = (typeof CODEX_INTERACTIVE_SURFACES)[number];

/** An interactive thread, as `state_5.sqlite`'s `threads` row names it. */
export interface CodexThreadInput {
  readonly id: string;
  readonly surface: CodexInteractiveSurface;
  /** Codex's `thread_source` (`user`, `voice_chat`, …), verbatim; null where Codex stored none. */
  readonly threadSource: string | null;
  readonly cwd: string;
}

/** One `userMessage` row of `thread_items`. */
export interface CodexMessageInput {
  readonly threadId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly createdAtMs: number;
  readonly itemJson: string;
}

/** A projected message, and how many attachment parts it carried that were not read. */
export interface ProjectedCodexMessage {
  readonly row: NewOwnerCaptureRecord;
  readonly attachmentParts: number;
}

/**
 * The text parts and the count of every other part of a message's content.
 *
 * @param content the item's `content` field
 * @returns the text of each `text` part and how many parts were something else, or `undefined` when `content` is
 *   not an array of objects
 */
function contentParts({ content }: { content: unknown }): { texts: string[]; others: number } | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const texts: string[] = [];
  let others = 0;
  for (const part of content) {
    if (!isJsonObject(part)) {
      return undefined;
    }
    const text = stringField({ key: "text", record: part });
    if (part["type"] === "text" && text !== undefined) {
      texts.push(text);
    } else {
      others += 1;
    }
  }
  return { others, texts };
}

/**
 * Why a message cannot be stored, judged before its body is read: a thread it is not in, an identity or thread
 * field the body's rule refuses, or a creation time that is not an instant.
 *
 * @param message the history row
 * @param thread the interactive thread it claims to belong to
 * @param identity the message's raw thread/turn/item ids, slash-joined, whose parts are stored beside the body
 * @returns the reason it is refused, or `undefined` when everything stored beside the body may be
 */
function preBodyRefusal({
  message,
  thread,
  identity,
}: {
  message: CodexMessageInput;
  thread: CodexThreadInput;
  identity: string;
}): string | undefined {
  if (message.threadId !== thread.id) {
    return `it is not in thread ${thread.id}`;
  }
  // Every string stored beside the body is held to the body's rule, so a refusal names this record.
  const stored = [
    { field: "id", text: identity },
    { field: "cwd", text: thread.cwd },
    { field: "thread_source", text: thread.threadSource },
  ];
  for (const { field, text } of stored) {
    const unstorable = text === null ? undefined : unstorableTextReason({ field, text });
    if (unstorable !== undefined) {
      return unstorable;
    }
  }
  if (!Number.isSafeInteger(message.createdAtMs) || message.createdAtMs <= 0) {
    return "its created_at_ms is not an instant";
  }
  return undefined;
}

/**
 * Project one message.
 *
 * @param message the history row
 * @param thread the interactive thread it belongs to
 * @param path the history database, named in a refusal with the message's identity
 * @returns the row and its unread attachment count, or the refusal
 */
export function projectCodexMessage({
  message,
  thread,
  path,
}: {
  message: CodexMessageInput;
  thread: CodexThreadInput;
  path: string;
}): Result<ProjectedCodexMessage, FleetImportError> {
  const idParts = [message.threadId, message.turnId, message.itemId];
  // The raw parts are what the refusal judges and names, so a NUL or a lone surrogate in one is refused by name.
  const identity = idParts.join("/");
  const where = `${path}#${identity}`;
  const refused = preBodyRefusal({ identity, message, thread });
  if (refused !== undefined) {
    return err(FleetImportErrors.unstorableOwnerCapture({ path: where, reason: refused }));
  }
  // Each part is percent-encoded so the `/` joining them can only ever be the separator: two distinct messages,
  // thread `a/b` turn `c` and thread `a` turn `b/c`, would otherwise share one id and the second be dropped by the
  // insert's conflict-do-nothing. A UUID, which every real Codex id is, encodes to itself. Encoding
  // follows the refusal, which has already ruled out the lone surrogate `encodeURIComponent` throws on.
  const sourceId = idParts.map((part) => encodeURIComponent(part)).join("/");
  const parsed = parseJsonObject({ text: message.itemJson });
  if (parsed.isErr() || parsed.value["type"] !== "userMessage") {
    return err(FleetImportErrors.unstorableOwnerCapture({ path: where, reason: "its item_json is not a userMessage" }));
  }
  const parts = contentParts({ content: parsed.value["content"] });
  if (parts === undefined) {
    return err(FleetImportErrors.unstorableOwnerCapture({ path: where, reason: "its content is not a list of parts" }));
  }
  if (parts.texts.length !== 1) {
    return err(
      FleetImportErrors.unstorableOwnerCapture({
        path: where,
        reason: `it has ${String(parts.texts.length)} text parts, and only exactly one is the owner's message as sent`,
      }),
    );
  }
  const body = captureBody({ body: parts.texts[0]!, path: where });
  if (body.isErr()) {
    return err(body.error);
  }
  return ok({
    attachmentParts: parts.others,
    row: {
      ...body.value,
      codexSurface: thread.surface,
      codexThreadSource: thread.threadSource,
      cwd: thread.cwd,
      saidAt: new Date(message.createdAtMs),
      source: "codex",
      sourceId,
      threadId: thread.id,
    },
  });
}
