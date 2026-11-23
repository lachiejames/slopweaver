/**
 * The Slack CANVAS write calls — minting a standalone canvas, minting a channel's own canvas, replacing
 * one's contents, and deleting one. Split out of `./writeApi.ts` for the same reason `./writeApiPoll.ts`
 * and `./writeApiConversations.ts` are: that file is already over `file-size-ratchet`'s 800-code-line cap.
 * These are wired into the SAME {@link SlackWriteTransport} it builds, follow its exact
 * `safeProviderCall`/`orThrow`/`scopeId` pattern, and carry no policy of their own.
 *
 * ## Two create endpoints, and why both are here rather than one behind a flag
 *
 * `canvases.create` mints a STANDALONE canvas — a document that belongs to the authoring identity and is
 * shared by granting access. `conversations.canvases.create` mints THE canvas of a channel — a channel has
 * at most one, it is pinned to the channel's tab, and everyone in the channel can already see it. Those are
 * different objects with different lifetimes and different sharing rules, so a single method taking an
 * optional `channel` would hide the one decision the author actually has to make. `writeTransport.ts`'s own
 * header states the rule this follows: a seam holds no decisions.
 *
 * ## What the scopes measured on this install actually allow
 *
 * MEASURED, `slopweaver slack probe --method auth.test --scopes` (and `--bot`): BOTH tokens hold
 * `canvases:write` and `canvases:read`, so unlike channel creation the canvas lane is reachable as the bot
 * and as the owner. Which identity a canvas should be authored under is the caller's call, not this file's.
 */
import type { WebClient } from "@slack/web-api";

import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import { redactPii } from "../../outbound/slack/piiRedaction.js";
import { optStr } from "./shape.js";

/**
 * The `document_content` every canvas write sends, with the body through the outbound PII pass.
 *
 * The one place a canvas body becomes wire bytes, so every write crosses it: both creates and the replace,
 * on either lane, from any producer. The redaction sits at the post, the one place an
 * audience appears, and a channel canvas is readable by the whole channel the moment it exists. Emails and IP
 * addresses become `[email]` and `[ip]`, exactly as on a card (`../../outbound/slack/piiRedaction.ts`).
 *
 * @param markdown the canvas body as the author wrote it
 * @returns the document content Slack's canvas endpoints take, its markdown redacted
 */
export function canvasDocumentContent({ markdown }: { markdown: string }): { markdown: string; type: "markdown" } {
  return { markdown: redactPii({ text: markdown }).text, type: "markdown" };
}

/**
 * A canvas title as both creates send it, through the same PII pass as {@link canvasDocumentContent}.
 *
 * The title is a second string Slack shows everyone who can open the canvas, so a body-only pass would leave
 * it unmasked. A replace sends no title, so only the two creates call this.
 *
 * @param title the canvas title as the author wrote it
 * @returns the title with every email and IP address replaced
 */
export function canvasWireTitle({ title }: { title: string }): string {
  return redactPii({ text: title }).text;
}

/**
 * `canvases.create` — mint a STANDALONE canvas.
 *
 * AT-MOST-ONCE (`retryMode: "never"`), for the reason `conversations.create` is: a retried create after a
 * lost response mints a second real document, and a canvas nobody asked for is not something a later run
 * can identify and clean up — Slack gives it no natural key at all.
 *
 * @param client the NON-RETRYING write client
 * @param title the canvas title
 * @param markdown the canvas body, in Slack's own canvas-flavoured markdown
 * @param scopeId the shared-429-block key for this token
 * @returns the new canvas's id
 */
export async function canvasCreateCall({
  client,
  title,
  markdown,
  scopeId,
}: {
  client: WebClient;
  title: string;
  markdown: string;
  scopeId: string;
}): Promise<string> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.canvases.create({
          document_content: canvasDocumentContent({ markdown }),
          title: canvasWireTitle({ title }),
        }),
      operation: "slack.canvases.create",
      provider: "slack",
      retryMode: "never",
      scopeId,
    }),
  });
  const id = optStr({ value: res.canvas_id });
  if (id === undefined) {
    throw new Error("slack.canvases.create returned no canvas_id");
  }
  return id;
}

