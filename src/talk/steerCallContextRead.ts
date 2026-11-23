/**
 * The read behind a typed steer's call clause (`./steerCallContext.ts` is the pure half): the owner's call words past the
 * supervisor's own unread cursor, read without advancing it — marking them read stays the chair's act.
 */
import { type SteerCallContext, steerCallContextOf } from "./steerCallContext.js";
import { SUPERVISOR_UNREAD_CURSOR } from "./unreadCursorStore.js";
import { readUnread } from "./unreadRead.js";
import { selectUnreadWords } from "./unreadWords.js";

/**
 * What a typed steer's line says about the call it follows. A spoken relay is the call itself, so it reads nothing.
 * A read that fails is said on the line, never silently left out.
 *
 * @param home the state home the calls are under
 * @param nowIso the instant the first-read floor is measured back from
 * @param typed whether the owner typed the steer
 * @returns the context the line carries
 */
export function callContextAtDelivery({
  home,
  nowIso,
  typed,
}: {
  home: string;
  nowIso: string;
  typed: boolean;
}): SteerCallContext {
  if (!typed) {
    return { kind: "none" };
  }
  const read = readUnread({ home, name: SUPERVISOR_UNREAD_CURSOR, nowIso });
  if (read.isErr()) {
    return { kind: "unavailable", why: read.error.message };
  }
  return steerCallContextOf({ selection: selectUnreadWords({ read: read.value }) });
}
