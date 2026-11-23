/**
 * Outlook drafts and sending: the shared compose form turned into a Graph draft, and a send planned from the
 * draft AS OUTLOOK HOLDS IT.
 *
 * ## The form is the shared mail form, judged by the shared rules
 *
 * `outlook draft --form` takes exactly the JSON `gmail draft` does (`outbound/mail/form.ts`) and holds it to
 * the same validation — a plausible address per recipient, at least one `to`, no line break in the subject,
 * no hard wrap inside a body paragraph. A form one door accepts, the other accepts.
 *
 * ## The digest is computed over what Outlook holds, never over what was submitted
 *
 * A draft can be edited in Outlook between `draft` and `send`. So `send` reads the draft back, and the digest
 * an approval must match covers the sender, every recipient, the subject and the body of THAT read. Editing
 * the draft afterwards changes the digest and the old approval stops matching — the property the shared
 * approval gate (`outbound/mail/approvalGate.ts`) exists for.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { MailComposeForm } from "../../outbound/mail/form.js";
import { approvalDigest, isPlausibleAddress, validateComposeForm } from "../gmail/compose.js";
import type { DraftPayload, OutlookApi, WireRecipient } from "./apiCore.js";
import { type OutlookError, OutlookErrors } from "./errors.js";
import type { GraphMessage } from "./graphWire.js";
import { formatOutlookAddress, type OutlookAddress, type OutlookMessage, toMessage } from "./messages.js";

/** A draft that was stored. */
export interface OutlookDraftOutcome {
  readonly draftId: string;
  readonly conversationId: string;
  readonly isReply: boolean;
}

/** Everything `send` shows, and the digest an approval must match. */
export interface OutlookSendPlan {
  readonly draftId: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly subject: string | null;
  readonly body: string;
  readonly digest: string;
}

/**
 * One form recipient as Graph takes it: `Name <addr>` split into its halves, a bare address as itself.
 *
 * @param entry one recipient exactly as the form carried it, already validated
 * @returns the wire recipient
 */
export function toWireRecipient({ entry }: { entry: string }): WireRecipient {
  const trimmed = entry.trim();
  const open = trimmed.lastIndexOf("<");
  if (open === -1 || !trimmed.endsWith(">")) {
    return { emailAddress: { address: trimmed } };
  }
  const address = trimmed.slice(open + 1, -1).trim();
  const written = trimmed.slice(0, open).trim();
  const quoted = written.length >= 2 && written.startsWith('"') && written.endsWith('"');
  const name = quoted ? written.slice(1, -1) : written;
  return name.length === 0 ? { emailAddress: { address } } : { emailAddress: { address, name } };
}

/**
 * Validate a parsed form and build the Graph draft fields from it.
 *
 * @param form the parsed compose form
 * @returns the payload, or every problem the shared validation found
 */
export function draftPayload({ form }: { form: MailComposeForm }): Result<DraftPayload, OutlookError> {
  const validated = validateComposeForm({ form });
  if (validated.isErr()) {
    return err(OutlookErrors.draftRefused({ message: validated.error.join("\n") }));
  }
  const recipients = ({ entries }: { entries: readonly string[] }): readonly WireRecipient[] =>
    entries.map((entry) => toWireRecipient({ entry }));
  return ok({
    bccRecipients: recipients({ entries: form.bcc }),
    body: { content: form.body, contentType: "text" },
    ccRecipients: recipients({ entries: form.cc }),
    subject: form.subject,
    toRecipients: recipients({ entries: form.to }),
  });
}

/**
 * A draft Graph answered, as the outcome the verb prints. Only the two ids are read, because the draft is
 * already stored by now: an answer missing some other field must not read as a failure that invites drafting
 * it twice. One missing its conversation still names the stored draft, so it is found rather than redrafted.
 */
function outcomeOf({
  message,
  isReply,
}: {
  message: GraphMessage;
  isReply: boolean;
}): Result<OutlookDraftOutcome, OutlookError> {
  if (message.conversationId == null) {
    return err(
      OutlookErrors.draftRefused({
        message:
          `Outlook stored draft ${message.id} but its answer named no conversation; ` +
          "it is in Drafts, so edit or send that one rather than drafting again",
      }),
    );
  }
  return ok({ conversationId: message.conversationId, draftId: message.id, isReply });
}

/**
 * Store a draft: a new one in Drafts, or a reply in the parent's conversation whose fields are then set to the
 * form's. A reply is two writes, and a failure after the first leaves a reply draft Outlook created; the error
 * names it so it is found rather than drafted twice.
 *
 * @param payload the validated draft fields
 * @param replyTo the message being replied to, or undefined for a new draft
 * @returns the stored draft, or why it was not stored
 */
