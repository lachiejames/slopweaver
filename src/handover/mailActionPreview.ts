/**
 * The digest and the console address of a recorded MAIL action — the two things that tie the preview the
 * owner read to the draft a press creates.
 *
 * ## Why a digest rides the press
 *
 * The console shows a mail; pressing asks `gmail draft --board <slug> --expect <digest>` to turn the row's
 * CURRENT action into a Gmail draft. Between the render and the press a session may re-offer a different
 * mail on the same row, and a press naming only the slug would then draft a message the owner never read. The
 * digest covers the slug, the sender and every byte of the form, so the verb refuses a press whose preview
 * is no longer what the row holds — the same property `gmail send --approve` gives a send
 * (`../live/gmail/compose.ts`'s `approvalDigest`), for the same reason.
 *
 * It authenticates nobody: the process that prints it can compute it. What it buys is that an approval
 * cannot be transplanted onto different content.
 *
 * Pure: no filesystem, no clock.
 */
import { createHash } from "node:crypto";

import type { MailAskAction } from "./askAction.js";

/** How many hex characters of the SHA-256 a digest keeps — enough to never collide across one board. */
const DIGEST_WIDTH = 16;

/** Where the console serves, matching `../briefing/publishClaim.ts`'s own addresses. */
const CONSOLE_ORIGIN = "http://localhost:3000";

/** A digest as it may appear in a URL and on a command line. */
export const MAIL_DIGEST_PATTERN = /^[0-9a-f]{16}$/u;

/**
 * The digest of one row's mail action.
 *
 * A reply's target is covered only when there is one, so a new mail digests exactly as it did before replies
 * existed — a preview already drawn keeps its press — while the same words as a reply and as a new mail are two
 * different digests, being two different drafts.
 *
 * @param slug the board row the action is recorded on, so the same mail on two rows digests differently
 * @param action the recorded mail action
 * @returns the leading hex characters of the SHA-256 over the canonical content
 */
export function mailActionDigest({ slug, action }: { slug: string; action: MailAskAction }): string {
  const { bcc, body, cc, subject, to } = action.form;
  const reply = action.replyTo === undefined ? {} : { replyTo: action.replyTo.messageId };
  const canonical = JSON.stringify({ bcc, body, cc, from: action.from, ...reply, slug, subject, to });
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, DIGEST_WIDTH);
}

/** Where one row's mail preview is drawn, and the digest a press from it carries. */
export interface MailPreview {
  readonly digest: string;
  readonly url: string;
}

/**
 * The console address of one row's mail preview.
 *
 * @param slug the board row the action is recorded on
 * @param action the recorded mail action
 * @returns the digest and the page that draws exactly that mail
 */
export function mailPreviewOf({ slug, action }: { slug: string; action: MailAskAction }): MailPreview {
  const digest = mailActionDigest({ action, slug });
  return { digest, url: `${CONSOLE_ORIGIN}/queue/mail/${encodeURIComponent(slug)}/${digest}` };
}
