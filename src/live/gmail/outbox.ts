/**
 * The outbound half of the mailbox: composing a draft, and sending one. Split into PLAN and APPLY for the
 * same structural reason `modify.ts` is — the door wraps a thunk, so the thing being admitted has to be the
 * one call that changes the world and nothing else.
 *
 * ## Why the approval digest is computed HERE, at send time, and never at draft time
 *
 * The obvious design prints a digest when the draft is composed and checks it when the draft is sent. It is
 * wrong, and the reason generalises. A digest computed from the form the caller supplied is a digest of what
 * this process BELIEVES it composed; a digest computed from the draft Gmail hands back is a digest of what
 * will actually be delivered. Those differ whenever the MIME round trip is lossy — an encoded-word that
 * decodes differently, a folded address list that re-joins differently, a body whose transfer encoding does
 * not restore byte-for-byte — and every one of those would surface as a mismatch a reviewer could not act
 * on, or worse, as an approval of text nobody read.
 *
 * So there is exactly ONE digest code path: read the draft back, shape it, hash it. `gmail draft` prints no
 * digest at all. `gmail send` prints the draft as Gmail holds it, with its digest, and refuses; the second
 * invocation carries that digest and is admitted. What a reviewer approves is what the mail server has.
 *
 * ## `Bcc` is read here rather than added to `ParsedGmailMessage`
 *
 * A blind recipient is precisely what someone approving a send needs to see, so the send preview reads the
 * `Bcc` header directly. It is deliberately not added to {@link ./parse.ParsedGmailMessage}, which is the
 * shape the READ verbs report: `list` and `read` describe received mail, where `Bcc` has already been
 * stripped by the sending server and is therefore always absent. Widening the read shape to carry a field
 * that is structurally empty on every message it describes would be a worse lie than the omission.
 *
 * Effectful only through the injected {@link GmailApi}, so both halves are unit tested with plain fakes.
 */
import { stripQuotedTail } from "../../corpus/gmail/quoted.js";
import { err, ok, type Result } from "../../lib/result.js";
import { redundantOpeningQuote } from "../../outbound/voice/redundantOpeningQuote.js";
import type { GmailApi, GmailDraft } from "./api.js";
import {
  approvalDigest,
  buildMimeMessage,
  composeBodyProblems,
  type GmailComposeForm,
  type GmailReplyContext,
  toRawBase64Url,
  validateComposeForm,
} from "./compose.js";
import { type GmailError, GmailErrors } from "./errors.js";
import { messageLabelIds } from "./omittedFields.js";
import { getHeader, type ParsedGmailMessage, parseGmailMessage, splitAddresses } from "./parse.js";

/** A composed message, encoded and ready to store, but not yet stored. */
export interface GmailDraftPlan {
  readonly account: string;
  readonly from: string;
  readonly form: GmailComposeForm;
  /** The parent's threading headers, when this was composed as a reply. */
  readonly reply: GmailReplyContext | undefined;
  /** The complete RFC 5322 message, for a preview that shows the actual bytes. */
  readonly message: string;
  /** The same message, base64url-encoded the way the API's `raw` field takes it. */
  readonly raw: string;
}

/** A stored draft, and how to reach it next. */
export interface GmailDraftOutcome {
  readonly plan: GmailDraftPlan;
  readonly draftId: string;
  readonly threadId: string | undefined;
  readonly residue: readonly string[];
}

/** A draft read back from the mailbox, digested, and awaiting approval. */
export interface GmailSendPlan {
  readonly account: string;
  readonly draftId: string;
  readonly threadId: string;
  /** The message as Gmail holds it — this is what would be delivered, not what a caller believes it wrote. */
  readonly from: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  /** Undefined when the draft carries no `Subject` header at all, which is not the same as an empty one. */
  readonly subject: string | undefined;
  readonly body: string;
  /** The digest an `--approve` must match, over exactly the fields above. */
  readonly digest: string;
  readonly residue: readonly string[];
}

/** A sent message, and what the mailbox reported back. */
export interface GmailSendOutcome {
  readonly plan: GmailSendPlan;
  readonly messageId: string;
  readonly threadId: string;
  readonly labelIds: readonly string[];
  readonly residue: readonly string[];
}

