/**
 * The thin effectful shell over the macOS keychain — the ONLY place in this repository that reads a Claude
 * credential, and the only place that reads one WITHOUT any sibling that writes one.
 * Everything it decides was decided in `credentialDocument.ts`, which is pure; this file does the syscall and
 * nothing else.
 *
 * ## Why there is no writer here any more, and the two incidents that are the reason to keep reading
 *
 * This file used to carry `writeCredentialDocument`, `replaceCredentialDocument` and `withCredentialLock`,
 * which existed for exactly one caller: the plan SWAP, which copied one store's credential into the shared
 * default keychain slot so that every session would pick it up. That mechanism is retired — `spawnStore.ts`
 * chooses a store per spawn and `seatPinning.ts` pins one per seat, both through
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR`, so no credential's bytes ever need to move. The writer went with it,
 * because **refresh-token ROTATION is real on this provider**: MEASURED, a refresh replaces the
 * refresh token as well as the access token, so a second COPY of one credential is revoked the moment either
 * copy refreshes. Two slots holding one credential is the only revocation mechanism in this workstream with
 * actual evidence behind it, and the way to close it is to stop making copies.
 *
 * The history is kept rather than deleted, because it is what a future session reaching for a writer needs to
 * know before writing one:
 *
 * - **A `security -i` stdin line past about 4032 characters is TRUNCATED SILENTLY** rather than refused.
 *   MEASURED, by breaking the owner's machine: a document of 2008 JSON bytes became 4016 hex chars,
 *   which with a 79-char command prefix made a 4095-char line. `security` cut it, the truncated hex decoded to
 *   truncated JSON, and `claudeAiOauth` — last in key order — was gone. Every session on the machine went
 *   unauthenticated on its next turn until the owner signed in by hand. Claude Code's own writer guards this
 *   with a threshold and an argv fallback; an earlier version of this file quoted that threshold and then
 *   dropped the fallback on purpose, reasoning that no payload size justifies a `ps` exposure. That trade was
 *   wrong, and a momentary process-table exposure on a single-user machine is the smaller harm.
 * - **A read-back verifier DETECTS a bad write and cannot undo one.** The prior document was in hand at the
 *   moment of that write and was not kept, so a failed write became data loss. A writer needs a rollback, not
 *   only a verifier.
 * - **A keychain item is one JSON document holding more than the Claude credential.** It carries an `mcpOAuth`
 *   map with live tokens per connected MCP server, so any writer must replace one top-level key and preserve
 *   every sibling, known or not. `credentialDocument.ts` still carries that merge reasoning.
 *
 * Two properties of what remains are deliberate:
 *
 * - **`execFileSync`, never `exec` or `spawn`.** The `no-headless` gate permits the sync forms precisely
 *   because they block, so nothing here can outlive the process that started it. It also means no shell parses
 *   these arguments, so a service name can never be word-split.
 * - **Nothing returns or logs a credential.** The read hands its document straight to a pure function, and
 *   every error path reports a code and a service name. `unknown` is the type on purpose.
 */
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";

import { claudeStoreService } from "./storeService.js";

/** How long a `security` call may take before it is treated as a failure. */
const TIMEOUT_MS = 5_000;

/** `security` exits 44 for "no such item" and 36 for a locked keychain; neither is an error worth throwing. */
const ABSENT_EXIT_CODES = new Set([36, 44]);

/**
 * The keychain account field Claude Code files every item under.
 *
 * ## A DIVERGENCE this does not close, and it is not this change's to close
 *
 * This passes `$USER` through verbatim. Claude Code 2.1.269 does not: its own account resolver can fall back to
 * the literal `claude-code-user`, which sits beside `-credentials` and `OAUTH_FILE_SUFFIX` in the shipped binary
 * — verified here by finding that string in `~/.local/share/claude/versions/2.1.269`, and found by a
 * Codex review pass that extracted and ran the resolver, measuring `USER="review user"` resolving to
 * `claude-code-user` while this function returns `review user`.
 *
 * So on a machine whose `$USER` that resolver rejects, every read here addresses a DIFFERENT keychain account
 * from the one Claude writes. It is not reached on this machine, it predates the on-demand repair entirely, and
 * it affects every reader in this file rather than one caller — so closing it means mirroring another program's
 * sanitiser, which needs the predicate decoded rather than guessed. It has its own board row. Reproduce the
 * string with `grep -c claude-code-user "$HOME/.local/share/claude/versions/2.1.269"` — it prints `1`.
 *
 * @returns the current user name, as `process.env.USER || os.userInfo().username`
 */
function keychainAccount(): string {
  const USER = process.env["USER"];
  if (USER === undefined) {
    return userInfo().username;
  }
  return USER;
}

/** Read one keychain item's secret text, filed under the Claude account, throwing when `security` refuses. */
export type KeychainItemReader = (args: { service: string; timeoutMs: number }) => string;

/**
 * The production reader: the account resolved at the moment of the read, then one blocking `security` call. Its
 * stderr is PIPED, never inherited: an absent item is an ordinary answer here (`readCredentialDocument` returns
 * `undefined` for it), and inherited, `security`'s own "could not be found in the keychain" line reached the
 * terminal once per store on every `claude signin --status` over a fresh home. Repro: two `plans add --provider
 * claude` into an empty `$SLOPWEAVER_HOME`, then `slopweaver claude signin --status`.
 */
const readKeychainItem: KeychainItemReader = ({ service, timeoutMs }) =>
  execFileSync("security", ["find-generic-password", "-a", keychainAccount(), "-w", "-s", service], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });

/**
 * Read one store's credential document.
 *
 * @internal — the read half of the swap seam; the orchestrator that pairs it with
 *   the only reader in this repository, and there is no writer beside it any more.
 *
 * @param storeDir the store to read, or undefined for the active slot
 * @param readItem how the item's text is fetched; omitted, the macOS keychain through `security`
 * @returns the decoded document, or undefined when the item is absent or unreadable
 */
export function readCredentialDocument({
  storeDir,
  readItem = readKeychainItem,
}: {
  storeDir?: string;
  readItem?: KeychainItemReader;
}): unknown {
  const service = claudeStoreService(storeDir === undefined ? {} : { storeDir });
  try {
    const raw = readItem({ service, timeoutMs: TIMEOUT_MS });
    return JSON.parse(raw.trim());
  } catch (cause) {
    const code = typeof cause === "object" && cause !== null && "status" in cause ? cause.status : undefined;
    if (typeof code === "number" && ABSENT_EXIT_CODES.has(code)) {
      return undefined;
    }
    return undefined;
  }
}
