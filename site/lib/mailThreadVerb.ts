/**
 * The by-id read an email-born ask card takes when it opens: the mail thread it was born from, read LIVE through
 * the door by `gmail read <id> --thread` — so the card shows what was said and the draft the owner has in Gmail now, the
 * way a Slack-born ask shows the thread it replies in.
 *
 * Same door as `./draftContextVerb.ts`: a literal argv, one slot, and the slot checked against the exact shape a
 * Gmail id takes before it becomes an argv element — never a flag, never a path.
 */

/** A Gmail message or thread id: sixteen lower-case hex digits. */
const MAIL_ID_SHAPE = /^[0-9a-f]{16}$/;

/**
 * A `threads.get` at full format, plus a `messages.get` when the id names a message rather than its thread. MEASURED
 * on a real 12-message vendor thread, by message id: 3.99s wall (`/usr/bin/time -p slopweaver gmail
 * read <message-id> --thread --json`). The cap matches `DRAFT_CONTEXT_TIMEOUT_MS`, because this read shares the
 * machine with the page's own polls exactly as that one does, and a long thread is a large body.
 */
export const MAIL_THREAD_TIMEOUT_MS = 45_000;

/** What building the argv came to. */
export type MailThreadArgv =
  | { readonly kind: "argv"; readonly argv: readonly string[]; readonly title: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * The `gmail read --thread` argv for one id, or the refusal.
 *
 * @param id the message or thread id off the request
 * @returns the literal argv, or why the id was refused
 */
export function mailThreadArgv({ id }: { id: string }): MailThreadArgv {
  if (!MAIL_ID_SHAPE.test(id)) {
    return { kind: "refused", why: "the mail id is not a Gmail id (sixteen hex digits)" };
  }
  const argv = ["gmail", "read", id, "--thread", "--json"];
  return { argv, kind: "argv", title: `slopweaver ${argv.join(" ")}` };
}
