/**
 * What a stop of a plan call may say (`site/app/api/talk/call/[id]/stop/route.ts`): nothing, which is the owner's hang-up,
 * or one line naming why the page ended it — the voice window's renderer dying under the call
 * (`./overlayCrashRecovery.ts`), so the call's end records the crash rather than a hang-up the owner never made. Pure.
 */
import { isCrashWhy } from "./overlayCrashRecovery";

/** The reason a stop with no body records. */
export const HUNG_UP_REASON = "the owner hung up";

/** A stop's body, read: the reason to stop with, or why it is refused. */
export type ParsedTalkCallStop =
  { readonly kind: "stop"; readonly reason: string } | { readonly kind: "refused"; readonly why: string };

/**
 * Read a stop's body: empty or `{}` is the owner's hang-up, `{ reason }` one bounded line, anything else refused.
 *
 * @param raw the request's body text
 * @returns the reason, or why it is refused
 */
export function parseTalkCallStopRequest({ raw }: { raw: string }): ParsedTalkCallStop {
  if (raw.trim() === "") {
    return { kind: "stop", reason: HUNG_UP_REASON };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "refused", why: "the body is not JSON" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "refused", why: "the body is not an object" };
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return { kind: "stop", reason: HUNG_UP_REASON };
  }
  // Its own key, never one inherited: `Object.keys` sees only own keys, and `in` would read a prototype's too.
  const reason: unknown = Object.hasOwn(value, "reason") && "reason" in value ? value.reason : undefined;
  if (keys.length !== 1 || typeof reason !== "string" || !isCrashWhy({ text: reason })) {
    return { kind: "refused", why: "the body carries anything but one reason, a single bounded line" };
  }
  return { kind: "stop", reason };
}
