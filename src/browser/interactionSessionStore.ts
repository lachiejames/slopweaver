/**
 * Where an interaction session lives on disk — the effectful half of {@link ./interactionSession}.
 *
 * One `<id>.json` per open session under `$home/live/browser/sessions`, beside the workspace the terminal
 * client runs in. A record is written when `browser open` succeeds, rewritten on every command that touches
 * it, and removed by `browser close`.
 *
 * Owner-only permissions throughout: a session record names the pages a session is working on, which is
 * ordinary state and still nobody else's business on a shared machine.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import { type BrowserActionError, BrowserActionErrors } from "./actionErrors.js";
import type { WindowPlacement } from "./foreground.js";
import type { InteractionSession, PageObservation, SessionOwner } from "./interactionSession.js";

/** Owner-only, like every other private lane under the home. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** What one session's record holds: the session itself and the last look taken through it. */
export interface StoredInteractionSession {
  readonly session: InteractionSession;
  /** The most recent observation, or `null` when nothing has been read through this session yet. */
  readonly observation: PageObservation | null;
}

/**
 * The directory one session owns — its record, its client workspace and its evidence.
 *
 * @param home the state home
 * @param id the session id
 * @returns the absolute directory
 */
export function interactionSessionDir({ home, id }: { home: string; id: string }): string {
  return join(stateHomePaths({ home }).live.browser.sessionsDir, id);
}

/**
 * Make one session's client workspace, owner-only like every directory this store makes — the one place a
 * session's directories are created, so `openTab` holds no filesystem write of its own.
 *
 * @param workspace the session's `workspace` path, under its session directory
 */
export function makeInteractionWorkspace({ workspace }: { workspace: string }): void {
  mkdirSync(workspace, { mode: DIR_MODE, recursive: true });
}

/**
 * Where one session's record is written.
 *
 * @param home the state home
 * @param id the session id
 * @returns the absolute path to `session.json`
 * @internal — read and written through this module's own verbs; no caller outside it names the path.
 */
function interactionSessionPath({ home, id }: { home: string; id: string }): string {
  return join(interactionSessionDir({ home, id }), "session.json");
}

/**
 * Write one session's record, creating its directory.
 *
 * @param home the state home
 * @param stored the session and its latest observation
 * @returns nothing, or why it could not be written
 */
export function writeInteractionSession({
  home,
  stored,
}: {
  home: string;
  stored: StoredInteractionSession;
}): Result<null, BrowserActionError> {
  try {
    mkdirSync(interactionSessionDir({ home, id: stored.session.id }), { mode: DIR_MODE, recursive: true });
    // Atomic, because a record is REWRITTEN in place once a look is taken: a plain write truncates first, so a
    // write that failed partway (a full disk) would leave a file that reads as absent — and a tab that
    // `browser sessions` no longer lists and `browser close` no longer closes.
    writeFileAtomic({
      contents: `${JSON.stringify(stored, null, 2)}\n`,
      dirMode: DIR_MODE,
      fileMode: FILE_MODE,
      path: interactionSessionPath({ home, id: stored.session.id }),
    });
    return ok(null);
  } catch (error: unknown) {
    return err(BrowserActionErrors.sessionRecordUnwritable({ detail: errorMessage({ error }) }));
  }
}

/**
 * Read one session's record.
 *
 * A missing or unparseable record reads as ABSENT rather than as an error, because the caller's correction
 * is identical either way: there is no session to act through, so open one.
 *
 * @param home the state home
 * @param id the session id
 * @returns the record, or `undefined` when there is none to read
 */
