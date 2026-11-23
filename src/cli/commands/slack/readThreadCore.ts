/**
 * Pure argument handling for `slack read-thread`. Parsing is separated from the shell so the flag surface
 * is unit-testable without a token, a network or a filesystem — and so `helpTruth` can import the flag list
 * and prove `--help` names exactly what the verb accepts.
 */

import { err, ok } from "../../../lib/result.js";
import { isSlackTimestamp } from "../../../live/slack/selection.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type SlackRead, SlackReadErrors } from "./readErrors.js";

/** Every flag this verb accepts; the help-truth ratchet checks the names derived from it below. */
const SLACK_READ_THREAD_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["around", "channel-around", "home", "max-file-mb", "since"],
};

/**
 * Every flag NAME, derived from the spec rather than re-listed — so the help-truth ratchet compares the
 * usage string against what the parser genuinely accepts, and the two cannot drift apart.
 */
export const SLACK_READ_THREAD_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: SLACK_READ_THREAD_FLAGS }),
  ...stringFlagsOf({ spec: SLACK_READ_THREAD_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The resolved invocation. */
export interface SlackReadThreadOptions {
  readonly permalink: string;
  readonly json: boolean;
  readonly maxFileBytes: number | undefined;
  readonly home: string | undefined;
  /** Replies to return on each side of the addressed message. */
  readonly around: number | undefined;
  /** Channel-visible summaries to return on each side of the parent. */
  readonly channelAround: number | undefined;
  /** The `--since` anchor, already proven to be a Slack timestamp. Absent means read the whole thread. */
  readonly sinceTs: string | undefined;
}

/**
 * Parse the verb's arguments.
 *
 * @param rest the argv tail after `slack read-thread`
 * @returns the resolved options, or `err` with every usage problem found
 */
export function parseSlackReadThreadArgs({ rest }: { rest: readonly string[] }): SlackRead<SlackReadThreadOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SLACK_READ_THREAD_FLAGS });
  if (parsed.isErr()) {
    return err(SlackReadErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, positionals } = parsed.value;
  if (positionals.length === 0) {
    return err(SlackReadErrors.permalinkMissing());
  }
  if (positionals.length > 1) {
    return err(SlackReadErrors.permalinkCount({ permalinks: positionals }));
  }
  const maxFileBytes = parseMaxFileBytes({ raw: values["max-file-mb"] });
  if (maxFileBytes.isErr()) {
    return err(maxFileBytes.error);
  }
  const sinceTs = parseSinceTs({ raw: values["since"] });
  if (sinceTs.isErr()) {
    return err(sinceTs.error);
  }
  const around = parseContextRadius({ flag: "--around", raw: values["around"] });
  if (around.isErr()) {
    return err(around.error);
  }
  const channelAround = parseContextRadius({ flag: "--channel-around", raw: values["channel-around"] });
  if (channelAround.isErr()) {
    return err(channelAround.error);
  }
  if (sinceTs.value !== undefined && (around.value !== undefined || channelAround.value !== undefined)) {
    return err(SlackReadErrors.sinceContextConflict());
  }
  const home = typeof values["home"] === "string" ? values["home"] : undefined;
  return ok({
    around: around.value,
    channelAround: channelAround.value,
    home,
    json: values["json"] === true,
    maxFileBytes: maxFileBytes.value,
    permalink: positionals[0]!,
    sinceTs: sinceTs.value,
  });
}

/**
 * Parse one agent-selected context radius without imposing a product heuristic on its maximum.
 *
 * @param flag the flag name, for a precise refusal
 * @param raw the parser value
 * @returns a non-negative safe integer, or undefined when absent
 */
function parseContextRadius({
  flag,
  raw,
}: {
  flag: "--around" | "--channel-around";
  raw: string | boolean | undefined;
}): SlackRead<number | undefined> {
  if (raw === undefined) {
    return ok(undefined);
  }
  if (typeof raw !== "string") {
    return err(SlackReadErrors.valueMissing({ flag }));
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    return err(SlackReadErrors.contextRadiusInvalid({ flag, got: raw }));
  }
  return ok(value);
}

/**
 * Validate `--since`, refusing anything that is not a Slack timestamp BEFORE any network call.
 *
 * Refused rather than ignored, and refused HERE rather than after the fetch, because both alternatives are
 * worse in the same way: a `--since` the caller believes narrowed the result but did not is a silent
 * behaviour change, and spending a Slack read to reject an argument contradicts how `--max-file-mb` and a
 * malformed permalink already behave.
 *
 * @param raw the flag value, when supplied
 * @returns the anchor timestamp, or undefined when the flag was absent
 */
function parseSinceTs({ raw }: { raw: string | boolean | undefined }): SlackRead<string | undefined> {
  if (raw === undefined) {
    return ok(undefined);
  }
  if (typeof raw !== "string") {
    return err(SlackReadErrors.valueMissing({ flag: "--since" }));
  }
  if (!isSlackTimestamp({ value: raw })) {
    return err(SlackReadErrors.sinceInvalid({ got: raw }));
  }
  return ok(raw);
}

/**
 * Convert `--max-file-mb` to bytes, refusing a value that is not a positive number rather than silently
 * falling back to the default (a cap the caller thinks they set but did not is a silent behaviour change).
 *
 * @param raw the flag value, when supplied
 * @returns the byte ceiling, or undefined when the flag was absent
 */
export function parseMaxFileBytes({ raw }: { raw: string | boolean | undefined }): SlackRead<number | undefined> {
  if (raw === undefined) {
    return ok(undefined);
  }
  if (typeof raw !== "string") {
    return err(SlackReadErrors.valueMissing({ flag: "--max-file-mb" }));
  }
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb <= 0) {
    return err(SlackReadErrors.maxFileMbInvalid({ got: raw }));
  }
  return ok(Math.floor(mb * 1024 * 1024));
}
