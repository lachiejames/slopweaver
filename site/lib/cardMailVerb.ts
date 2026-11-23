/**
 * The read an inbox-triage card takes to draw the mail it asks about: `gmail card-mail <slug> --json` for the headers
 * of every pinned message, and `--message <id>` for the one body the owner opens, which shows a message someone has already sent. Both read the copy stored beside the card's pin, from this machine alone — never
 * Gmail live, and never `--fetch`, which is the one mode of that verb that reaches Gmail.
 *
 * Same door as `./mailThreadVerb.ts`: a literal argv, and each slot checked against the exact shape it takes before it
 * becomes an argv element — never a flag, never a path.
 */

/** The prefix every inbox-triage card's slug carries — the only cards that pin mail. */
const TRIAGE_SLUG_PREFIX = "inbox-triage-";

/** The longest slug the verb accepts as a file name (`gmail triage`'s own bound). */
const MAX_SLUG = 120;

/** What may follow the prefix: lower-case letters, digits and hyphens. */
const SLUG_TAIL = /^[a-z0-9-]+$/;

/** A Gmail message id: sixteen lower-case hex digits. */
const MAIL_ID_SHAPE = /^[0-9a-f]{16}$/;

/**
 * One local file read and one parse — no network. Generous because the console's own polls share the machine, and
 * a stored body may be half a megabyte of HTML to sanitise.
 */
export const CARD_MAIL_TIMEOUT_MS = 20_000;

/**
 * Whether a board slug names an inbox-triage card — the cards whose mail is stored beside their pin.
 *
 * @returns true for `inbox-triage-` followed by lower-case letters, digits and hyphens, within the length bound
 */
export function isInboxTriageSlug({ slug }: { slug: string }): boolean {
  return (
    slug.length <= MAX_SLUG &&
    slug.startsWith(TRIAGE_SLUG_PREFIX) &&
    SLUG_TAIL.test(slug.slice(TRIAGE_SLUG_PREFIX.length))
  );
}

/** What building the argv came to. */
export type CardMailArgv =
  | { readonly kind: "argv"; readonly argv: readonly string[]; readonly title: string }
  | { readonly kind: "refused"; readonly why: string };

/** What one `gmail card-mail` run came to, before the route stamps it. */
export type CardMailRead =
  { readonly ok: true; readonly read: unknown } | { readonly ok: false; readonly notMeasured: string };

/** The verb's own "nothing to show" exit (`src/cli/exitCodes.ts`'s `EXIT_EXPECTED_EMPTY`). */
const EXIT_EXPECTED_EMPTY = 3;

/**
 * Read one run's outcome: what it printed on exit 0, and on exit 3 the document it printed when it printed one — the
 * `pinned: false` answer for a card that pinned nothing, which is an answer rather than a failed read. An exit 3 that
 * printed nothing (a pinned card with no stored copy) stays not measured, with the verb's own reason.
 *
 * @param ran the spawned verb's outcome, its exit code and stdout kept on the failure arm
 * @param title the verb line, for the reason a document that is not JSON names
 * @returns the parsed document, or the one reason there is none
 */
export function cardMailReadOf({
  ran,
  title,
}: {
  ran:
    | { readonly ok: true; readonly out: string }
    | { readonly ok: false; readonly exitCode: number | undefined; readonly out: string; readonly notMeasured: string };
  title: string;
}): CardMailRead {
  if (!ran.ok && (ran.exitCode !== EXIT_EXPECTED_EMPTY || ran.out.trim() === "")) {
    return { notMeasured: ran.notMeasured, ok: false };
  }
  try {
    const read: unknown = JSON.parse(ran.out);
    return { ok: true, read };
  } catch {
    return { notMeasured: `${title} printed something that is not JSON`, ok: false };
  }
}

/**
 * The `gmail card-mail` argv for one card, and for one of its messages when `message` is given, or the refusal.
 *
 * @param slug the card's board slug off the request
 * @param message the Gmail id of the one message whose body to read, `null` — as the request's search params answer
 *   an absent one — for the headers of all of them
 * @returns the literal argv, or why a slot was refused
 */
export function cardMailArgv({ slug, message }: { slug: string; message: string | null }): CardMailArgv {
  if (!isInboxTriageSlug({ slug })) {
    return { kind: "refused", why: "the slug is not an inbox-triage card's" };
  }
  if (message !== null && !MAIL_ID_SHAPE.test(message)) {
    return { kind: "refused", why: "the message id is not a Gmail id (sixteen hex digits)" };
  }
  const argv = ["gmail", "card-mail", slug, ...(message === null ? [] : ["--message", message]), "--json"];
  return { argv, kind: "argv", title: `slopweaver ${argv.join(" ")}` };
}
