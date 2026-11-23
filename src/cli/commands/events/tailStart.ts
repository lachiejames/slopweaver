/**
 * Where an `events tail` run starts reading the supervisor stream — split from `tail.ts` so the cursor rules
 * sit in one place: an explicit `--since` wins, else the named cursor, else the whole stream, and a cursor
 * NAME is checked either way.
 */
import {
  readSupervisorEventCursor,
  SupervisorCursorErrors,
  type SupervisorCursorReadError,
  supervisorEventCursorPath,
} from "../../../events/cursor.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { EventsTailRequest } from "./tail.js";

/**
 * Where this run starts reading: an explicit `--since`, else the named cursor, else the whole stream.
 *
 * @param request the already-resolved request
 * @returns the byte offset to start at, or the refusal when the cursor name or file is unusable
 */
export function resolveStartOffset({
  request,
}: {
  request: Pick<EventsTailRequest, "cursorName" | "home" | "since">;
}): Result<number, SupervisorCursorReadError> {
  // The NAME is checked even when --since skips the read: --since bypasses an untrusted cursor FILE, and
  // this run still writes the cursor back under that name afterwards.
  const named = request.cursorName;
  if (named !== undefined) {
    const path = supervisorEventCursorPath({ home: request.home, name: named });
    if (path.isErr()) {
      return err(SupervisorCursorErrors.nameUnusable({ reasons: path.error }));
    }
  }
  if (request.since !== undefined) {
    return ok(request.since);
  }
  if (request.cursorName === undefined) {
    return ok(0);
  }
  return readSupervisorEventCursor({ home: request.home, name: request.cursorName }).map((cursor) =>
    cursor === undefined ? 0 : cursor.offset,
  );
}
