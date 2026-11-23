/**
 * Re-exports for the push tests, so one import line does not fan across four modules.
 *
 * `notifyCommandLines` exists because the command builder takes a checked `PushNotice`, and a test that
 * wanted to see the argv had to build one first — which is the notice builder's job, not this test's.
 */
import { type NotifyCommand, notifyCommand } from "../../../hand/push/send.js";

export { buildPushNotice, fitLine } from "../../../hand/push/notice.js";

/**
 * The argv one set of three lines becomes.
 *
 * @param title the banner's first line
 * @param subtitle the second
 * @param body the third
 * @returns the command, exactly as the lane would run it
 */
export function notifyCommandLines({
  title,
  subtitle,
  body,
}: {
  title: string;
  subtitle: string;
  body: string;
}): NotifyCommand {
  return notifyCommand({ notice: { body, subtitle, title } });
}
