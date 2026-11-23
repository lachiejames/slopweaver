/**
 * What a sidebar click shows while it is under way, and what happens when it never lands — pure, so both rules are
 * unit tests.
 *
 * On a tab already open, a sidebar item can be a dead click, and on a fresh tab a click can show nothing for one to
 * three seconds before the page arrives. The cause is the origin's connection pool (`liveSlots.ts`), but "nothing
 * happens" is its own defect whatever the cause: a click is drawn as under way in the frame it lands, and a click whose
 * page has not arrived after {@link NAV_STALL_MS} loads it as a document instead — a stuck client router, a chunk a
 * redeploy deleted, a pool still full: whatever held it, the page asked for arrives. Every console route either is static and prefetched or commits `app/(console)/loading.tsx` at once, so a
 * click that has not moved the address in that long is stuck, not slow.
 *
 * Except during a voice call. A document load ends the call (`BuildStatus.tsx` never reloads the page for the same
 * reason), so a stalled click during one stays drawn as under way and says why, and loads the moment the call ends.
 */

/** How long a click may go without its page arriving before it is loaded as a document instead. */
export const NAV_STALL_MS = 4_000;

/** What a stalled-click check does now. */
export type NavStallAction =
  | { readonly kind: "wait"; readonly inMs: number }
  | { readonly kind: "load-document" }
  | { readonly kind: "held-by-call" };

/**
 * Whether a click on a link is one the client router takes: the primary button, no modifier. A modified click opens
 * a tab or a window, which this page does not wait for.
 *
 * @returns true for a plain click
 */
export function isPlainClick({
  button,
  metaKey,
  ctrlKey,
  shiftKey,
  altKey,
}: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return button === 0 && !metaKey && !ctrlKey && !shiftKey && !altKey;
}

/**
 * The path a sidebar address leads to, without its query: what the router's pathname reads once the page arrives.
 *
 * @param href the link's address, as `navHref` built it
 * @returns the path
 */
export function pathOfHref({ href }: { href: string }): string {
  const cut = href.search(/[?#]/u);
  if (cut === -1) {
    return href;
  }
  return href.slice(0, cut);
}

/**
 * What to do about a click that has not arrived yet.
 *
 * @param clickedAtMs when the click landed
 * @param nowMs the check's clock
 * @param callLive whether a voice call is up now
 * @returns wait the rest of the allowance, load the page as a document, or hold it for the call
 */
export function navStallAction({
  clickedAtMs,
  nowMs,
  callLive,
}: {
  clickedAtMs: number;
  nowMs: number;
  callLive: boolean;
}): NavStallAction {
  const waited = nowMs - clickedAtMs;
  if (waited < NAV_STALL_MS) {
    return { inMs: NAV_STALL_MS - waited, kind: "wait" };
  }
  if (callLive) {
    return { kind: "held-by-call" };
  }
  return { kind: "load-document" };
}
