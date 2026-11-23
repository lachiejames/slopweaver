/**
 * The repeat guard's seams for a test whose subject is something else — a Slack write contract recorded in a
 * cassette, or a replay proving a different refusal. Neither recorded the guard's own `auth.test` and history
 * reads, so the guard is passed through with its hatch open and reads nothing. The guard itself is proved in
 * `unit/corpus/slack/writeGuardRepeat.test.ts`.
 */
import type { RepeatGuardSeams } from "../corpus/slack/writeGuardRepeat.js";
import { err } from "../lib/result.js";

/** An open hatch, so no place is read; a read reaching here is a defect and says so. */
export const REPEAT_GUARD_OUT_OF_SCOPE: RepeatGuardSeams = {
  hatchIsOpen: () => true,
  nowMs: () => 0,
  readPlace: async () => err("the repeat guard is out of this test's scope, so nothing should read a place"),
};
