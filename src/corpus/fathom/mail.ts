/**
 * Fathom's own mail — who sends it, so the inbox triage can hold it out and `fathom discover` can find it.
 *
 * The owner wants nothing to do with Fathom recap emails: meeting data comes in through the Fathom
 * integration, never the mail. So a Fathom mail is never a triage group, and the one verb that reads it is the
 * integration's (`fathom discover`, `fathom clear-inbox`). A leaf, so `live/gmail/triage.ts` can import it without
 * loading the fathom command.
 */

/** The sender every Fathom share and recap mail comes from, lower-cased. */
const FATHOM_MAIL_SENDER = "no-reply@fathom.video";

/** The Gmail search that finds Fathom's mail. */
export const FATHOM_MAIL_QUERY = `from:${FATHOM_MAIL_SENDER}`;

/**
 * Whether a `From` address is Fathom's. It names a sender and authenticates none: what bounds a forged one is that
 * `fathom clear-inbox` archives a mail only when every share link it carries is already held. Pure.
 *
 * @param address the `From` address, any case
 * @returns true for Fathom's own sender
 */
export function isFathomMailSender({ address }: { address: string }): boolean {
  return address.toLowerCase() === FATHOM_MAIL_SENDER;
}
