/**
 * Whether a canon file tells a session where this install's integration credentials actually live.
 *
 * ## Why a gate rather than a paragraph somebody remembers to keep
 *
 * MEASURED in the office-hours loop: a live bot turn answered a Vanta ask by saying it had no Vanta credentials
 * and wanted two files, while `vanta-client-id` and `vanta-client-secret` were sitting in
 * `$SLOPWEAVER_HOME/secrets/`. Its check had grepped file CONTENTS for "vanta" instead of listing the
 * directory. The rule: every session opened from either repository must know where the owner goes to get the
 * credentials for an integration. A memory records it, but a memory loads only in the owner's own Claude
 * Code — the canon the plugin ships is what a spawned or dispatched session actually reads.
 *
 * ## What makes this falsifiable rather than a tautology
 *
 * A gate that greps canon for a string the gate's own author wrote passes forever and proves nothing: it
 * would stay green if the store moved to `$SLOPWEAVER_HOME/credentials/` tomorrow, leaving the canon a
 * confident lie. So {@link mentionsSecretsStore} takes the directory name as an ARGUMENT, and its real
 * caller derives that argument from `stateHomePaths({ home }).secrets` — the one place in this tree that
 * decides where a secret file goes (`src/stateHome.ts`, reached by `secretFilePath`). Move the store and
 * every canon surface below reddens until its prose is corrected. The verb half needs nothing here at all:
 * `src/canon/staleReferences.ts` already resolves every `slopweaver <noun> <verb>` address written anywhere
 * in canon against the real manifest, so `slopweaver secrets status` going away is already a failure.
 */

/** The verb a session is pointed at — names every credential this install holds, and never a value. */
const STORE_READ_VERB = "slopweaver secrets status";

/**
 * Whether one canon file names both halves a stranded session needs: the directory the credentials are in,
 * and the verb that lists them. Pure — the directory is supplied rather than assumed, which is the whole
 * point of the check.
 *
 * Both halves are required together because either alone leaves the stranded-session failure open: a path with no
 * verb invites the `ls`-and-guess that the register replaced, and a verb with no path leaves a session that
 * cannot run it (a Codex host, a sandbox) with nowhere to look.
 *
 * @param text the file's whole contents
 * @param storeDirectory the store's own directory name, as the code really resolves it
 * @returns true when the file names the store path and the verb that reads it
 */
export function mentionsSecretsStore({ text, storeDirectory }: { text: string; storeDirectory: string }): boolean {
  return text.includes(`$SLOPWEAVER_HOME/${storeDirectory}/`) && text.includes(STORE_READ_VERB);
}

/**
 * One canon surface that must carry the pointer, and the reason it is on the list rather than another file.
 *
 * @internal — the registry below is the only producer, and the test the only consumer.
 */
export interface RequiredSecretsMention {
  /** Repo-relative path. */
  readonly path: string;
  /** Why a session reading THIS file is one that could otherwise strand itself. */
  readonly because: string;
}

/**
 * The surfaces a stranded session actually reads, each named for the reason it is here.
 *
 * Deliberately NOT "every canon file": a pointer repeated into forty skills is four decades of drift, and
 * `agent-doc-size` prices every line of it. These four are where the failure happened or would happen —
 * the always-on canon both hosts load, the continuous loop's own not-built checklist, the dispatched turn's
 * investigation rules, and the source planner that decides a leg is unreachable.
 */
export const REQUIRED_SECRETS_MENTIONS: readonly RequiredSecretsMention[] = [
  {
    because: "the one file every session on both hosts loads before it reads a line of code",
    path: "AGENTS.md",
  },
  {
    because: "the continuous loop's own list of what would mean the bot is not built",
    path: "skills/loop/reference/not-built.md",
  },
  {
    because: "the dispatched turn's investigation rules — where a turn once went wrong",
    path: "skills/loop-bot/reference/investigating.md",
  },
  {
    because: "the source planner that decides a leg is unavailable for want of a credential",
    path: "skills/route/SKILL.md",
  },
];
