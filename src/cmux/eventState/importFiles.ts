/**
 * The one-time import's file half: reading the home's two retired files and deciding what `session watch` adopts.
 *
 * Pure apart from the one injected read, so the store orchestration in `./storePort.ts` stays about rows. The pair
 * is imported whole or not at all — a cursor without its fold skips every event before it, a fold without its
 * cursor replays them all — and an imported fold resumes from its own high-water mark rather than the cursor file,
 * which the old `cmux events` could push past events the fold never saw.
 */
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { stateHomePaths } from "../../stateHome.js";

import { activitiesOfFile, decodeCursorFile, decodeSessionActivities, type SessionActivities } from "./decode.js";
import {
  type CmuxEventImportUnreadableError,
  type CmuxEventStateError,
  CmuxEventStateErrors,
  describeCmuxEventCause,
} from "./errors.js";

/** One import file's text; undefined when it is not there, a refusal when it is and cannot be read. */
export type ReadImportText = (request: {
  readonly path: string;
}) => Result<string | undefined, CmuxEventImportUnreadableError>;

/**
 * The fold the activity file carries, parsed as far as its envelope.
 *
 * @param text the activity file's contents
 * @returns the raw fold, or the problems with the envelope
 */
function rawFoldOfText({ text }: { text: string }): Result<unknown> {
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: "the cmux session-activity import file", text });
  } catch (cause) {
    return err([`the activity file: it is not JSON a reader can take (${describeCmuxEventCause({ cause })})`]);
  }
  return activitiesOfFile({ decoded });
}

/**
 * The last sequence a fold actually applied: the greatest `lastSeq` among its sessions, 0 when it holds none.
 *
 * This, not the old cursor file, is where an imported `session watch` resumes. The fold never prunes and every
 * event it applies stamps its session's `lastSeq`, so no event past this mark was folded into any session the
 * fold still holds — while the shared cursor file may stand past it, moved there by the old `cmux events`.
 *
 * @param activities the decoded fold
 * @returns the sequence to resume after
 */
function foldHighWater({ activities }: { activities: SessionActivities }): number {
  return Object.values(activities).reduce((highest, activity) => Math.max(highest, activity.lastSeq), 0);
}

/**
 * The pair `session watch` imports, decoded: both files, or neither, or why not.
 *
 * @param home the home whose files are read
 * @param readImportText where the reads come from
 * @returns the cursor and fold to insert, undefined when neither file is there, or the refusal
 */
export function sessionImport({
  home,
  readImportText,
}: {
  home: string;
  readImportText: ReadImportText;
}): Result<{ readonly cursorSeq: number; readonly activities: SessionActivities } | undefined, CmuxEventStateError> {
  const paths = stateHomePaths({ home });
  const cursorText = readImportText({ path: paths.cmuxEventCursorJson });
  if (cursorText.isErr()) {
    return err(cursorText.error);
  }
  const foldText = readImportText({ path: paths.cmuxSessionActivityJson });
  if (foldText.isErr()) {
    return err(foldText.error);
  }
  if (cursorText.value === undefined && foldText.value === undefined) {
    return ok(undefined);
  }
  const invalid = ({ problems }: { problems: readonly string[] }): Result<never, CmuxEventStateError> =>
    err(CmuxEventStateErrors.importInvalid({ consumer: "session-watch", problems }));
  if (foldText.value === undefined) {
    return invalid({
      problems: [
        `${paths.cmuxEventCursorJson} is there without ${paths.cmuxSessionActivityJson}, so the events before its cursor were never folded`,
      ],
    });
  }
  if (cursorText.value === undefined) {
    return invalid({
      problems: [
        `${paths.cmuxSessionActivityJson} is there without ${paths.cmuxEventCursorJson}, so resuming would fold its events a second time`,
      ],
    });
  }
  const cursorSeq = decodeCursorFile({ text: cursorText.value });
  const rawFold = rawFoldOfText({ text: foldText.value });
  const problems = [...(cursorSeq.isErr() ? cursorSeq.error : []), ...(rawFold.isErr() ? rawFold.error : [])];
  if (cursorSeq.isErr() || rawFold.isErr()) {
    return invalid({ problems });
  }
  const activities = decodeSessionActivities({ activities: rawFold.value, cursorSeq: cursorSeq.value });
  if (activities.isErr()) {
    return invalid({ problems: activities.error });
  }
  return ok({ activities: activities.value, cursorSeq: foldHighWater({ activities: activities.value }) });
}
