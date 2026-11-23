/**
 * Which credential store a session boots against — the half of the rotation design that keeps one seat
 * still while the rest of the fleet moves.
 *
 * ## The one pinned seat: the publisher
 *
 * MEASURED, by rotating and watching it break: **claude.ai artifacts are per-account.** After the
 * fleet swapped from plan-three to plan-one, reading an artifact published under plan-three returned `artifact
 * not found`. So the rule is to pin the publishing seat to one account: a `publisher` seat boots
 * against the register's `pinned` store, and that same `pinned` row is held back from the rotating active slot
 * for the browser (`config.ts` `pinnedAccountAlias`).
 *
 * ## The supervisor chair ROUTES
 *
 * The chair is the one seat whose failure stops everything else, which is exactly why it must not sit on a
 * fixed plan. MEASURED: four chairs in a row booted on the pinned plan-five because the
 * supervisor role mapped to it, the gauge went blind partway through, and plan-five's Fable week went from
 * 20% to 100% under a chair that could not move. The chair must never hit
 * those limits, because if the supervisor goes down the fleet goes down, and routing must weigh which plan the
 * next supervisor is on. So a supervisor handoff or chair reseat carries no store
 * override and goes through the same live Fable routing a worker's spawn does (`routeSpawn.ts`); an explicit
 * `--plan` still pins it.
 *
 * ## What this does NOT do
 *
 * It selects a store at BOOT, and nothing here writes a credential. A pinned seat's store is chosen by its
 * boot line; the rotating seats simply carry no override and read whatever the active slot holds.
 */
import { shellQuoteToken } from "#lib/shellCommandLine.js";

import type { ClaudeAccount, ClaudeAccountAlias } from "./contracts.js";
import { SETUP_TOKEN_FD, SETUP_TOKEN_FD_ENV } from "./seatToken.js";

/**
 * Which seat a session occupies, and therefore whether it follows rotation.
 *
 * @internal — an argument to {@link storeDirForSeat}; the spawner knows which seat it is opening.
 */
export type PinnedSeat =
  /** Publishes artifacts to the pinned account's gallery. Never rotates. */
  | "publisher"
  /** The one Fable seat, whose failure stops everything else — so it routes on live readings, never pins. */
  | "supervisor-chair"
  /** Ordinary work. Follows the active credential slot wherever rotation puts it. */
  | "worker";

/**
 * The credential store a seat should boot against. Only the publisher pins; the supervisor chair and every
 * worker carry no override, so a spawn of either goes through live routing.
 *
 * @param seat which seat is being opened
 * @param pinnedAlias the account the publisher is held on — the one the browser and the gallery share
 * @param accounts the configured plans, to resolve the alias to its store directory
 * @returns the store directory to pin to, or undefined when the seat routes
 */
export function storeDirForSeat({
  accounts,
  pinnedAlias,
  seat,
}: {
  accounts: readonly ClaudeAccount[];
  pinnedAlias?: ClaudeAccountAlias;
  seat: PinnedSeat;
}): string | undefined {
  if (seat !== "publisher" || pinnedAlias === undefined) {
    return undefined;
  }
  return accounts.find((account) => account.alias === pinnedAlias)?.storeDir;
}

/**
 * The environment prefix a boot line carries so the session reads a chosen store, and a setup token when it has one.
 *
 * Returned as a prefix rather than applied here, so the one place that builds a launch line stays the one
 * place that builds a launch line — `src/devLint/noHeadless.ts` recognises that literal by exact text.
 *
 * A token seat's prefix opens the token file on a descriptor with a LEADING redirect, which POSIX permits before
 * the command word: `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 CLAUDE_SECURESTORAGE_CONFIG_DIR=<unbound> 3<<path> claude …`.
 * So the value never reaches argv, `ps`, the environment or the terminal's scrollback — only its path does.
 * Measured in zsh and bash: `V=3 3<<file> sh -c 'cat /dev/fd/$V'` prints the file, and `ps` shows
 * no token. `seatToken.ts` carries why the store beside it must be unbound.
 *
 * BOTH paths are shell-quoted, because both are strings the owner chose rather than strings this repo
 * built: a store directory now arrives from the plan register, where `slopweaver plans add --store-dir` takes
 * whatever the operator types. Unquoted, a store carrying a space assigns the prefix its first word and runs the rest
 * as the command, so the seat boots against a store nobody named while the line still reads as if it named
 * one. `shellQuoteToken` leaves an ordinary path bare, so the launch line for every real store is byte-identical.
 *
 * @param storeDir the store to boot against, or undefined for a seat with no store override
 * @param tokenPath the setup token file to open on the descriptor, or undefined for a store-backed seat
 * @returns the prefix to put before the launch command, empty when neither is set
 */
export function bootEnvPrefix({ storeDir, tokenPath }: { storeDir?: string; tokenPath?: string }): string {
  const store =
    storeDir === undefined ? "" : `CLAUDE_SECURESTORAGE_CONFIG_DIR=${shellQuoteToken({ token: storeDir })} `;
  if (tokenPath === undefined) {
    return store;
  }
  const fd = String(SETUP_TOKEN_FD);
  return `${SETUP_TOKEN_FD_ENV}=${fd} ${store}${fd}<${shellQuoteToken({ token: tokenPath })} `;
}

/**
 * The seat a session role occupies. The supervisor role is its own seat — the response policy reads that
 * distinction (`claimResponse.ts`, `trigger.ts`) — but it routes like a worker: {@link storeDirForSeat} pins
 * neither. Pages are local HTML (`slopweaver page`), so no seat needs a fixed account to publish one.
 *
 * @param role the session's declared role
 * @returns the seat, which decides whether it boots against a fixed store
 */
export function seatForRole({ role }: { role: string }): PinnedSeat {
  return role === "supervisor" ? "supervisor-chair" : "worker";
}
