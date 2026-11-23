/**
 * The fake Graph server's `/me/messages` routes — the collection (a conversation filter, a draft create) and one
 * message's read, attachment, patch, move, reply and send — split out of `fakeGraphServer.ts`, which routes every
 * other path and the token endpoint. Every value is SYNTHETIC, as that file's header says.
 */
import type { ServerResponse } from "node:http";
import type { GraphMessage } from "../../../../live/outlook/graphWire.js";
import { nextChangeKey } from "../../../fakeOutlookMailbox.js";
import { parseOwnJson } from "../../../parseOwnJson.js";
import { ATTACHMENT, ATTACHMENT_TEXT, createDraft, createReplyDraft } from "./fakeGraphData.js";
import { graphError, json } from "./fakeGraphHttp.js";

/** The switches a message route reads — a subset of the server's options, so this file does not import them. */
interface MessageRouteOptions {
  readonly refuseThreadFilter: boolean;
  readonly failSend: boolean;
  readonly driftPatch: boolean;
}

/** One message's GET routes: the message itself, its attachment list, and the one attachment's bytes. */
function answerMessageGet({
  res,
  message,
  action,
  attachmentId,
  media,
}: {
  res: ServerResponse;
  message: GraphMessage;
  action: string | undefined;
  attachmentId: string | undefined;
  media: string | undefined;
}): void {
  const route = `${String(action)}/${String(attachmentId)}/${String(media)}`;
  if (route === "undefined/undefined/undefined") {
    json({ body: message, res, status: 200 });
    return;
  }
  if (route === "attachments/undefined/undefined") {
    json({ body: { value: [ATTACHMENT] }, res, status: 200 });
    return;
  }
  if (route === `attachments/${ATTACHMENT.id}/$value`) {
    res.writeHead(200, { "content-type": ATTACHMENT.contentType });
    res.end(ATTACHMENT_TEXT);
    return;
  }
  graphError({ code: "ErrorInvalidRequest", res, status: 400 });
}

/** One message's writes: patch, move, createReply and send. Graph documents the last two as taking no body. */
function answerMessageWrite({
  res,
  route,
  body,
  message,
  messages,
  options,
}: {
  res: ServerResponse;
  route: string;
  body: string;
  message: GraphMessage;
  messages: Map<string, GraphMessage>;
  options: MessageRouteOptions;
}): void {
  // The fake refuses a body on a parameterless action rather than ignoring it.
  if ((route === "POST createReply" || route === "POST send") && body !== "") {
    graphError({ code: "ErrorInvalidRequest", res, status: 400 });
    return;
  }
  switch (route) {
    case "POST createReply": {
      json({ body: createReplyDraft({ messages, parent: message }), res, status: 201 });
      return;
    }
    case "PATCH undefined": {
      const patch = parseOwnJson<Partial<GraphMessage>>({ text: body });
      const patched = { ...message, ...patch, changeKey: nextChangeKey({ changeKey: message.changeKey }) };
      messages.set(message.id, patched);
      json({ body: options.driftPatch ? { ...patched, undeclaredField: "synthetic" } : patched, res, status: 200 });
      return;
    }
    case "POST move": {
      const { destinationId } = parseOwnJson<{ destinationId: string }>({ text: body });
      const moved = { ...message, parentFolderId: destinationId === "archive" ? "folder-archive" : destinationId };
      messages.set(message.id, moved);
      json({ body: moved, res, status: 201 });
      return;
    }
    case "POST send": {
      answerSend({ message, messages, options, res });
      return;
    }
    default: {
      graphError({ code: "ErrorInvalidRequest", res, status: 400 });
    }
  }
}

/** A draft's `/send`: a 500 that sends nothing when the test asked for one, else the draft moves to Sent Items. */
function answerSend({
  res,
  message,
  messages,
  options,
}: {
  res: ServerResponse;
  message: GraphMessage;
  messages: Map<string, GraphMessage>;
  options: MessageRouteOptions;
}): void {
  if (options.failSend) {
    graphError({ code: "ErrorInternalServerError", res, status: 500 });
    return;
  }
  messages.set(message.id, { ...message, isDraft: false, parentFolderId: "folder-sent" });
  res.writeHead(202);
  res.end();
}

/**
 * The collection itself — a `conversationId` filter, or a draft create — and, below it, one message's routes.
 *
 * @param method the HTTP method the CLI sent
 * @param rest the path segments after `/v1.0/me/messages`
 * @param query the request's query string
 * @param body the request body, as text
 * @param messages the mailbox state, mutated by a write
 * @param options which of Graph's refusals this mailbox exhibits
 */
export function answerMessages({
  res,
  method,
  rest,
  query,
  body,
  messages,
  options,
}: {
  res: ServerResponse;
  method: string;
  rest: readonly string[];
  query: URLSearchParams;
  body: string;
  messages: Map<string, GraphMessage>;
  options: MessageRouteOptions;
}): void {
  if (rest.length === 0 && method === "GET") {
    if (options.refuseThreadFilter) {
      graphError({ code: "InefficientFilter", res, status: 400 });
      return;
    }
    const { $filter: filter = "" } = Object.fromEntries(query);
    const conversation = /conversationId eq '([^']+)'/u.exec(filter);
    const wanted = conversation === null ? "" : conversation[1];
    json({ body: { value: [...messages.values()].filter((m) => m.conversationId === wanted) }, res, status: 200 });
    return;
  }
  if (rest.length === 0 && method === "POST") {
    json({ body: createDraft({ body, messages }), res, status: 201 });
    return;
  }
  const [id, action, attachmentId, media] = rest;
  const message = id === undefined ? undefined : messages.get(decodeURIComponent(id));
  if (message === undefined) {
    graphError({ code: "ErrorItemNotFound", res, status: 404 });
    return;
  }
  if (method === "GET") {
    answerMessageGet({ action, attachmentId, media, message, res });
    return;
  }
  answerMessageWrite({ body, message, messages, options, res, route: `${method} ${String(action)}` });
}