export function readInteractionSession({
  home,
  id,
}: {
  home: string;
  id: string;
}): StoredInteractionSession | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(interactionSessionPath({ home, id }), "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const session = parsed["session"];
  if (!isRecord(session) || typeof session["id"] !== "string" || typeof session["workspace"] !== "string") {
    return undefined;
  }
  // A record not filed under its own id is not that session: two directories naming one id would let a verdict
  // judged on one record execute against the other, a live opener's included.
  if (session["id"] !== id) {
    return undefined;
  }
  const observation = parsed["observation"];
  return {
    observation:
      isRecord(observation) && typeof observation["id"] === "string" ? toObservation({ raw: observation }) : null,
    session: toSession({ raw: session }),
  };
}

/**
 * Read one session record's own fields off a parsed object.
 *
 * Field by field rather than a cast, because the file is on disk between two processes and a record written
 * by an older build is a thing that really happens — a cast would let one through shaped wrong and fail
 * somewhere unrelated.
 *
 * @param raw the parsed `session` object
 * @returns the session
 */
function toSession({ raw }: { raw: Readonly<Record<string, unknown>> }): InteractionSession {
  const origins = raw["origins"];
  return {
    clientSession: asString({ value: raw["clientSession"] }),
    id: asString({ value: raw["id"] }),
    openedAtIso: asString({ value: raw["openedAtIso"] }),
    origins: Array.isArray(origins)
      ? origins.filter((value: unknown): value is string => typeof value === "string")
      : [],
    owner: toOwner({ raw: raw["owner"] }),
    ownerSessionId: asString({ value: raw["ownerSessionId"] }),
    placement: toPlacement({ raw: raw["placement"] }),
    touchedAtIso: asString({ value: raw["touchedAtIso"] }),
    workspace: asString({ value: raw["workspace"] }),
  };
}

/**
 * Read where a session's window belongs. Only a record that SAYS `foreground` is one: a record written before the
 * choice existed was opened to stay behind the owner's windows, and a torn value is read the way that asks least of the owner's
 * screen.
 *
 * @param raw the parsed `placement` value
 * @returns the placement
 */
function toPlacement({ raw }: { raw: unknown }): WindowPlacement {
  if (raw === "foreground") {
    return "foreground";
  }
  return "background";
}

/**
 * Read a session's recorded opener, or `null` for a record written before one was recorded.
 *
 * A field of the wrong type reads as unrecorded rather than failing the record: the reap treats an
 * unrecorded field as unknown and leaves the session alone, which is the safe reading of a torn one too.
 *
 * @param raw the parsed `owner` value
 * @returns the owner, or `null`
 */
function toOwner({ raw }: { raw: unknown }): SessionOwner | null {
  if (!isRecord(raw)) {
    return null;
  }
  const pid = raw["pid"];
  const cmuxWorkspace = raw["cmuxWorkspace"];
  const runSlug = raw["runSlug"];
  return {
    cmuxWorkspace: typeof cmuxWorkspace === "string" ? cmuxWorkspace : null,
    pid: typeof pid === "number" && Number.isInteger(pid) ? pid : null,
    runSlug: typeof runSlug === "string" ? runSlug : null,
  };
}

/**
 * Read one observation's own fields off a parsed object.
 *
 * @param raw the parsed `observation` object
 * @returns the observation
 */
function toObservation({ raw }: { raw: Readonly<Record<string, unknown>> }): PageObservation {
  const screenshot = raw["screenshotPath"];
  return {
    id: asString({ value: raw["id"] }),
    observedAtIso: asString({ value: raw["observedAtIso"] }),
    // `null` rather than the empty string {@link asString} gives every other field: a caller PRINTS this
    // path, so an empty one would render as a line pointing at nothing, while an absent one is a record from
    // a build that took no picture and is reported as the absence it is.
    screenshotPath: typeof screenshot === "string" && screenshot.length > 0 ? screenshot : null,
    snapshotPath: asString({ value: raw["snapshotPath"] }),
    title: asString({ value: raw["title"] }),
    url: asString({ value: raw["url"] }),
  };
}

/**
 * One field as a string, or the empty string when the record does not carry it.
 *
 * Empty rather than a throw: a record missing a field is a record from an older build, and the caller's own
 * liveness and page checks already refuse to act through one that does not describe the page in front of it.
 *
 * @param value the raw field
 * @returns the string
 */