export async function storeOutlookDraft({
  api,
  payload,
  replyTo,
}: {
  api: OutlookApi;
  payload: DraftPayload;
  replyTo: string | undefined;
}): Promise<Result<OutlookDraftOutcome, OutlookError>> {
  if (replyTo === undefined) {
    const created = await api.createDraft({ payload });
    if (created.isErr()) {
      return err(created.error);
    }
    return outcomeOf({ isReply: false, message: created.value });
  }
  const reply = await api.createReply({ replyTo });
  if (reply.isErr()) {
    return err(reply.error);
  }
  const patched = await api.patchDraft({ id: reply.value.id, payload });
  if (patched.isErr()) {
    return err(
      OutlookErrors.draftRefused({
        message:
          `Outlook created reply draft ${reply.value.id} but did not take its fields (${patched.error.message}); ` +
          "edit or delete that draft in Outlook rather than drafting the reply again",
      }),
    );
  }
  return outcomeOf({ isReply: true, message: patched.value });
}

/**
 * Whether an address can be shown as who a send goes from or to: present, and of the shape a compose form's
 * recipient is held to. A blank or invisible-character "address" is no address a reviewer could check.
 */
function isShowable({ address }: { address: OutlookAddress }): boolean {
  return address.address !== null && isPlausibleAddress({ address: address.address });
}

/**
 * Plan a send from the draft Outlook holds now: refuse a message that is not a draft, and compute the digest.
 *
 * The sender approved is the draft's own `from` as Graph answered it, because that is who Outlook sends as —
 * an alias or a changed sender included. Only a draft carrying none is sent from the mailbox itself, so only
 * then does the bound account stand in, exactly as `gmail send` does for a draft with no `From:` header. A
 * sender or a recipient Graph names with no address is refused rather than previewed as one nobody could check.
 *
 * The body is Graph's text view of the draft, which cannot show every edit to an HTML one, so the digest also
 * carries `changeKey`, Graph's version stamp: any change to the stored draft voids an approval of the old one.
 *
 * @param draft the draft as read back from Graph
 * @param account the bound mailbox, the sender named only when the draft carries none
 * @param changeKey Graph's version stamp for that same read of the draft
 * @returns the plan, or why this message cannot be sent
 */
export function planOutlookSend({
  draft,
  account,
  changeKey,
}: {
  draft: OutlookMessage;
  account: string;
  changeKey: string;
}): Result<OutlookSendPlan, OutlookError> {
  if (!draft.isDraft) {
    return err(OutlookErrors.draftRefused({ message: `${draft.id} is not a draft — only a draft can be sent` }));
  }
  if (draft.from !== null && !isShowable({ address: draft.from })) {
    return err(
      OutlookErrors.draftRefused({
        message: `draft ${draft.id} names a sender with no usable address, so who it would be sent as cannot be shown`,
      }),
    );
  }
  if (draft.from === null && !isPlausibleAddress({ address: account })) {
    return err(
      OutlookErrors.draftRefused({
        message: `draft ${draft.id} names no sender and the connected mailbox has no usable address, so who it would be sent as cannot be shown — run \`slopweaver outlook connect\` again`,
      }),
    );
  }
  if ([...draft.to, ...draft.cc, ...draft.bcc].some((recipient) => !isShowable({ address: recipient }))) {
    return err(
      OutlookErrors.draftRefused({
        message: `draft ${draft.id} names a recipient with no usable address, so who it would reach cannot be shown`,
      }),
    );
  }
  const from = draft.from === null ? account : formatOutlookAddress({ address: draft.from });
  const to = draft.to.map((address) => formatOutlookAddress({ address }));
  const cc = draft.cc.map((address) => formatOutlookAddress({ address }));
  const bcc = draft.bcc.map((address) => formatOutlookAddress({ address }));
  if (to.length + cc.length + bcc.length === 0) {
    return err(OutlookErrors.draftRefused({ message: `draft ${draft.id} has no recipients` }));
  }
  // The digest is Gmail's, which spells "no subject" as `undefined`, so a null subject crosses as that.
  let subject: string | undefined;
  if (draft.subject !== null) {
    subject = draft.subject;
  }
  return ok({
    bcc,
    body: draft.body,
    cc,
    digest: approvalDigest({ bcc, body: draft.body, cc, from, subject, to, version: changeKey }),
    draftId: draft.id,
    from,
    subject: draft.subject,
    to,
  });
}

/**
 * Read a draft back and plan its send.
 *
 * @param id the draft's id
 * @param account the bound mailbox, the sender named only when the draft carries none
 * @returns the plan, or why it cannot be sent
 */
export async function readOutlookSendPlan({
  api,
  id,
  account,
}: {
  api: OutlookApi;
  id: string;
  account: string;
}): Promise<Result<OutlookSendPlan, OutlookError>> {
  const read = await api.getDraft({ id });
  if (read.isErr()) {
    return err(read.error);
  }
  const draft = toMessage({ message: read.value, operation: "outlook.drafts.get" });
  if (draft.isErr()) {
    return err(draft.error);
  }
  const { changeKey } = read.value;
  // A stamp with no letter or digit is no stamp — "", spaces or an invisible character alike: two reads both
  // answering one would digest alike whatever changed between them. Graph's changeKey is base64.
  if (changeKey == null || !/[\p{L}\p{N}]/u.test(changeKey)) {
    return err(OutlookErrors.responseFieldMissing({ field: "changeKey", operation: "outlook.drafts.get" }));
  }
  return planOutlookSend({ account, changeKey, draft: draft.value });
}
