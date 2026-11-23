/**
 * The shell's answer to a "Reveal in Finder" (`desktopShell.ts`'s `DesktopBridge.revealPageInFinder`), read strictly:
 * the shell is a separate project, so the console parses what it receives. Pure.
 */

/** What the shell answered a "Reveal in Finder": Finder was asked, one line saying why not, or nothing readable. */
export type RevealReply =
  { readonly kind: "revealed" } | { readonly kind: "refused"; readonly why: string } | { readonly kind: "unreadable" };

/** The longest reason a reveal's refusal is shown with; the shell's own lines are well inside it. */
export const REVEAL_WHY_MAX = 256;

/**
 * The shell's answer to a reveal: `null` is Finder asked, a non-blank bounded single line is the reason it was not, and
 * anything else is unreadable, kept apart rather than shown as a reason.
 *
 * @param value what the shell answered
 * @returns the reply
 */
export function revealReplyOf({ value }: { value: unknown }): RevealReply {
  if (value === null) {
    return { kind: "revealed" };
  }
  if (typeof value !== "string") {
    return { kind: "unreadable" };
  }
  const shown = value.trim() !== "" && value.length <= REVEAL_WHY_MAX && !/[\r\n]/u.test(value);
  if (!shown) {
    return { kind: "unreadable" };
  }
  return { kind: "refused", why: value };
}