/**
 * `conversations.canvases.create` — mint a canvas attached to a conversation.
 *
 * AT-MOST-ONCE, and here that posture is LOAD-BEARING rather than cautious. MEASURED against the
 * live workspace: calling this twice for the same conversation answered `ok: true` both times with two
 * DIFFERENT ids (`F0SYN000001`, then `F0SYN000002`), each independently deletable. There is no
 * `channel_canvas_already_exists` refusal on this surface and no idempotence to lean on — a repeat simply
 * mints a second document. So a retry here is a real duplicate in a real conversation, exactly as a retried
 * `chat.postMessage` is a double post, and `retryMode: "never"` plus the non-retrying client is what
 * prevents it. The caller's own duplicate gate is the second layer.
 *
 * Reproduce: `conversations.canvases.create channel_id=<id> title=a`, twice, and compare the two `canvas_id`
 * values.
 *
 * @param client the NON-RETRYING write client
 * @param channel the channel whose canvas to mint
 * @param title the canvas title
 * @param markdown the canvas body, in Slack's own canvas-flavoured markdown
 * @param scopeId the shared-429-block key for this token
 * @returns the new canvas's id
 */
export async function channelCanvasCreateCall({
  client,
  channel,
  title,
  markdown,
  scopeId,
}: {
  client: WebClient;
  channel: string;
  title: string;
  markdown: string;
  scopeId: string;
}): Promise<string> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.conversations.canvases.create({
          channel_id: channel,
          document_content: canvasDocumentContent({ markdown }),
          title: canvasWireTitle({ title }),
        }),
      operation: "slack.conversations.canvases.create",
      provider: "slack",
      retryMode: "never",
      scopeId,
    }),
  });
  const id = canvasIdOf({ result: res });
  if (id === undefined) {
    throw new Error("slack.conversations.canvases.create returned no canvas_id");
  }
  return id;
}

/**
 * The canvas id off a create result, tolerating both places Slack has put it.
 *
 * `conversations.canvases.create` answers with a top-level `canvas_id`, and the SDK types that method's
 * return as the bare `WebAPICallResult` with no such field — so the result is widened to `unknown` and
 * narrowed structurally, no cast, exactly as `uploadedFileId` does for `files.uploadV2`. The nested
 * `canvas.id` arm is tolerated for the same reason that function tolerates two nesting depths: neither
 * shape is documented as the only one.
 *
 * @param result the raw create result
 * @returns the canvas id, or undefined when neither shape yields one
 */
export function canvasIdOf({ result }: { result: unknown }): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }
  const direct = optStr({ value: result["canvas_id"] });
  if (direct !== undefined) {
    return direct;
  }
  const nested = result["canvas"];
  return isRecord(nested) ? optStr({ value: nested["id"] }) : undefined;
}

/**
 * `canvases.edit` with a single `replace` change — set a canvas's whole body.
 *
 * WHOLE-BODY replace rather than a section operation, and that is the contract this exposes rather than a
 * simplification of it. Slack's section operations key on a `section_id` a caller can only get from
 * `canvases.sections.lookup`, so a partial edit is a two-call sequence whose first call this seam would
 * have to hold state across — which is a decision, and decisions do not live here. Replacing is idempotent:
 * the same markdown twice leaves the same document, so it retries as `transient`.
 *
 * @param client the repeatable-call write client
 * @param canvasId the canvas to rewrite
 * @param markdown the complete new body
 * @param scopeId the shared-429-block key for this token
 * @returns nothing
 */
export async function canvasReplaceCall({
  client,
  canvasId,
  markdown,
  scopeId,
}: {
  client: WebClient;
  canvasId: string;
  markdown: string;
  scopeId: string;
}): Promise<void> {
  orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.canvases.edit({
          canvas_id: canvasId,
          changes: [{ document_content: canvasDocumentContent({ markdown }), operation: "replace" }],
        }),
      operation: "slack.canvases.edit",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
}

/**
 * `canvases.delete` — remove a canvas.
 *
 * Here for the reason `conversationsArchiveCall` is: the integration cassette mints a real canvas in a real
 * workspace on every re-record, and without a retraction the recording lane litters the workspace one
 * document per lap. `canvas_not_found` is the desired end state and is absorbed as success, the same
 * reading `deleteMessage` gives "already gone".
 *
 * @param client the repeatable-call write client
 * @param canvasId the canvas to remove
 * @param scopeId the shared-429-block key for this token
 * @returns true once the canvas is gone, including when it already was
 */
export async function canvasDeleteCall({
  client,
  canvasId,
  scopeId,
}: {
  client: WebClient;
  canvasId: string;
  scopeId: string;
}): Promise<boolean> {
  const result = await safeProviderCall({
    execute: () => client.canvases.delete({ canvas_id: canvasId }),
    operation: "slack.canvases.delete",
    provider: "slack",
    retryMode: "transient",
    scopeId,
  });
  if (result.isOk()) {
    return true;
  }
  return result.error.message.includes("canvas_not_found");
}
