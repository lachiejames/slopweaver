/**
 * `gmail draft --board <slug> --expect <digest>` — the form comes off a board row's recorded MAIL action
 * rather than off the caller, and only while that action is still the one the owner previewed.
 *
 * ## Why the verb reads the row itself
 *
 * The console's press passes two tokens, a slug and a digest, and never the mail. A press that carried the
 * form would let the page — or anything that can POST to it — draft a message nobody recorded; reading the
 * row here means the only mail this path can draft is one a visible session recorded with `handover ask
 * --action` or `handover offer`, and `--expect` means it is the one the owner read (`../../../handover/mailActionPreview.ts`).
 *
 * ## One press, one draft
 *
 * A draft is created in the owner's mailbox, so pressing twice would leave two identical drafts for them to find and
 * delete. A receipt per `(slug, digest)` under `$home/live/gmail/board-drafts/` makes the second press a
 * refusal naming the draft the first one made. A changed mail digests differently and drafts afresh.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { MAIL_ACTION_VERSION, type MailAskAction } from "../../../handover/askAction.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { mailActionDigest } from "../../../handover/mailActionPreview.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { stateHomePaths } from "../../../stateHome.js";

/** Every way a board row's mail cannot become a draft; `code` is what a test or caller branches on. */
export type GmailBoardDraftError =
  | { readonly code: "JOURNAL_UNREADABLE"; readonly message: string }
  | { readonly code: "NOT_WAITING"; readonly message: string }
  | { readonly code: "NO_MAIL_ACTION"; readonly message: string }
  | { readonly code: "DIGEST_MOVED"; readonly message: string; readonly current: string }
  | { readonly code: "ALREADY_DRAFTED"; readonly message: string; readonly draftId: string }
  | { readonly code: "SENDER_MISMATCH"; readonly message: string }
  | { readonly code: "RECEIPT_UNWRITTEN"; readonly message: string }
  | { readonly code: "IN_FLIGHT"; readonly message: string; readonly pid: number }
  | { readonly code: "CLAIM_UNWRITTEN"; readonly message: string }
  | { readonly code: "CLAIM_ABANDONED"; readonly message: string; readonly path: string };

/** The one place each {@link GmailBoardDraftError} is worded. */
export const GmailBoardDraftErrors = {
  alreadyDrafted: ({
    slug,
    digest,
    draftId,
  }: {
    slug: string;
    digest: string;
    draftId: string;
  }): GmailBoardDraftError => ({
    code: "ALREADY_DRAFTED",
    draftId,
    message: `${slug}'s mail ${digest} was already drafted as ${draftId} — it is in your Gmail drafts, so nothing new was stored`,
  }),
  claimAbandoned: ({ slug, pid, path }: { slug: string; pid: number; path: string }): GmailBoardDraftError => ({
    code: "CLAIM_ABANDONED",
    message:
      `an earlier press of ${slug}'s mail (process ${String(pid)}) ended without a receipt — it died, or Gmail failed in a ` +
      `way that may still have stored the draft. Look in Gmail's drafts first; only if it is not there, remove ${path} and press again`,
    path,
  }),
  claimUnwritten: ({ cause }: { cause: string }): GmailBoardDraftError => ({
    code: "CLAIM_UNWRITTEN",
    message: `could not claim this mail for drafting, so nothing was stored: ${cause}`,
  }),
  digestMoved: ({
    slug,
    current,
    expect,
  }: {
    slug: string;
    current: string;
    expect: string;
  }): GmailBoardDraftError => ({
    code: "DIGEST_MOVED",
    current,
    message:
      `${slug}'s mail is now ${current}, not the ${expect} that was previewed — it changed after the preview ` +
      "was drawn, so reload the preview and read it again before drafting",
  }),
  inFlight: ({ slug, digest, pid }: { slug: string; digest: string; pid: number }): GmailBoardDraftError => ({
    code: "IN_FLIGHT",
    message: `${slug}'s mail ${digest} is being drafted right now by process ${String(pid)} — one press makes one draft, so this one stored nothing`,
    pid,
  }),
  journalUnreadable: ({ slug, cause }: { slug: string; cause: string }): GmailBoardDraftError => ({
    code: "JOURNAL_UNREADABLE",
    message: `cannot read ${slug}'s run journal: ${cause}`,
  }),
  noMailAction: ({ slug }: { slug: string }): GmailBoardDraftError => ({
    code: "NO_MAIL_ACTION",
    message: `${slug}'s open ask offers no mail action — there is nothing recorded to draft`,
  }),
  notWaiting: ({ slug, state }: { slug: string; state: string }): GmailBoardDraftError => ({
    code: "NOT_WAITING",
    message: `${slug} is not waiting on the owner (${state}), so it offers no mail to draft`,
  }),
  receiptUnwritten: ({ cause }: { cause: string }): GmailBoardDraftError => ({
    code: "RECEIPT_UNWRITTEN",
    message: `the draft exists, but its receipt was not written, so a second press would duplicate it: ${cause}`,
  }),
  senderMismatch: ({ recorded, bound }: { recorded: string; bound: string }): GmailBoardDraftError => ({
    code: "SENDER_MISMATCH",
    message:
      `the previewed mail is from ${recorded}, but the bound Gmail account is ${bound} — ` +
      "a draft from a different sender is not the mail that was read, so nothing was stored",
  }),
} as const;

