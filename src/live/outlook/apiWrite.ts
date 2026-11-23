/**
 * The Outlook seam's writes: absolute-state patches (`transient` — a replay lands the same state) and the
 * creating or moving acts (`never` — a replay after an ambiguous answer would act twice). Every write, patches
 * included, reads a 2xx Graph answered in an undeclared shape as WRITE_OUTCOME_UNKNOWN, never as a write that
 * did not happen. Nothing here is reached except through a door-routed verb. The shared rules are in `apiCore.ts`.
 */
import { safeProviderCall } from "#lib/providerCall.js";
import { err, ok } from "#lib/result.js";
import {
  checkedWrite,
  type OutlookApi,
  PREFER_IMMUTABLE,
  PREFER_READ,
  PROVIDER,
  segment,
  writeFailure,
} from "./apiCore.js";
import { type GraphClient, TEXT_RESPONSE } from "./client.js";
import { OutlookErrors } from "./errors.js";
import { rethrowGraph } from "./graphThrow.js";
import { MESSAGE } from "./graphWire.js";

/** Where a create whose outcome is unknown would have landed. */
const CHECK_DRAFTS = "your Drafts folder";

/** Where a move whose outcome is unknown would have taken the message. */
const CHECK_MOVE = "the destination folder";

/** Where a send whose outcome is unknown would have landed. */
const CHECK_SENT = "your Sent Items folder";

/** Where a read flag or category change whose outcome is unknown shows. */
const CHECK_PATCHED = "the message in Outlook";

/**
 * The body of a parameterless action: none at all. Graph's `send` reference says no body is necessary and
 * `createReply`'s says it needs none, and both pages' JavaScript samples call `.post()` with nothing
 * (learn.microsoft.com/graph/api/message-send, …/message-createreply). The SDK's `serializeContent` turns
 * `undefined` into no body, and `fetch` sends a bodiless POST with `Content-Length: 0`, which `send` requires.
 */
const NO_BODY = undefined;

/** The write methods {@link writeMethods} supplies. */
type WriteMethods = Pick<
  OutlookApi,
  "createDraft" | "createReply" | "moveMessage" | "patchDraft" | "patchMessage" | "sendDraft"
>;

/**
 * The write methods over one bound Graph client.
 *
 * @param graph the request-scoped client
 * @param scopeId the 429 block's scope for the bound mailbox
 * @returns those methods of {@link OutlookApi}
 */
// max-lines-exempt: one object literal of endpoint arms over one bound client, the same shape as `apiRead.ts`'s `readMethods`; each arm is one never-retried `safeProviderCall` and its answer check, kept beside the request it judges.
export function writeMethods({ graph, scopeId }: { graph: GraphClient; scopeId: string }): WriteMethods {
  return {
    createDraft: async ({ payload }) => {
      const result = await safeProviderCall({
        execute: (): Promise<unknown> =>
          graph
            .api("/me/messages")
            .header("Prefer", PREFER_READ)
            .post(payload)
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.drafts.create",
        provider: PROVIDER,
        retryMode: "never",
        scopeId,
      });
      if (result.isErr()) {
        return err(writeFailure({ check: CHECK_DRAFTS, error: result.error, operation: "outlook.drafts.create" }));
      }
      return checkedWrite({
        boundary: MESSAGE,
        check: CHECK_DRAFTS,
        operation: "outlook.drafts.create",
        value: result.value,
      });
    },
    createReply: async ({ replyTo }) => {
      const result = await safeProviderCall({
        execute: (): Promise<unknown> =>
          graph
            .api(`/me/messages/${segment({ id: replyTo })}/createReply`)
            .header("Prefer", PREFER_READ)
            .post(NO_BODY)
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.drafts.createReply",
        provider: PROVIDER,
        retryMode: "never",
        scopeId,
      });
      if (result.isErr()) {
        return err(writeFailure({ check: CHECK_DRAFTS, error: result.error, operation: "outlook.drafts.createReply" }));
      }
      return checkedWrite({
        boundary: MESSAGE,
        check: CHECK_DRAFTS,
        operation: "outlook.drafts.createReply",
        value: result.value,
      });
    },
    moveMessage: async ({ id, destinationId }) => {
      const result = await safeProviderCall({
        execute: (): Promise<unknown> =>
          graph
            .api(`/me/messages/${segment({ id })}/move`)
            .header("Prefer", PREFER_IMMUTABLE)
            .post({ destinationId })
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.messages.move",
        provider: PROVIDER,
        retryMode: "never",
        scopeId,
      });
      if (result.isErr()) {
        return err(writeFailure({ check: CHECK_MOVE, error: result.error, operation: "outlook.messages.move" }));
      }
      return checkedWrite({
        boundary: MESSAGE,
        check: CHECK_MOVE,
        operation: "outlook.messages.move",
        value: result.value,
      });
    },
    patchDraft: async ({ id, payload }) => {
      const result = await safeProviderCall({
        execute: (): Promise<unknown> =>
          graph
            .api(`/me/messages/${segment({ id })}`)
            .header("Prefer", PREFER_READ)
            .patch(payload)
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.drafts.patch",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        return err(writeFailure({ check: CHECK_DRAFTS, error: result.error, operation: "outlook.drafts.patch" }));
      }
      return checkedWrite({
        boundary: MESSAGE,
        check: CHECK_DRAFTS,
        operation: "outlook.drafts.patch",
        value: result.value,
      });
    },
    patchMessage: async ({ id, patch }) => {
      const result = await safeProviderCall({
        execute: (): Promise<unknown> =>
          graph
            .api(`/me/messages/${segment({ id })}`)
            .header("Prefer", PREFER_IMMUTABLE)
            .patch(patch)
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.messages.patch",
        provider: PROVIDER,
        retryMode: "transient",
        scopeId,
      });
      if (result.isErr()) {
        return err(writeFailure({ check: CHECK_PATCHED, error: result.error, operation: "outlook.messages.patch" }));
      }
      return checkedWrite({
        boundary: MESSAGE,
        check: CHECK_PATCHED,
        operation: "outlook.messages.patch",
        value: result.value,
      });
    },
    sendDraft: async ({ id }) => {
      const result = await safeProviderCall({
        execute: (): Promise<unknown> =>
          graph
            .api(`/me/messages/${segment({ id })}/send`)
            .header("Prefer", PREFER_IMMUTABLE)
            .responseType(TEXT_RESPONSE)
            .post(NO_BODY)
            .catch((error: unknown) => rethrowGraph({ error })),
        operation: "outlook.drafts.send",
        provider: PROVIDER,
        retryMode: "never",
        scopeId,
      });
      if (result.isErr()) {
        return err(writeFailure({ check: CHECK_SENT, error: result.error, operation: "outlook.drafts.send" }));
      }
      if (result.value !== "") {
        return err(
          OutlookErrors.writeOutcomeUnknown({
            check: CHECK_SENT,
            detail: "Graph answered with a body where it documents none",
            operation: "outlook.drafts.send",
          }),
        );
      }
      return ok(undefined);
    },
  };
}
