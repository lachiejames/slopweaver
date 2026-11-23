/**
 * The last chair wake's record, at `$SLOPWEAVER_HOME/talk/chair-wake.json`: where it is kept, how it is read back and
 * written, and why a wake could not be decided or recorded. `./chairWakeShell.ts` reads and writes it under its own
 * lock; this module only holds the file's shape.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { isAbsentError } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import type { ChairWakeRecord } from "./chairWake.js";

/** The store could not be locked: another wake held it past the wait. */
interface ChairWakeLockedError {
  readonly code: "CHAIR_WAKE_LOCKED";
  readonly message: string;
}

/** The call files or the chair's cursor could not be read, so whether anything is unread is not known. */
interface ChairWakeUnreadFailedError {
  readonly code: "CHAIR_WAKE_UNREAD_FAILED";
  readonly message: string;
}

/** The wake record could not be written, so nothing was typed. */
interface ChairWakeStoreFailedError {
  readonly code: "CHAIR_WAKE_STORE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Why `talk wake-chair` could not decide or record a wake. */
export type ChairWakeError = ChairWakeLockedError | ChairWakeUnreadFailedError | ChairWakeStoreFailedError;

/** Builds each {@link ChairWakeError}. */
export const ChairWakeErrors = {
  locked: ({ cause }: { cause: unknown }): ChairWakeLockedError => ({
    code: "CHAIR_WAKE_LOCKED",
    message: `the chair-wake record is locked: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  storeFailed: ({ cause, path }: { cause: unknown; path: string }): ChairWakeStoreFailedError => ({
    code: "CHAIR_WAKE_STORE_FAILED",
    message: `could not write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  unreadFailed: ({ why }: { why: string }): ChairWakeUnreadFailedError => ({
    code: "CHAIR_WAKE_UNREAD_FAILED",
    message: `could not read what the chair has not: ${why}`,
  }),
} as const;

const recordSchema = z.strictObject({
  atIso: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: "not an instant" }),
  // Absent for a batch of held relays alone.
  callId: z.string().min(1).optional(),
  delivery: z.enum(["typed", "queued", "stranded", "unconfirmed", "skipped", "failed", "attempting"]),
  detail: z.string(),
  holder: z.strictObject({ pid: z.number().int().positive(), start: z.string().optional() }).optional(),
  notified: z.record(z.string(), z.number().int().nonnegative()),
  // Absent on a wake written before the quiet batch, which carried no relay: read as carrying none.
  relayTurnIds: z.array(z.string().min(1)).default([]),
});

/**
 * Where the last wake is kept, beside the call files under the state-home contract's `talk/` directory.
 *
 * @param home the Slopweaver home
 * @returns the path
 */
export function chairWakePath({ home }: { home: string }): string {
  return join(dirname(stateHomePaths({ home }).talkTurns), "chair-wake.json");
}

/** The last wake as read: the record, or none — and, for a record that is there but cannot be read, why. */
export interface LastChairWake {
  readonly record: ChairWakeRecord | undefined;
  /** Why a record standing at the path could not be read; `undefined` when it read, or nothing is there. */
  readonly unreadable: string | undefined;
}

/**
 * The last wake. One that cannot be read never holds a wake back, so it reads as none — but says why, so the run
 * reports a broken record rather than silently waking past it.
 *
 * @param path the store
 * @returns the record, or none, and why a record that is there could not be read
 */
export function readLastChairWake({ path }: { path: string }): LastChairWake {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isAbsentError({ error, path })) {
      return { record: undefined, unreadable: undefined };
    }
    return { record: undefined, unreadable: `${path} could not be read: ${String(error)}` };
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "chair wake", text });
  } catch (error) {
    return { record: undefined, unreadable: `${path} is not JSON: ${String(error)}` };
  }
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) {
    return { record: undefined, unreadable: `${path} is not a wake record: ${parsed.error.message}` };
  }
  const { atIso, callId, delivery, detail, holder, notified, relayTurnIds } = parsed.data;
  return {
    record: {
      atIso,
      callId,
      delivery,
      detail,
      holder: holder === undefined ? undefined : { pid: holder.pid, start: holder.start },
      notified,
      relayTurnIds,
    },
    unreadable: undefined,
  };
}

/**
 * Store one wake atomically, owner-only like the call files.
 *
 * @param path the store
 * @param record the wake
 * @returns nothing, or why it could not be written
 */
export function writeChairWake({
  path,
  record,
}: {
  path: string;
  record: ChairWakeRecord;
}): Result<void, ChairWakeError> {
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "chair wake", value: record })}\n`,
      dirMode: 0o700,
      fileMode: 0o600,
      path,
    });
  } catch (cause) {
    return err(ChairWakeErrors.storeFailed({ cause, path }));
  }
  return ok(undefined);
}
