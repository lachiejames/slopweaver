/**
 * Which visible session a hatch grant is issued to and read back for — the ONE answer both halves share.
 *
 * A journalled hatch is the only escape an outbound refusal offers, so a host that cannot name itself here
 * is a host whose every outbound refusal is a wedge. `AGENTS.md` rule 5 makes Codex a substitute host for
 * every tier the Claude host drives, so the session is resolved by `detectSupervisorSession` — a Claude Code
 * session id or a Codex thread id — rather than by `CLAUDE_CODE_SESSION_ID` alone. The journal field keeps
 * its `claudeSessionId` name, the one the rest of the tree uses for a visible session's identity.
 *
 * Both ids set at once is a process two harnesses leaked into, and it answers no session rather than
 * picking one: a grant issued to the wrong half would open a hatch for a session that never asked.
 *
 * What this does NOT close: a blank value counts as unset (`detectSupervisorSession`'s rule for every
 * caller), and an id is compared as an opaque string, not namespaced by host, so a process that controls
 * the environment can name any session. Recording the host in the journal row would close the second; the
 * first is the shared reader's semantics, and `journalled-grants.md` states the protection is partial on purpose.
 */
import { CLAUDE_CODE_SESSION_ID_ENV, CODEX_THREAD_ID_ENV, detectSupervisorSession } from "../supervisor/session.js";

/** The sentence a reader gets when no grant can be named, shared by `hatch open` and `hatch list`. */
export const NO_GRANT_SESSION_LINE =
  `neither ${CLAUDE_CODE_SESSION_ID_ENV} nor ${CODEX_THREAD_ID_ENV} names exactly one visible session in this ` +
  "environment, and a grant names the session it was issued to — it is never transferable";

/**
 * The visible session a grant is keyed on, read from the environment the caller was handed.
 *
 * @param env the environment the session id is read from — `process.env` in production, a test's own in a test
 * @returns the Claude Code session id or Codex thread id, or `undefined` when there is none or both
 */
export function grantSessionId({ env }: { env: Readonly<Record<string, string | undefined>> }): string | undefined {
  const detected = detectSupervisorSession({ env });
  if (detected.kind !== "active") {
    return undefined;
  }
  return detected.session.id;
}

/**
 * The environment a grant check reads, rebuilt from a door's injected one-name reader.
 *
 * Several doors take `({ name }) => string | undefined` rather than a record, so a test can decide what the
 * door sees. A grant check reads exactly three names — the two session ids and the state home — and this
 * copies those three across, so a door asks `hatchOpen` through the seam it already has rather
 * than reaching past it to `process.env`.
 *
 * @param read the door's injected environment reader
 * @returns a record holding the session ids and state home that reader answers
 */
export function grantEnvOf({
  read,
}: {
  read: (args: { name: string }) => string | undefined;
}): Readonly<Record<string, string | undefined>> {
  return {
    [CLAUDE_CODE_SESSION_ID_ENV]: read({ name: CLAUDE_CODE_SESSION_ID_ENV }),
    [CODEX_THREAD_ID_ENV]: read({ name: CODEX_THREAD_ID_ENV }),
    SLOPWEAVER_HOME: read({ name: "SLOPWEAVER_HOME" }),
  };
}
