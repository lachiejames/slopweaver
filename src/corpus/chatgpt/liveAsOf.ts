/**
 * The instant `chatgpt live-sync` last certified the live copy current as of: `<live root>/as-of.json`, beside the
 * `snapshots/` directory, written only by a run that held every chat its listing named at the listed update and
 * whose refresh then succeeded, and read by the scheduled resync that ran it (`live/resync/clock.ts`).
 *
 * **Why the listing's start, never the run's finish.** A backfill takes hours. A chat updated after the listing named it
 * can be missed by that run, so the only instant the run can honestly certify is the one its listing began at: every
 * chat that existed then, at the update it had then, is held. A run that stopped, or was cut short by
 * `--max-conversations`, certifies nothing and leaves the previous record standing, so the freshness page ages.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { parseSmallJson } from "./exportReceipts.js";
import { type ChatgptSnapshotError, ChatgptSnapshotErrors } from "./liveSnapshotStore.errors.js";

const liveAsOfSchema = z.strictObject({
  asOfIso: z.iso.datetime(),
  schemaVersion: z.literal(1),
});

/** Where the record sits: the live copy's root, beside `snapshots/`, which every snapshot read lists alone. */
function liveAsOfPath({ root }: { root: string }): string {
  return join(root, "as-of.json");
}

/**
 * Record the instant a live sync certified the live copy current as of: the last thing a completed run writes.
 *
 * @param root the live copy's root, `CorpusPaths.chatgptLive`
 * @param asOfIso the instant the run's listing began
 * @returns nothing, or why the record could not be written
 */
export function writeLiveAsOf({
  root,
  asOfIso,
}: {
  root: string;
  asOfIso: string;
}): Result<void, ChatgptSnapshotError> {
  const path = liveAsOfPath({ root });
  try {
    writeFileAtomic({
      contents: `${JSON.stringify({ asOfIso, schemaVersion: 1 })}\n`,
      dirMode: 0o700,
      fileMode: 0o600,
      path,
    });
    return ok(undefined);
  } catch (error: unknown) {
    return err(
      ChatgptSnapshotErrors.writeFailed({ detail: error instanceof Error ? error.message : String(error), path }),
    );
  }
}

/**
 * The instant the last completed live sync certified, `undefined` when no run has completed yet.
 *
 * @param root the live copy's root, `CorpusPaths.chatgptLive`
 * @returns the instant, `undefined` when the record is genuinely absent, or why a record that is there cannot be believed
 */
export function readLiveAsOf({ root }: { root: string }): Result<string | undefined, ChatgptSnapshotError> {
  const path = liveAsOfPath({ root });
  let text: string;
  try {
    if (!lstatSync(path).isFile()) {
      return err(ChatgptSnapshotErrors.unreadable({ problems: [`${path} is not a regular file`], root }));
    }
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (isAbsentError({ error, path })) {
      return ok(undefined);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err(ChatgptSnapshotErrors.unreadable({ problems: [`${path} will not read (${detail})`], root }));
  }
  const parsed = liveAsOfSchema.safeParse(parseSmallJson({ text }));
  if (!parsed.success) {
    return err(ChatgptSnapshotErrors.unreadable({ problems: [`${path} is not a record this writes`], root }));
  }
  return ok(parsed.data.asOfIso);
}
