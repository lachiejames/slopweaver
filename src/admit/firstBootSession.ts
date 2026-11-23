/**
 * The mark a session leaves when it is let through on a FIRST BOOT, and the door's read of it.
 *
 * A first boot admits every call, a compound shell call included, and records no load (`./profileHeld.ts`). One
 * admitted call can therefore select a store, write the owner's profile and then make an external write, all before a
 * second PreToolUse check runs — and the door would see a session the ledger never observed, which it passes.
 * A profile which exists and was not loaded is held, so the door
 * holds a session marked here once the machine is no longer a first boot and the session has loaded nothing.
 *
 * The mark is `profile/first-boot/<session id>` under the resolved home AND each default home the first-boot read
 * covers, and the door reads all of them: a call that re-points `SLOPWEAVER_HOME` at a default home would otherwise
 * configure the machine where the door looks while the mark sat where it does not. It is deliberately NOT a configuration trace:
 * neither `./profileFirstBoot.ts` nor its bash twin reads it, so marking a session leaves a fresh machine fresh.
 * `hooks/lib/profile-delivered.sh`'s `profile_first_boot_admit` writes the same file on the lane no node can run.
 *
 * Two writers leave it. The hooks mark every session they find on a first boot — the PreToolUse hold each call it
 * admits, the session-start hook (`../cli/commands/profile/hookRun.ts`) the session it boots — best-effort: a mark one
 * cannot write admits anyway, since holding would wedge the first boot it opens. And `profile set` marks the session it runs in — the ids the
 * environment names, the same ones the door judges by — and refuses the row unless that mark lands, so the session that
 * creates the profile is always held for it, whatever the hook managed or whatever that call repaired first (a mark
 * failing at hook time, then a compound call that cleared the obstruction, wrote the profile and
 * passed the door). A mark whose presence cannot be read is read as present: the door's side of it fails closed.
 */
import { accessSync, closeSync, constants, lstatSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

import { stateHomePaths } from "../stateHome.js";

/** The shape of a session id the mark is written under — the one the bash lane's payload reader accepts. */
const SESSION_ID = /^[0-9A-Za-z-]+$/u;

/** The directory every session's first-boot mark lives in under one home, which may not exist yet. */
function firstBootSessionDir({ home }: { home: string }): string {
  return stateHomePaths({ home }).profileFirstBootDir;
}

/**
 * Where a session's first-boot mark lives, or `undefined` for an id that is not a plain session id.
 *
 * @param home the resolved Slopweaver home
 * @param sessionId the session the mark names
 * @returns the mark's path
 */
export function firstBootSessionPath({ home, sessionId }: { home: string; sessionId: string }): string | undefined {
  if (!SESSION_ID.test(sessionId)) {
    return undefined;
  }
  return join(firstBootSessionDir({ home }), sessionId);
}

/**
 * Whether a session admitted on a first boot could be marked under `home`: its directory exists, or is made, and takes
 * entries. `profile set` refuses to write the owner row unless every home passes, so a home failing it never holds a
 * row nothing on this machine knows of.
 *
 * @param home a Slopweaver home
 * @returns true when the directory takes entries
 */
export function sessionMarkable({ home }: { home: string }): boolean {
  const dir = firstBootSessionDir({ home });
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark a session as one let through on a first boot, in every home named.
 *
 * @param homes the resolved Slopweaver home and the default homes; a repeat is written once
 * @param sessionId the session let through
 * @returns true when every mark was written; false for an id that is not a plain session id
 */
export function markFirstBootSession({ homes, sessionId }: { homes: readonly string[]; sessionId: string }): boolean {
  let all = true;
  for (const home of new Set(homes)) {
    const path = firstBootSessionPath({ home, sessionId });
    if (path === undefined) {
      return false;
    }
    try {
      mkdirSync(firstBootSessionDir({ home }), { recursive: true });
      // Created if absent, never truncated, never followed: a link at the mark's path fails rather than emptying
      // whatever it points at — the owner-written mark, say. The mark is its presence alone.
      closeSync(openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600));
    } catch {
      all = false;
    }
  }
  return all;
}

/**
 * Whether any of these sessions was let through on a first boot. A mark whose presence cannot be read counts.
 *
 * @param homes the resolved Slopweaver home and the default homes
 * @param sessionIds the calling session's ids
 * @returns true when one of them carries a mark in any home, or might
 */
export function firstBootSessionSeen({
  homes,
  sessionIds,
}: {
  homes: readonly string[];
  sessionIds: readonly string[];
}): boolean {
  return homes.some((home) => markSeenIn({ home, sessionIds }));
}

/** Whether one home carries a mark for any of these sessions. */
function markSeenIn({ home, sessionIds }: { home: string; sessionIds: readonly string[] }): boolean {
  return sessionIds.some((sessionId) => {
    const path = firstBootSessionPath({ home, sessionId });
    if (path === undefined) {
      return false;
    }
    try {
      lstatSync(path);
      return true;
    } catch (cause: unknown) {
      return !(cause instanceof Error && "code" in cause && cause.code === "ENOENT");
    }
  });
}
