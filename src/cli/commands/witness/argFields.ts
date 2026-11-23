/**
 * The field readers every `witness` verb's parser shares: a string flag, a required one, a Slack ts, the coordinate
 * triple, the common tail and the one positional witness id. Split out of `./args.ts` under the file-size cap along
 * the line between reading ONE field (here) and composing a verb's options from them (there). Pure, like its caller:
 * each reader records what is wrong in `problems` rather than stopping, so a parse reports every reason at once.
 */
import { SLACK_TS_PATTERN, type WitnessKey } from "../../../live/witness/types.js";

/** A witness id as `witnessIdOf` mints it. */
const WITNESS_ID_PATTERN = /^w-[0-9a-f]{16}$/;

/**
 * A string flag's value.
 *
 * @returns the value, or `undefined` when it was not passed
 */
export function stringOf({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * A required non-blank string flag, recording the problem when it is absent or blank.
 *
 * @param why what the flag carries, quoted in the problem
 * @returns the value, or `undefined` once the problem is recorded
 */
export function requiredOf({
  values,
  name,
  problems,
  why,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
  problems: string[];
  why: string;
}): string | undefined {
  const value = stringOf({ name, values });
  if (value === undefined || value.trim().length === 0) {
    problems.push(`--${name} is required — ${why}`);
    return undefined;
  }
  return value;
}

/**
 * A Slack ts flag, recording the problem when it is not shaped like one.
 *
 * @returns the ts, or `undefined` when absent or malformed
 */
export function tsOf({
  values,
  name,
  problems,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
  problems: string[];
}): string | undefined {
  const value = stringOf({ name, values });
  if (value === undefined) {
    return undefined;
  }
  if (!SLACK_TS_PATTERN.test(value)) {
    problems.push(`--${name} must be a Slack ts like 1789000000.000100, got "${value}"`);
    return undefined;
  }
  return value;
}

/**
 * The complete coordinate triple, or the problems with it.
 *
 * @param required whether a parse with none of the three given is itself a problem
 * @returns the key, or `undefined` — with no problem recorded when none was given and none is required
 */
export function keyOf({
  values,
  problems,
  required,
}: {
  values: Readonly<Record<string, string | boolean>>;
  problems: string[];
  required: boolean;
}): WitnessKey | undefined {
  const given = ["channel", "thread-ts", "message-ts"].filter((name) => stringOf({ name, values }) !== undefined);
  if (given.length === 0 && !required) {
    return undefined;
  }
  const before = problems.length;
  const channel = requiredOf({ name: "channel", problems, values, why: "the witnessed message's channel id" });
  const threadTs = tsOf({ name: "thread-ts", problems, values });
  const messageTs = tsOf({ name: "message-ts", problems, values });
  if (stringOf({ name: "thread-ts", values }) === undefined) {
    problems.push("--thread-ts is required — the thread the witnessed message sits in");
  }
  if (stringOf({ name: "message-ts", values }) === undefined) {
    problems.push("--message-ts is required — the witnessed message's own ts");
  }
  if (problems.length > before || channel === undefined || threadTs === undefined || messageTs === undefined) {
    return undefined;
  }
  return { channel, messageTs, threadTs };
}

/**
 * The common tail every verb shares.
 *
 * @returns the `--home` and `--json` values
 */
export function commonOf({ values }: { values: Readonly<Record<string, string | boolean>> }): {
  home: string | undefined;
  json: boolean;
} {
  return { home: stringOf({ name: "home", values }), json: values["json"] === true };
}

/**
 * The one positional witness id, recording what is wrong with it.
 *
 * @returns the id, or `undefined` when none was given or it is malformed
 */
export function witnessIdOfPositionals({
  positionals,
  problems,
}: {
  positionals: readonly string[];
  problems: string[];
}): string | undefined {
  const [first, ...extra] = positionals;
  if (extra.length > 0) {
    problems.push("one witness id at a time");
    return undefined;
  }
  if (first === undefined) {
    return undefined;
  }
  if (!WITNESS_ID_PATTERN.test(first)) {
    problems.push(`"${first}" is not a witness id — they look like w-0123456789abcdef (slopweaver witness list)`);
    return undefined;
  }
  return first;
}
