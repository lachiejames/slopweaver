/**
 * The by-id read a draft card takes when it opens: the conversation the draft lands in, read LIVE through the
 * door by `slack draft context` (never a browser, never the corpus snapshot, because the
 * point is what the room says NOW).
 *
 * Same door as `./threadVerb.ts`: a literal argv, one slot, and the slot checked against the exact shape
 * `slack draft` mints before it becomes an argv element — never a flag, never a path.
 */

/** A draft id exactly as `slack draft record` mints one. */
const DRAFT_ID_SHAPE = /^sd-[0-9a-f]{8}$/;

/**
 * One `auth.test` and either a thread's replies or one history page, plus a member-bronze read. MEASURED
 * on `sd-8386bfdd`'s channel tail: 4.26s wall (`/usr/bin/time -p slopweaver slack draft context
 * sd-8386bfdd --json`). The cap matches `THREAD_TIMEOUT_MS` because this read shares the machine with the page's
 * own polls exactly as that one does, and a long thread pages.
 */
export const DRAFT_CONTEXT_TIMEOUT_MS = 45_000;

/** What building the argv came to. */
export type DraftContextArgv =
  | { readonly kind: "argv"; readonly argv: readonly string[]; readonly title: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * The `slack draft context` argv for one draft, or the refusal.
 *
 * @param id the draft id off the request
 * @returns the literal argv, or why the id was refused
 */
export function draftContextArgv({ id }: { id: string }): DraftContextArgv {
  if (!DRAFT_ID_SHAPE.test(id)) {
    return { kind: "refused", why: "the draft id is not one `slack draft` mints (sd- and eight hex digits)" };
  }
  const argv = ["slack", "draft", "context", id, "--json"];
  return { argv, kind: "argv", title: `slopweaver ${argv.join(" ")}` };
}
