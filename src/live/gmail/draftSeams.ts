/**
 * The Gmail seam over `users.drafts`, split from `./api.ts` along its resource line — the one resource whose
 * retry policy is a correctness rule rather than a tuning choice, so it reads best on its own.
 */
import type { gmail_v1 } from "@googleapis/gmail";

import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { GmailApi, GmailDraft } from "./api.js";
import { type GmailError, GmailErrors } from "./errors.js";
import type { GmailMessage } from "./parse.js";

/** Every provider failure on this resource, as the one typed Gmail error the seam returns. */
function toGmailError({ error }: { error: IngestError }): GmailError {
  return GmailErrors.apiFailed({ cause: error, message: error.message });
}

/**
 * The message a Draft resource holds. A draft IS a message waiting to be sent — `drafts.create` stores the one
 * it was given and `drafts.get` answers with it — so a successful answer with no `message` is malformed and
 * refused with a typed error, never read as a message whose every field Gmail omitted. One that arrives as
 * anything but an object is refused with a different one, because the field came back rather than being left out.
 */
function draftMessage({
  draft,
  operation,
  subject,
}: {
  draft: gmail_v1.Schema$Draft;
  operation: string;
  subject: string;
}): Result<GmailMessage, GmailError> {
  const { message } = draft;
  if (message == null) {
    return err(GmailErrors.responseFieldMissing({ field: "message", operation, subject }));
  }
  if (!isRecord(message)) {
    return err(GmailErrors.responseFieldMalformed({ expected: "an object", field: "message", operation, subject }));
  }
  return ok(message);
}

/**
 * The id of a draft `drafts.get` fetched by `requested`.
 *
 * A SUCCESSFUL `drafts.get` for `requested` is that draft: Gmail answers an id it does not hold with a 404,
 * which `safeProviderCall` has already turned into a failure before this runs. So when the response does not
 * echo an id, the id it was fetched by is the proven identity of the draft it returned — an established
 * fact, not a guess. An id the response does echo is the one reported.
 */
function fetchedDraftId({ draft, requested }: { draft: gmail_v1.Schema$Draft; requested: string }): string {
  const returned = draft.id;
  if (returned == null) {
    return requested;
  }
  return returned;
}

/**
 * The seams over `users.drafts` — compose, re-read, and send.
 * See `./api.ts`'s `listSeam` for why the seam is built one builder per RESOURCE at all.
 *
 * ## `sendDraft` is the only call here that never retries, and that is a correctness rule
 *
 * Every other Gmail call in `./api.ts` is `retryMode: "transient"`, which is right for them: a read is free
 * to repeat, and `modify` is idempotent in Gmail's own model, so applying the same label sets twice lands
 * in the same state. `drafts.send` is neither. A retry after a response that was lost in flight would
 * deliver the same mail a second time to a real person, and no amount of care at the call site can undo
 * that. `never` is therefore not a tuning choice — it is the difference between a failed send a caller can
 * see and investigate, and a duplicate nobody asked for.
 *
 * `createDraft` and `getDraft` retry normally. Creating a duplicate draft costs a stray row in the owner's
 * own Drafts folder, which is a nuisance rather than a harm. A board draft (`gmail draft --board`) passes `once`, because it
 * promises one draft per press and holds a claim for exactly that — a retry would break the promise quietly.
 *
 * @param client the `@googleapis/gmail` surface from a resolved grant
 * @param scopeId the shared rate scope, already hashed from the bound account
 * @returns the drafting and sending part of the seam
 */
export function draftSeams({
  client,
  scopeId,
}: {
  client: gmail_v1.Gmail;
  scopeId: string;
}): Pick<GmailApi, "createDraft" | "getDraft" | "sendDraft"> {
  return {
    createDraft: async ({ raw, threadId, once = false }) =>
      safeProviderCall({
        execute: () =>
          client.users.drafts.create({
            requestBody: { message: { raw, ...(threadId !== undefined ? { threadId } : {}) } },
            userId: "me",
          }),
        operation: "gmail.users.drafts.create",
        provider: "gmail",
        retryMode: once ? "never" : "transient",
        scopeId,
      })
        .mapErr((error) => toGmailError({ error }))
        // A created draft with no id is a response this code cannot use — the id is the ONLY way back to it,
        // so an empty stand-in would hand the caller a draft it can never send and call that success.
        .andThen((response): Result<GmailDraft, GmailError> => {
          const { id } = response.data;
          if (typeof id !== "string") {
            return err(GmailErrors.apiFailed({ message: "Gmail stored a draft but returned no draft id" }));
          }
          return draftMessage({
            draft: response.data,
            operation: "gmail.users.drafts.create",
            subject: `draft ${id}`,
          }).map((message) => ({ id, message }));
        }),
    getDraft: async ({ id }) =>
      safeProviderCall({
        execute: () => client.users.drafts.get({ format: "full", id, userId: "me" }),
        operation: "gmail.users.drafts.get",
        provider: "gmail",
        retryMode: "transient",
        scopeId,
      })
        .mapErr((error) => toGmailError({ error }))
        .andThen((response): Result<GmailDraft, GmailError> =>
          draftMessage({ draft: response.data, operation: "gmail.users.drafts.get", subject: `draft ${id}` }).map(
            (message) => ({ id: fetchedDraftId({ draft: response.data, requested: id }), message }),
          ),
        ),
    sendDraft: async ({ id }) =>
      safeProviderCall({
        execute: () => client.users.drafts.send({ requestBody: { id }, userId: "me" }),
        operation: "gmail.users.drafts.send",
        provider: "gmail",
        retryMode: "never",
        scopeId,
      })
        .map((response): GmailMessage => response.data)
        .mapErr((error) => toGmailError({ error })),
  };
}