/**
 * Prefix a subject for a reply without stacking a second `Re:` on one that already has it.
 *
 * A parent carrying no `Subject` header yields no subject either, rather than a bare `Re:`. Replying to a
 * subjectless message with a subject line reading only `Re:` would be this code inventing a header the
 * conversation never had.
 */
function replySubject({ parent }: { parent: string | undefined }): string {
  if (parent === undefined) {
    return "";
  }
  const base = parent.trim();
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

/**
 * A subject as Gmail compares it when deciding whether a draft joins a thread: reply and forward prefixes,
 * case and runs of whitespace do not count.
 */
function threadSubject({ subject }: { subject: string }): string {
  return subject
    .trim()
    .replace(/^((re|fwd?)\s*:\s*)+/iu, "")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

/**
 * Read the parent message and lift the headers a reply needs to land in the same conversation.
 *
 * A reply that carries `threadId` but not `In-Reply-To`/`References` shows up in the thread in Gmail's own
 * interface and as a detached message in every client that threads by header — which is most of them.
 * Setting all three is what makes the reply a reply everywhere rather than only here.
 *
 * It also returns what the parent's sender AUTHORED — the body with its quoted history and signature
 * stripped — because that is the source a reply's opening quote is judged against.
 */
async function readReplyContext({
  api,
  parentId,
}: {
  api: GmailApi;
  parentId: string;
}): Promise<
  Result<{ reply: GmailReplyContext; parentSubject: string | undefined; parentAuthored: string }, GmailError>
> {
  const fetched = await api.getMessage({ format: "full", id: parentId });
  if (fetched.isErr()) {
    return err(fetched.error);
  }
  const headers = fetched.value.payload?.headers;
  const messageId = getHeader({ headers, name: "Message-ID" });
  if (messageId === undefined) {
    return err(
      GmailErrors.invalidAddress({
        message: `message ${parentId} carries no Message-ID header, so a reply to it cannot be threaded`,
      }),
    );
  }
  const priorReferences = splitReferences({ header: getHeader({ headers, name: "References" }) });
  const threadId = fetched.value.threadId;
  if (typeof threadId !== "string") {
    return err(GmailErrors.invalidAddress({ message: `message ${parentId} carries no thread id` }));
  }
  const parsed = parseGmailMessage({ message: fetched.value });
  if (parsed === undefined) {
    return err(
      GmailErrors.invalidAddress({
        message: `message ${parentId} came back without a message id, so its text cannot be read to check the reply`,
      }),
    );
  }
  return ok({
    parentAuthored: stripQuotedTail({ body: parsed.body }).text,
    parentSubject: getHeader({ headers, name: "Subject" }),
    reply: { inReplyTo: messageId, references: [...priorReferences, messageId], threadId },
  });
}

/** Split a `References` header, which is whitespace-separated message ids rather than a comma list. */
function splitReferences({ header }: { header: string | undefined }): readonly string[] {
  return header === undefined ? [] : header.split(/\s+/).filter((item) => item.length > 0);
}

/**
 * Compose a message into the bytes a draft is made of, resolving reply threading when one was asked for.
 * Reads the parent when replying; stores nothing.
 *
 * The form's `to` is used exactly as given and is never inferred from the parent, even on a reply. Guessing
 * a recipient is the one mistake this surface must not make quietly, and "reply to whoever sent it" is a
 * guess — the sender of the parent is often a list, an alias, or a person who should not receive the answer.
 *
 * The form is validated again here, before the parent is read, so the plan every stored draft is made from
 * holds to {@link validateComposeForm} whoever called it — a body hard-wrapped inside a paragraph included.
 *
 * A reply whose body OPENS by quoting back the whole of what the parent said is refused before anything is
 * encoded: the quote picks nothing out, so the reply should open on its answer
 * (`../../outbound/voice/redundantOpeningQuote.ts`). `allowRedundantQuote` is the `redundant-quote` hatch,
 * resolved at the effectful edge.
 *
 * @param api the injected Gmail seam
 * @param account the mailbox the grant bound to
 * @param form the compose form, refused here unless it passes {@link validateComposeForm}
 * @param replyToId the message id being replied to, when this is a reply
 * @param allowRedundantQuote whether the `redundant-quote` hatch is open for this invocation; absent is closed
 * @returns the encoded plan, or the typed reason it could not be composed
 */
export async function planGmailDraft({
  api,
  account,
  form,
  replyToId,
  allowRedundantQuote,
}: {
  api: GmailApi;
  account: string;
  form: GmailComposeForm;
  replyToId?: string | undefined;
  allowRedundantQuote?: boolean;
}): Promise<Result<GmailDraftPlan, GmailError>> {
  const validated = validateComposeForm({ form });
  if (validated.isErr()) {
    return err(GmailErrors.composeFormRefused({ problems: validated.error }));
  }
  let reply: GmailReplyContext | undefined;
  let subject = form.subject;
  if (replyToId !== undefined) {
    const context = await readReplyContext({ api, parentId: replyToId });
    if (context.isErr()) {
      return err(context.error);
    }
    const quote = redundantOpeningQuote({ draft: form.body, source: context.value.parentAuthored });
    if (quote !== undefined && allowRedundantQuote !== true) {
      return err(GmailErrors.redundantOpeningQuote({ quote }));
    }
    // A parent with no Subject header threads only with an empty subject, so any named one is a mismatch there,
    // a bare "Re:" included.
    const { parentSubject } = context.value;
    const mismatched =
      parentSubject === undefined || threadSubject({ subject }) !== threadSubject({ subject: parentSubject });
    if (subject.length > 0 && mismatched) {
      return err(GmailErrors.replySubjectMismatch({ parentSubject, subject }));
    }
    reply = context.value.reply;
    subject = subject.length > 0 ? subject : replySubject({ parent: context.value.parentSubject });
  }
  const resolved: GmailComposeForm = { ...form, subject };
  const message = buildMimeMessage({ form: resolved, from: account, reply });
  return ok({
    account,
    form: resolved,
    from: account,
    message,
    raw: toRawBase64Url({ message }),
    reply,
  });
}

/**
 * Store a planned message as a draft. Writes to the owner's own Drafts and delivers nothing.
 *
 * A plan is refused unless its body passes {@link composeBodyProblems} and its `raw` is exactly what its form
 * builds, so a plan assembled anywhere but {@link planGmailDraft} cannot store a body the form refuses. Only
 * the body is judged here: a reply's subject was resolved from its parent after the form was validated.
 *
 * A reply Gmail stored outside its parent's thread is refused as `REPLY_DETACHED`, naming the draft that now
 * exists, rather than reported as a reply.
 *
 * @param api the injected Gmail seam
 * @param plan the encoded plan, as {@link planGmailDraft} made it
 * @param once make exactly one attempt, never retrying a lost response — a board draft's one-draft-per-press promise
 * @returns the stored draft's identity, or the typed reason it could not be stored
 */
export async function applyGmailDraft({
  api,
  plan,
  once = false,
}: {
  api: GmailApi;
  plan: GmailDraftPlan;
  once?: boolean;
}): Promise<Result<GmailDraftOutcome, GmailError>> {
  const bodyProblems = composeBodyProblems({ body: plan.form.body });
  if (bodyProblems.length > 0) {
    return err(GmailErrors.composeFormRefused({ problems: bodyProblems }));
  }
  const rebuilt = toRawBase64Url({
    message: buildMimeMessage({ form: plan.form, from: plan.from, reply: plan.reply }),
  });
  if (rebuilt !== plan.raw) {
    return err(
      GmailErrors.composeFormRefused({ problems: ["raw: the plan's message is not the one its form builds"] }),
    );
  }
  const created = await api.createDraft({
    once,
    raw: plan.raw,
    ...(plan.reply !== undefined ? { threadId: plan.reply.threadId } : {}),
  });
  if (created.isErr()) {
    return err(created.error);
  }
  const reported = created.value.message.threadId;
  const threadId = typeof reported === "string" ? reported : undefined;
  // Gmail decides the thread itself, so a reply is only a reply once the stored draft reads back in it.
  if (plan.reply !== undefined && threadId !== plan.reply.threadId) {
    return err(GmailErrors.replyDetached({ draftId: created.value.id, expected: plan.reply.threadId, threadId }));
  }
  return ok({
    draftId: created.value.id,
    plan,
    residue: [
      "nothing has been sent — this is a draft in your own mailbox",
      "it is ready in Gmail with its recipients and body: review or edit it there and press Send",
      `or send it through the door with: slopweaver gmail send ${created.value.id}`,
    ],
    threadId,
  });
}

/** The residue every send plan carries — what the preview does not and cannot establish. */
function sendResidue({ readAtDescription }: { readAtDescription: string }): readonly string[] {
  return [
    `this is the draft as Gmail held it ${readAtDescription} — editing it invalidates the digest`,
    "recipient addresses are checked for shape only; whether a mailbox exists is the receiving server's answer",
    "the approval digest binds content, it does not authenticate a person — see src/outbound/gmail/approvalGate.ts",
  ];
}

/**
 * Who a draft will be sent as. A draft holding no `From:` header is sent by Gmail from the authenticated
 * mailbox itself, so the digest and the preview name that mailbox rather than no sender at all.
 */
function draftSender({ parsed, account }: { parsed: ParsedGmailMessage; account: string }): string {
  const { from } = parsed;
  if (from === undefined) {
    return account;
  }
  return from;
}

/** Shape one read-back draft into the fields the digest and the preview are both built from. */
function shapeDraft({ draft, account }: { draft: GmailDraft; account: string }): Result<GmailSendPlan, GmailError> {
  const parsed = parseGmailMessage({ message: draft.message });
  if (parsed === undefined) {
    return err(
      GmailErrors.invalidAddress({
        message: `draft ${draft.id} holds no addressable message — it may be empty, or already sent`,
      }),
    );
  }
  const headers = draft.message.payload?.headers;
  const from = draftSender({ account, parsed });
  const bcc = splitAddresses({ header: getHeader({ headers, name: "Bcc" }) });
  return ok({
    account,
    bcc,
    body: parsed.body,
    cc: parsed.cc,
    digest: approvalDigest({ bcc, body: parsed.body, cc: parsed.cc, from, subject: parsed.subject, to: parsed.to }),
    draftId: draft.id,
    from,
    residue: sendResidue({ readAtDescription: "when this plan was made" }),
    subject: parsed.subject,
    threadId: parsed.threadId,
    to: parsed.to,
  });
}

/**
 * Read a draft back from the mailbox and digest exactly what would be delivered. Sends nothing.
 *
 * @param api the injected Gmail seam
 * @param account the mailbox the grant bound to
 * @param draftId the draft to prepare
 * @returns the plan and its approval digest, or the typed reason the draft could not be prepared
 */
export async function planGmailSend({
  api,
  account,
  draftId,
}: {
  api: GmailApi;
  account: string;
  draftId: string;
}): Promise<Result<GmailSendPlan, GmailError>> {
  const fetched = await api.getDraft({ id: draftId });
  if (fetched.isErr()) {
    return err(fetched.error);
  }
  return shapeDraft({ account, draft: fetched.value });
}

/**
 * SEND a prepared draft. The one call in this module that puts something in front of another person, and
 * the only one the door holds by default.
 *
 * It is never retried — see {@link ./api.GmailApi.sendDraft}. A caller that sees this fail should read the
 * thread before trying again, because a lost response and a rejected send look identical from here.
 *
 * @param api the injected Gmail seam
 * @param plan the approved plan
 * @returns what the mailbox reported about the sent message, or the typed reason it did not send
 */
export async function applyGmailSend({
  api,
  plan,
}: {
  api: GmailApi;
  plan: GmailSendPlan;
}): Promise<Result<GmailSendOutcome, GmailError>> {
  const sent = await api.sendDraft({ id: plan.draftId });
  if (sent.isErr()) {
    return err(sent.error);
  }
  const messageId = sent.value.id;
  const threadId = sent.value.threadId;
  return ok({
    labelIds: messageLabelIds({ message: sent.value }),
    messageId: typeof messageId === "string" ? messageId : "(no id)",
    plan,
    residue: [
      "delivery is the receiving server's to confirm — an accepted send is not a delivered mail",
      "this cannot be undone from here; Gmail's own undo window is in its interface, not its API",
    ],
    threadId: typeof threadId === "string" ? threadId : plan.threadId,
  });
}
