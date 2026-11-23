/**
 * The exact terminal step that signs a Codex destination in by hand — written down, never performed.
 *
 * **Slopweaver never handles a Codex token.** `codex login` opens a browser flow against the owner's own session,
 * and the credential it mints is the provider CLI's; this repository's whole relationship with it is naming the
 * directory it lands in. So this module renders one line for the owner to paste, and nothing here launches, automates or
 * reads it. The console's Connect (`./connectCodex.ts`) is the other path: it asks the store's own app-server to start
 * that same browser flow, and the credential still lands in the store's `auth.json`, unread.
 *
 * MEASURED — this is why a per-destination home works at all, and it is the one fact the whole
 * multi-account Codex shape stands on. Reproduce:
 *
 * ```bash
 * codex login status                        # Logged in using ChatGPT
 * CODEX_HOME=$(mktemp -d) codex login status  # Not logged in
 * ```
 *
 * `$CODEX_HOME` genuinely isolates authentication, so N registered homes are N independent sign-ins.
 *
 * **What it does NOT prove**, stated here rather than discovered later: a second home signed into the SAME
 * account is a second copy of one subscription. {@link CAPACITY_CAVEAT} is printed beside every instruction
 * for that reason, and nothing in this repository can tell the two cases apart — doing so would mean
 * comparing emails, hashing tokens or decoding a JWT, none of which happens here.
 *
 * Pure: a home path in, a line out.
 */
import { shellQuoteToken } from "#lib/shellCommandLine.js";

/** The sentence every provisioning surface prints, so the register is never read as a capacity claim. */
export const CAPACITY_CAVEAT = "Two homes signed into the same account add no capacity.";

/**
 * The command the owner runs in their own terminal to sign one registered Codex destination in — one that works
 * the FIRST time.
 *
 * It creates the home before signing into it. MEASURED on codex-cli 0.155.1: pointed at a
 * directory that does not exist, `codex login` refuses outright with "CODEX_HOME points to … but that path
 * does not exist" — the exact line `plans add` used to hand the owner for `~/.codex-three`. `plans add` now creates
 * the directory itself, and the `mkdir -p` here keeps the line honest when it is re-printed for a home that was
 * since removed. Idempotent: on a home that exists it does nothing. Reproduce the refusal:
 *
 * ```bash
 * CODEX_HOME="$(mktemp -d)/absent" codex login status
 * ```
 *
 * The home is shell-quoted, so a path holding a space or an apostrophe stays ONE token — an unquoted one
 * silently assigns half a path and signs the wrong directory in.
 *
 * @param codexHome the destination's registered store directory
 * @returns the exact one-line command, ready to paste
 */
export function codexLoginCommand({ codexHome }: { codexHome: string }): string {
  const home = shellQuoteToken({ token: codexHome });
  return `mkdir -p ${home} && CODEX_HOME=${home} codex login`;
}

/**
 * The whole instruction a surface hands the owner for a Codex destination that is not signed in.
 *
 * @param codexHome the destination's registered store directory
 * @returns the command, whose terminal it must be run in, and the capacity caveat
 */
export function codexLoginInstruction({ codexHome }: { codexHome: string }): string {
  return (
    `Sign this destination in from Settings → Models in the console, or from your own terminal:\n` +
    `  ${codexLoginCommand({ codexHome })}\n` +
    `${CAPACITY_CAVEAT}`
  );
}