function asString({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}

/**
 * Every session id the store holds.
 *
 * @param home the state home
 * @returns the ids, or an empty list when the directory is absent
 */
export function listInteractionSessionIds({ home }: { home: string }): readonly string[] {
  try {
    return readdirSync(stateHomePaths({ home }).live.browser.sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Every session record the store holds that decodes — the one enumeration `browser sessions` and
 * `machine reap` both read, so the list the owner is shown is the list the reap judges.
 *
 * @param home the state home
 * @returns the readable records, in directory order
 */
export function listStoredInteractionSessions({ home }: { home: string }): readonly StoredInteractionSession[] {
  return listInteractionSessionIds({ home })
    .map((id) => readInteractionSession({ home, id }))
    .filter((stored): stored is StoredInteractionSession => stored !== undefined);
}

/**
 * Retire one session: remove the record that makes it actionable, and KEEP its pictures.
 *
 * Called by `browser close` AFTER the client has been told to detach, never before: the record is what a
 * recovery reads to know which client session to let go of, so removing it first would strand one. Removing
 * the record is the whole of what "closed" has to mean — {@link readInteractionSession} answers absent
 * afterwards, so no later command can act through it.
 *
 * **The pictures stay, and that is a correctness rule rather than tidiness.** MEASURED, while
 * reproducing the owner's own Datadog walk through these verbs: `close` deleted the session directory whole,
 * and with it every before, aimed and after picture the walk had just taken — the evidence of clicks made in
 * the owner's browser under the owner's identity, destroyed by the verb that ends the session. A receipt naming a path that
 * no longer exists is worse than no receipt, because it reads as evidence. So this removes `session.json`
 * and leaves everything beside it; `browser sessions` stops listing it either way, because that verb reads
 * records rather than directories.
 *
 * What is NOT swept here is named rather than implied: the pictures accumulate under
 * `$SLOPWEAVER_HOME/live/browser/sessions/<id>/`, and nothing in this tree sweeps them yet. They are small
 * and they are evidence, so the wrong answer was the one that deleted them silently; a sweep with a stated
 * retention is a follow-up, and an operator can remove a session's directory by hand today.
 *
 * @param home the state home
 * @param id the session id
 */
export function removeInteractionSession({ home, id }: { home: string; id: string }): void {
  rmSync(interactionSessionPath({ home, id }), { force: true });
}

/**
 * The shape `randomUUID()` mints every session id in — an RFC 4122 version-4 UUID, its version nibble `4` and its
 * variant nibble one of `89ab` — the only name a recursive removal will accept. A shape check, not provenance: it
 * keeps a path separator, `..` and the nil UUID out, which is what a recursive `rmSync` needs.
 */
const MINTED_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Remove a one-shot look's whole private workspace — `$SLOPWEAVER_HOME/live/browser/sessions/<id>/` — once its
 * snapshot and picture have been read or dropped. Only `browser inspect`'s and `hand post --url`'s throwaway
 * sessions end this way; a kept session's pictures stay as evidence, per {@link removeInteractionSession}.
 *
 * The removal is recursive, so an id that is not a minted UUID is REFUSED rather than joined: `..` would resolve
 * to the browser state directory itself and delete every session.
 *
 * @param home the state home
 * @param id the session id, which must be the UUID a verb minted
 * @returns ok once the workspace is gone, or absent already; an error naming the id when it is not a minted one
 */
export function removeInteractionWorkspace({ home, id }: { home: string; id: string }): Result<void> {
  if (!MINTED_SESSION_ID.test(id)) {
    return err([`refused to remove the workspace of ${JSON.stringify(id)}: not a minted session id`]);
  }
  rmSync(interactionSessionDir({ home, id }), { force: true, recursive: true });
  return ok(undefined);
}