/** A board row's mail, checked and ready to plan: the form as JSON, and what the receipt is keyed on. */
export interface BoardDraftSource {
  readonly slug: string;
  readonly digest: string;
  readonly action: MailAskAction;
  readonly formJson: string;
}

/**
 * The mail action a board row's open ask offers, checked against the digest the press carried.
 *
 * @param home the Slopweaver home whose `runs/` holds the row's journal
 * @param slug the board row
 * @param expect the digest the preview printed; a mismatch means the row now holds a different mail
 * @returns the action, or why it cannot be drafted
 */
export function boardMailAction({
  home,
  slug,
  expect,
}: {
  home: string;
  slug: string;
  expect: string;
}): Result<MailAskAction, GmailBoardDraftError> {
  const journal = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug });
  if (journal.isErr()) {
    return err(GmailBoardDraftErrors.journalUnreadable({ cause: journal.error.message, slug }));
  }
  const run = runDisposition({ events: journal.value.events, unreadableLines: journal.value.unreadable });
  if (run.kind !== "waiting-on-owner") {
    return err(GmailBoardDraftErrors.notWaiting({ slug, state: run.kind }));
  }
  if (run.action === undefined || run.action.version !== MAIL_ACTION_VERSION) {
    return err(GmailBoardDraftErrors.noMailAction({ slug }));
  }
  const current = mailActionDigest({ action: run.action, slug });
  if (current !== expect) {
    return err(GmailBoardDraftErrors.digestMoved({ current, expect, slug }));
  }
  return ok(run.action);
}

/**
 * The row's mail as a draft source, refused HERE when an earlier press already drafted this exact mail, so
 * a second press never reaches the mailbox.
 *
 * @param home the Slopweaver home
 * @param slug the board row
 * @param expect the digest the press carried
 * @returns the source to plan, or why there is none
 */
export function boardDraftSource({
  home,
  slug,
  expect,
}: {
  home: string;
  slug: string;
  expect: string;
}): Result<BoardDraftSource, GmailBoardDraftError> {
  const action = boardMailAction({ expect, home, slug });
  if (action.isErr()) {
    return err(action.error);
  }
  const earlier = draftedBefore({ digest: expect, home, slug });
  if (earlier !== undefined) {
    return err(GmailBoardDraftErrors.alreadyDrafted({ digest: expect, draftId: earlier, slug }));
  }
  return ok({ action: action.value, digest: expect, formJson: JSON.stringify(action.value.form), slug });
}

/**
 * Whether the mailbox the grant is bound to is the sender the row recorded — a draft from anyone else is
 * not the mail the owner read.
 *
 * @param recorded the sender on the row's mail action
 * @param bound the address the Gmail grant belongs to
 * @returns the refusal, or `undefined` when they are the same address
 */
export function boardSenderMismatch({
  recorded,
  bound,
}: {
  recorded: string;
  bound: string;
}): GmailBoardDraftError | undefined {
  if (recorded.toLowerCase() === bound.toLowerCase()) {
    return undefined;
  }
  return GmailBoardDraftErrors.senderMismatch({ bound, recorded });
}

/**
 * The directory holding every board draft's receipt, and the claim a press in flight holds.
 *
 * @returns `$home/live/gmail/board-drafts`
 */
export function boardDraftsDir({ home }: { home: string }): string {
  return stateHomePaths({ home }).live.gmail.boardDrafts;
}

/** Where the receipt of one row's drafted mail lives. */
function receiptPath({ home, slug, digest }: { home: string; slug: string; digest: string }): string {
  return join(boardDraftsDir({ home }), `${slug}.${digest}.json`);
}

/**
 * The draft an earlier press already made from this exact mail, if one did.
 *
 * @param home the Slopweaver home
 * @param slug the board row
 * @param digest the mail's digest
 * @returns the draft id the earlier press recorded, or `undefined` when none has
 */
export function draftedBefore({
  home,
  slug,
  digest,
}: {
  home: string;
  slug: string;
  digest: string;
}): string | undefined {
  const path = receiptPath({ digest, home, slug });
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed === "object" && parsed !== null && "draftId" in parsed && typeof parsed.draftId === "string") {
    return parsed.draftId;
  }
  return "(a receipt that does not name its draft)";
}

/**
 * Record that this exact mail became a draft, so a second press is refused rather than duplicating it.
 *
 * @param home the Slopweaver home
 * @param slug the board row
 * @param digest the mail's digest
 * @param draftId the draft Gmail created
 * @param atIso when it was created
 * @returns the receipt's path, or why it could not be written
 */
export function recordDrafted({
  home,
  slug,
  digest,
  draftId,
  atIso,
}: {
  home: string;
  slug: string;
  digest: string;
  draftId: string;
  atIso: string;
}): Result<string, GmailBoardDraftError> {
  const path = receiptPath({ digest, home, slug });
  const written = safeFs({
    execute: () => {
      writeFileAtomic({ contents: `${JSON.stringify({ atIso, digest, draftId, slug })}\n`, path });
    },
    operation: "gmail.draft.board-receipt",
    path,
  });
  if (written.isErr()) {
    return err(GmailBoardDraftErrors.receiptUnwritten({ cause: written.error.message }));
  }
  return ok(path);
}
