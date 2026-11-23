/**
 * What `slopweaver talk meeting-due` accepts — its flag spec, the names the help-truth ratchet reads, and the pure
 * parser. The usage line is in `./knowUsage.ts`, a leaf the manifest quotes without loading this.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf } from "./flagValues.js";
import { type MeetingDueArgsError, MeetingDueArgsErrors } from "./meetingDueArgsErrors.js";

/** The flags `talk meeting-due` accepts. */
const MEETING_DUE_FLAGS = { boolean: ["json"], string: ["now", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_MEETING_DUE_FLAG_NAMES: readonly string[] = flagNames({ spec: MEETING_DUE_FLAGS });

/** A parsed `talk meeting-due` invocation. */
export interface MeetingDueArgs {
  /** The instant judged at, in ms; `undefined` means the clock's now. */
  readonly nowMs: number | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk meeting-due` invocation; `--now` is judged here, so a malformed instant is refused before any read.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the refusal
 */
export function parseMeetingDueArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<MeetingDueArgs, MeetingDueArgsError> {
  const parsed = parseFlags({ args: rest, spec: MEETING_DUE_FLAGS });
  if (parsed.isErr()) {
    return err(MeetingDueArgsErrors.flagsInvalid({ messages: parsed.error }));
  }
  const { values } = parsed.value;
  const now = stringOf({ value: values["now"] });
  let nowMs: number | undefined;
  if (now !== undefined) {
    nowMs = parseStrictIsoInstantMs({ text: now });
    if (nowMs === undefined) {
      return err(MeetingDueArgsErrors.nowInvalid({ now }));
    }
  }
  return ok({ home: stringOf({ value: values["home"] }), json: values["json"] === true, nowMs });
}
