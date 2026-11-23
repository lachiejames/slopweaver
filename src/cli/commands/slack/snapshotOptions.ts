/**
 * Pure argument handling for the two Slack corpus snapshots — `slack owed` and `slack awaiting` — no clock, no
 * filesystem.
 *
 * Both verbs read the local Slack corpus and, only under `--write`, persist one document under the home; they
 * take the same four flags, so they share one parser rather than two copies that could drift. Neither drafts,
 * posts or sends.
 */

import { parseIsoMs } from "../../../lib/date.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, flagValueOr, parseFlagTail } from "../../optionParsers.js";

/** Every flag either verb accepts, passed straight to {@link parseFlagTail}. */
const SLACK_SNAPSHOT_FLAG_SPEC = {
  boolean: ["json", "write"],
  value: ["now", "home"],
} as const;

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const SLACK_SNAPSHOT_FLAG_NAMES: readonly string[] = [
  ...SLACK_SNAPSHOT_FLAG_SPEC.boolean,
  ...SLACK_SNAPSHOT_FLAG_SPEC.value,
]
  .map((name) => `--${name}`)
  .toSorted();

/** The resolved invocation. */
export interface SlackSnapshotOptions {
  /** The state home to read the corpus from and, under `--write`, persist into. */
  readonly home: string;
  /** Emit exactly one JSON document on stdout. */
  readonly json: boolean;
  /** Atomically replace the verb's one document under `live/slack/`; absent, the verb writes nothing. */
  readonly write: boolean;
  /** The frozen instant from `--now`, normalised to ISO 8601; absent, the shell reads the clock. */
  readonly nowIso?: string;
}

/**
 * Parse a Slack snapshot verb's argv tail.
 *
 * @param rest the argv after the verb
 * @param defaultHome the home to use when `--home` is not passed, resolved once by the shell
 * @returns the resolved options, or one sentence per refusal
 */
export function parseSlackSnapshotOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<SlackSnapshotOptions> {
  const parsed = parseFlagTail({ rest, spec: SLACK_SNAPSHOT_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const base = {
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
    write: parsed.value.flags.has("write"),
  };
  const now = flagValue({ name: "now", parsed: parsed.value });
  if (now === null) {
    return ok(base);
  }
  const ms = parseIsoMs({ tsIso: now });
  if (ms === undefined) {
    return err([`--now must be an ISO 8601 instant, got ${JSON.stringify(now)}`]);
  }
  return ok({ ...base, nowIso: new Date(ms).toISOString() });
}
