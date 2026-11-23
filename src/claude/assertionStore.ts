/**
 * Where the standing enrollments live, and the one TOLERANT read of them.
 *
 * Extracted from the `claude signin` shell when `claude gauge` had to read the same file. That sharing is
 * the point rather than tidiness: the two surfaces must never disagree about which account a store holds,
 * and two readers of one file is how they would start to — the same argument `probeStore.ts` makes about
 * one probe serving `gauge` and `watch`.
 *
 * Only the tolerant read is here. The STRICT read and the write stay in the sign-in shell, beside the
 * enrollment they guard, because a file that one verb may only read and another may rewrite should not
 * offer both halves from one import.
 */
import { readJsonFile } from "../lib/jsonFile.js";
import { type ClaudeIdentityAssertion, parseIdentityAssertions } from "./identityAssertions.js";

/** Where the standing enrollments live, relative to the Slopweaver home. */
export const ASSERTIONS_FILE = "claude-accounts/identity-assertions.json";

/**
 * The standing enrollments, tolerating an absent or unreadable file.
 *
 * Tolerant like every other reader in this feature: a corrupt file means the fleet has forgotten what it
 * asserted, which reads back as `unbound` per store and asks for an enrollment. Refusing to parse would
 * instead stop the loop that keeps every credential alive. A path that may WRITE the file must NOT use this
 * — `readAssertionsForWrite` in the sign-in shell fails closed, because a write stores the whole list and an
 * empty read would silently drop every row.
 *
 * @param home the Slopweaver home to read from
 * @returns every usable enrollment, empty when nothing has been stored
 */
export function readAssertions({ home }: { home: string }): readonly ClaudeIdentityAssertion[] {
  return parseIdentityAssertions({ value: readJsonFile({ path: `${home}/${ASSERTIONS_FILE}` }) });
}
