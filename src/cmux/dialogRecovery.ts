/**
 * Declining cmux's allowlisted dialog: once on request (`slopweaver cmux dialog --dismiss`), and once a minute at
 * most when a seat's own call to cmux times out — the moment a seat first feels the hang, and the one process with
 * the Accessibility grant to answer it (`./dialogEffects.ts`).
 *
 * Every press is journalled as `dialog-dismissed` in the revive journal (the store, through `../fleet/port.ts`),
 * which `./hang.ts` reads as the end of the unanswered run: the cause is gone, so the readings before it never restart
 * cmux. The automatic attempt is claimed under a lock and stamped BEFORE anything runs, so a fleet of seats timing out
 * together sends one Apple Event a minute, and a claim that cannot be written touches no UI at all. The lock and the
 * claim are process-lifetime state, so both live in the home's runtime directory (`../stateRuntime.ts`).
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { acquireOperationLock } from "../admit/operationLock.js";
import type { FleetError } from "../fleet/errors.js";
import { fleetPort } from "../fleet/port.js";
import { runtimeCmuxDir, runtimeLockDir } from "../stateRuntime.js";
import {
  AUTOMATIC_ATTEMPT_INTERVAL_MS,
  automaticDialogAttemptDue,
  type CmuxDialog,
  type CmuxDialogError,
  CmuxDialogErrors,
  type DialogDismissal,
  dismissalForDialog,
} from "./dialog.js";
import { dismissCmuxDialog, readCmuxDialogs, runDialogCommand } from "./dialogEffects.js";
import type { CmuxReviveEvent } from "./reviveJournal.js";

/** Every effect a decline reaches, so a test drives it with fakes. */
export interface DialogRecoveryDeps {
  readonly nowIso: () => string;
  readonly read: () => Result<readonly CmuxDialog[], CmuxDialogError>;
  readonly dismiss: (options: { dismissal: DialogDismissal }) => Result<void, CmuxDialogError>;
  readonly append: (options: {
    home: string;
    event: Extract<CmuxReviveEvent, { kind: "dialog-dismissed" }>;
  }) => Promise<Result<number, FleetError>>;
}

/** What one look found, and the press it made when it made one. */
export interface DialogReport {
  readonly dialogs: readonly CmuxDialog[];
  readonly dismissed: DialogDismissal | null;
}

const LOCK_KEY = "cmux-dialog-decline";

const claimSchema = z.object({ atIso: z.iso.datetime(), schemaVersion: z.literal(1) });

/** Where the newest automatic attempt's claim lives, or why the runtime directory holding it is unavailable. */
function claimPath({ home }: { home: string }): Result<string, CmuxDialogError> {
  return runtimeCmuxDir({ home })
    .map((directory) => join(directory, "cmux-dialog-decline.json"))
    .mapErr((error) => CmuxDialogErrors.stateFailed({ why: error.message }));
}

/**
 * Read cmux's dialogs, and with `dismiss` press Cancel on the first allowlisted one, journalling the press only once
 * it happened.
 *
 * @param dismiss whether to press, or only report
 * @param home the state home whose revive journal records the press
 * @param deps the effects
 * @returns what was seen and pressed, or why the read, press or journal failed
 */
export async function inspectDialogs({
  dismiss,
  home,
  deps,
}: {
  dismiss: boolean;
  home: string;
  deps: DialogRecoveryDeps;
}): Promise<Result<DialogReport, CmuxDialogError | FleetError>> {
  const read = deps.read();
  if (read.isErr()) {
    return err(read.error);
  }
  const dialogs = read.value;
  const target = dialogs.map((dialog) => dismissalForDialog({ dialog })).find((dismissal) => dismissal !== undefined);
  if (!dismiss || target === undefined) {
    return ok({ dialogs, dismissed: null });
  }
  const pressed = deps.dismiss({ dismissal: target });
  if (pressed.isErr()) {
    return err(pressed.error);
  }
  const event = {
    atIso: deps.nowIso(),
    button: target.button,
    kind: "dialog-dismissed",
    schemaVersion: 1,
    title: target.title,
  } as const;
  const appended = await deps.append({ event, home });
  if (appended.isErr()) {
    return err(appended.error);
  }
  return ok({ dialogs, dismissed: target });
}

/**
 * When the last automatic attempt was claimed: none when no claim file exists. A file that exists but does not parse
 * dates the claim by its own modification time, so a corrupted claim holds the attempt for one interval rather than
 * reading as no claim and letting a second press through inside the minute.
 *
 * @param path the claim file
 * @returns the claimed instant, none, or why the file could not be read
 */
function lastClaimIso({ path }: { path: string }): Result<string | undefined, CmuxDialogError> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause: unknown) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok(undefined);
    }
    return err(CmuxDialogErrors.stateFailed({ why: String(cause) }));
  }
  try {
    const parsed = claimSchema.safeParse(JSON.parse(text));
    if (parsed.success) {
      return ok(parsed.data.atIso);
    }
  } catch (cause: unknown) {
    if (!(cause instanceof SyntaxError)) {
      return err(CmuxDialogErrors.stateFailed({ why: String(cause) }));
    }
  }
  try {
    return ok(statSync(path).mtime.toISOString());
  } catch (cause: unknown) {
    return err(CmuxDialogErrors.stateFailed({ why: String(cause) }));
  }
}

