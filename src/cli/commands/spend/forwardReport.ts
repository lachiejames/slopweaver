/**
 * What `spend forward` says about each card expense, and the exit it ends on. Pure: `./forwardRun.ts` decides the
 * outcomes and hands them here to print.
 */
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { AIRWALLEX_RECEIPTS_ADDRESS } from "../../../spend/tasks/invoiceMatch.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";

/** What happened to one card expense. */
export type ForwardOutcome =
  | { readonly kind: "drafted"; readonly draftId: string; readonly link: string | undefined }
  | { readonly kind: "already-drafted"; readonly draftId: string; readonly link: string | undefined }
  | { readonly kind: "would-draft"; readonly receipt: string; readonly files: number }
  | { readonly kind: "nothing-to-forward"; readonly why: string }
  | { readonly kind: "failed"; readonly why: string };

/** One expense and its outcome, as a line and the JSON report print it. */
export interface ForwardLine {
  readonly expense: string;
  readonly outcome: ForwardOutcome;
}

/**
 * The Gmail address of a draft, by its MESSAGE id — the drafts view opens it for editing.
 *
 * @param messageId the draft's message id, as Gmail returned it
 * @returns the link, or undefined when Gmail returned no message id
 */
export function draftLink({ messageId }: { messageId: string | undefined }): string | undefined {
  if (messageId === undefined) {
    return undefined;
  }
  return `https://mail.google.com/mail/u/0/#drafts?compose=${messageId}`;
}

/** A draft's link with its leading space, or nothing when Gmail returned no message id. */
function linkSuffix({ link }: { link: string | undefined }): string {
  if (link === undefined) {
    return "";
  }
  return ` ${link}`;
}

/** One line of the text report. */
function renderLine({ line }: { line: ForwardLine }): string {
  const { outcome } = line;
  if (outcome.kind === "drafted") {
    return (
      `- ${line.expense}: forward drafted to ${AIRWALLEX_RECEIPTS_ADDRESS} — draft ${outcome.draftId}` +
      `${linkSuffix({ link: outcome.link })} — NOT sent: they press Send`
    );
  }
  if (outcome.kind === "already-drafted") {
    return (
      `- ${line.expense}: drafted by an earlier run — draft ${outcome.draftId}${linkSuffix({ link: outcome.link })} ` +
      "(not re-checked: sent or deleted since reads the same)"
    );
  }
  if (outcome.kind === "would-draft") {
    return (
      `- ${line.expense}: would draft a forward of ${outcome.receipt} with ${String(outcome.files)} file(s) to ` +
      `${AIRWALLEX_RECEIPTS_ADDRESS} (dry run: nothing stored)`
    );
  }
  if (outcome.kind === "nothing-to-forward") {
    return `- ${line.expense}: nothing to forward — ${outcome.why}`;
  }
  return `- ${line.expense}: NOT drafted — ${outcome.why}`;
}

/**
 * The report, as text or as one JSON document.
 *
 * @param account the mailbox the reminder was read from
 * @param json whether to print one JSON document instead of text
 * @param lines every expense's outcome, in the reminder's order
 * @returns what to print
 */
export function renderForwardReport({
  account,
  json,
  lines,
}: {
  account: string;
  json: boolean;
  lines: readonly ForwardLine[];
}): string {
  if (json) {
    return safeJsonStringify({ label: "spend forward", space: 2, value: { account, lines } });
  }
  return [
    `spend forward: ${account} — drafts only, to ${AIRWALLEX_RECEIPTS_ADDRESS}; nothing is sent`,
    ...lines.map((line) => renderLine({ line })),
  ].join("\n");
}

/**
 * The exit a run ends on: 1 for any failure, 3 when no expense had a receipt to forward, else 0.
 *
 * @param lines every expense's outcome
 * @returns the exit code
 */
export function forwardExit({ lines }: { lines: readonly ForwardLine[] }): number {
  if (lines.some((line) => line.outcome.kind === "failed")) {
    return EXIT_ERROR;
  }
  if (lines.every((line) => line.outcome.kind === "nothing-to-forward")) {
    return EXIT_EXPECTED_EMPTY;
  }
  return EXIT_OK;
}
