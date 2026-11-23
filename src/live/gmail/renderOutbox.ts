/**
 * Human rendering for the two outbound Gmail verbs — the draft that was stored, and the three faces of a
 * send: what would go, what the door refused, and what went.
 *
 * ## The send preview is the whole safety property, so it is laid out to be READ
 *
 * `AGENTS.md` rule 7 caps what appears above the fold on an outbound surface, and this is the one place in
 * the mail door where that pressure runs the other way: an approval preview a reader skims is an approval
 * that did not happen. The resolution is that the preview is short by CONSTRUCTION rather than by
 * truncation — recipients, subject and a bounded body excerpt, with the cut marked — so the whole of what
 * matters fits above the fold and nothing important is hidden behind a fold at all.
 *
 * Recipients are printed one field per line, never merged into a single "recipients" line. Someone checking
 * a send is checking exactly the distinction between a `To` and a `Cc` and a `Bcc`, and a renderer that
 * flattened them would destroy the reason for looking.
 *
 * Pure: no I/O, no clock.
 */
import { previewBody } from "./compose.js";
import type { GmailDraftOutcome, GmailDraftPlan, GmailSendOutcome, GmailSendPlan } from "./outbox.js";

/** One recipient field, or nothing at all when it is empty — an empty `Cc:` line is noise. */
function recipientLine({ label, entries }: { label: string; entries: readonly string[] }): readonly string[] {
  return entries.length === 0 ? [] : [`${label}: ${entries.join(", ")}`];
}

/** The recipient/subject block both send renderings lead with. */
function envelopeLines({ plan }: { plan: GmailSendPlan }): readonly string[] {
  return [
    `from: ${plan.from}`,
    ...recipientLine({ entries: plan.to, label: "to" }),
    ...recipientLine({ entries: plan.cc, label: "cc" }),
    ...recipientLine({ entries: plan.bcc, label: "bcc" }),
    `subject: ${subjectLine({ subject: plan.subject })}`,
  ];
}

/**
 * The subject, or a visible stand-in.
 *
 * The two stand-ins differ on purpose. A draft with NO `Subject` header and one with an empty subject are
 * different messages — they digest differently, so an approval of one will not admit the other — and a
 * reviewer comparing a preview against a digest mismatch needs the preview to have told them which it was.
 */
function subjectLine({ subject }: { subject: string | undefined }): string {
  if (subject === undefined) {
    return "(no subject header)";
  }
  return subject.length === 0 ? "(empty subject)" : subject;
}

/**
 * Render a composed draft that has not been stored yet, for `--dry-run`.
 *
 * @param plan the encoded, unstored plan
 * @returns the text block
 */
export function renderGmailDraftPlanText({ plan }: { plan: GmailDraftPlan }): string {
  return [
    `would draft as ${plan.from}`,
    ...recipientLine({ entries: plan.form.to, label: "to" }),
    ...recipientLine({ entries: plan.form.cc, label: "cc" }),
    ...recipientLine({ entries: plan.form.bcc, label: "bcc" }),
    `subject: ${plan.form.subject.length === 0 ? "(no subject)" : plan.form.subject}`,
    ...(plan.reply === undefined ? [] : [`in reply to: ${plan.reply.inReplyTo}`]),
    "",
    previewBody({ body: plan.form.body }),
    "",
    "DRY RUN — nothing was stored and nothing was sent.",
    "",
  ].join("\n");
}

/**
 * Render a stored draft: where it went, and the one command that would send it.
 *
 * @param outcome the stored draft
 * @returns the text block
 */
export function renderGmailDraftOutcomeText({ outcome }: { outcome: GmailDraftOutcome }): string {
  return [
    `drafted: ${outcome.draftId}  (${outcome.plan.account})`,
    ...(outcome.threadId === undefined ? [] : [`thread: ${outcome.threadId}`]),
    "residue:",
    ...outcome.residue.map((line) => `  - ${line}`),
    "",
  ].join("\n");
}

/**
 * Render the send preview — the message as Gmail holds it, and the digest that would approve it.
 *
 * This is what a person reads before deciding, so it prints the approval command ready to copy rather than
 * describing it. A gate whose correction has to be reconstructed by hand is a gate people route around.
 *
 * @param plan the read-back draft and its digest
 * @returns the text block
 */
export function renderGmailSendPlanText({ plan }: { plan: GmailSendPlan }): string {
  return [
    `would send draft ${plan.draftId}  (${plan.account})`,
    ...envelopeLines({ plan }),
    "",
    previewBody({ body: plan.body }),
    "",
    "residue:",
    ...plan.residue.map((line) => `  - ${line}`),
    "",
    "NOTHING HAS BEEN SENT. To send exactly this:",
    `  slopweaver gmail send ${plan.draftId} --approve ${plan.digest}`,
    "",
  ].join("\n");
}

/**
 * Render a sent message.
 *
 * @param outcome the send and what the mailbox reported
 * @returns the text block
 */
export function renderGmailSendOutcomeText({ outcome }: { outcome: GmailSendOutcome }): string {
  return [
    `SENT: ${outcome.messageId}  (${outcome.plan.account})`,
    ...envelopeLines({ plan: outcome.plan }),
    `thread: ${outcome.threadId}`,
    "residue:",
    ...outcome.residue.map((line) => `  - ${line}`),
    "",
  ].join("\n");
}