/**
 * Claim this minute's automatic attempt and make it, all under the lock: read the clock only once the lock is held,
 * read the last claim, and when one is due write the new one, run `attempt`, and stamp the claim again with the clock
 * read after it, all before the lock is released. A post-attempt stamp that cannot be written is logged and leaves
 * the pre-attempt one, the same file the same holder wrote moments earlier. So the
 * stamp spaces the UI attempts themselves, not just the claims: a seat paused after claiming still holds the lock,
 * and no later claimant can press until it is done; and a seat paused before the lock cannot
 * stamp an instant read before another seat's claim. A malformed claim holds for one interval from its file's
 * modification time and is then replaced; a future one holds until the clock passes it by the interval.
 * The lock's lease never goes stale, so a live holder is never displaced mid-attempt.
 *
 * @param home the state home
 * @param clock the instant now, read for the lock, again once it is held, and once more after the attempt
 * @param attempt the UI attempt, run only when this caller holds the claim, before the lock is released
 * @returns whether this caller held the claim and made the attempt, or why the claim could not be read or written
 */
export async function claimAutomaticDialogAttempt({
  home,
  clock,
  attempt,
}: {
  home: string;
  clock: () => string;
  attempt: () => Promise<void>;
}): Promise<Result<boolean, CmuxDialogError>> {
  const located = claimPath({ home });
  if (located.isErr()) {
    return err(located.error);
  }
  const path = located.value;
  const directory = runtimeLockDir({ home });
  if (directory.isErr()) {
    return err(CmuxDialogErrors.stateFailed({ why: directory.error.message }));
  }
  // Never stale: a live holder is never taken over, so a seat paused inside the claim cannot wake beside a second
  // one and press twice in a minute; a dead holder is still recovered by its pid.
  const lock = acquireOperationLock({
    directory: directory.value,
    home,
    key: LOCK_KEY,
    nowIso: clock(),
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isErr()) {
    return ok(false);
  }
  try {
    return await claimUnderLock({ attempt, clock, path, stolen: lock.value.stoleFromPid !== undefined });
  } finally {
    lock.value.release();
  }
}

/** The claim and the attempt, run only while {@link claimAutomaticDialogAttempt} holds the lock. */
async function claimUnderLock({
  attempt,
  clock,
  path,
  stolen,
}: {
  attempt: () => Promise<void>;
  clock: () => string;
  path: string;
  stolen: boolean;
}): Promise<Result<boolean, CmuxDialogError>> {
  const nowIso = clock();
  const last = lastClaimIso({ path });
  if (last.isErr()) {
    return err(last.error);
  }
  const lastAttemptIso = last.value;
  if (!automaticDialogAttemptDue({ intervalMs: AUTOMATIC_ATTEMPT_INTERVAL_MS, lastAttemptIso, nowIso })) {
    return ok(false);
  }
  // A lock taken over from a dead holder: it may have pressed just before it died, after its pre-attempt stamp
  // and before the one that follows the attempt, so this caller stamps now and waits out a whole interval
  // rather than read that older stamp as the last press.
  if (stolen) {
    const held = writeClaim({ atIso: nowIso, path });
    return held.isErr() ? err(held.error) : ok(false);
  }
  const claimed = writeClaim({ atIso: nowIso, path });
  if (claimed.isErr()) {
    return err(claimed.error);
  }
  try {
    await attempt();
  } finally {
    // Stamped again once the attempt is over, with the clock read after it, so the next claimant's minute runs
    // from the end of this press rather than its claim: a holder paused between the two cannot hand the lock on
    // with a claim already a minute old.
    const finished = writeClaim({ atIso: clock(), path });
    if (finished.isErr()) {
      logger.error({ msg: `cmux: ${finished.error.message}` });
    }
  }
  return ok(true);
}

/**
 * Write the claim file.
 *
 * @param path the claim file
 * @param atIso the instant claimed
 * @returns nothing, or why it could not be written
 */
function writeClaim({ path, atIso }: { path: string; atIso: string }): Result<void, CmuxDialogError> {
  try {
    const contents = `${JSON.stringify({ atIso, schemaVersion: 1 })}\n`;
    writeFileAtomic({ contents, dirMode: 0o700, fileMode: 0o600, path });
    return ok(undefined);
  } catch (cause: unknown) {
    return err(CmuxDialogErrors.stateFailed({ why: String(cause) }));
  }
}

/**
 * After a seat's call to cmux timed out: claim the minute's attempt and, holding it, decline the allowlisted dialog.
 * Never throws and never changes the call's own result — a failure is one logged line.
 *
 * @param home the state home
 * @param deps the effects
 */
export async function recoverDialogAfterTimeout({
  home,
  deps,
}: {
  home: string;
  deps: DialogRecoveryDeps;
}): Promise<void> {
  try {
    const attempt = async (): Promise<void> => {
      const inspected = await inspectDialogs({ deps, dismiss: true, home });
      if (inspected.isErr()) {
        logger.error({ msg: `cmux: a call timed out and the dialog check failed — ${inspected.error.message}` });
      } else if (inspected.value.dismissed !== null) {
        const { button, title } = inspected.value.dismissed;
        logger.error({ msg: `cmux: a call timed out behind the "${title}" dialog, so this seat pressed ${button}` });
      }
    };
    const claim = await claimAutomaticDialogAttempt({ attempt, clock: deps.nowIso, home });
    if (claim.isErr()) {
      logger.error({ msg: `cmux: ${claim.error.message}` });
    }
  } catch (cause: unknown) {
    logger.error({ msg: `cmux: the dialog check after a timeout threw — ${String(cause)}` });
  }
}

/**
 * The effects a real seat reaches.
 *
 * @returns the deps
 */
export function productionDialogRecoveryDeps(): DialogRecoveryDeps {
  const fleet = fleetPort();
  return {
    append: ({ event, home }) => fleet.appendCmuxReviveEvent({ event, home }),
    dismiss: ({ dismissal }) => dismissCmuxDialog({ dismissal, run: runDialogCommand }),
    nowIso: () => new Date().toISOString(),
    read: () => readCmuxDialogs({ run: runDialogCommand }),
  };
}
