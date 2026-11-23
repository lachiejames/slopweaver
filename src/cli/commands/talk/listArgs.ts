/**
 * What `slopweaver talk list` and `talk list-add` accept — their flag specs, the names the help-truth ratchet reads,
 * and the pure parsers. The usage lines are in `./listUsage.ts`, a leaf the manifest quotes without loading this.
 */
import { err, ok, type Result } from "#lib/result.js";

import { RUNNING_LIST_ORIGINS, type RunningListOrigin } from "../../../talk/runningList.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, numberOf, stringOf } from "./flagValues.js";

/** The flags `talk list` accepts. */
const LIST_FLAGS = { boolean: ["json", "voice-safe"], string: ["since", "home"] } satisfies FlagSpec;

/** The flags `talk list-add` accepts. */
const LIST_ADD_FLAGS = {
  boolean: ["json"],
  string: ["origin", "from", "label", "id", "fold-line", "home"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_LIST_FLAG_NAMES: readonly string[] = flagNames({ spec: LIST_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_LIST_ADD_FLAG_NAMES: readonly string[] = flagNames({ spec: LIST_ADD_FLAGS });

/** A parsed `talk list` invocation. */
export interface ListArgs {
  /** Answer only items above this number. */
  readonly since: number | undefined;
  /** Mask every item's credentials the way the voice must read them. */
  readonly voiceSafe: boolean;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `talk list-add` invocation; the text comes from stdin, after parsing. */
export interface ListAddArgs {
  readonly origin: RunningListOrigin;
  readonly from: string | undefined;
  readonly label: string | undefined;
  readonly id: string | undefined;
  /** The line of the text its "Show more" starts on, counted from 1; absent, it shows whole. */
  readonly foldLine: number | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk list` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseListArgs({ rest }: { rest: readonly string[] }): Result<ListArgs> {
  const parsed = parseFlags({ args: rest, spec: LIST_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const sinceText = stringOf({ value: values["since"] });
  const since = numberOf({ fallback: 0, name: "--since", problems, value: values["since"] });
  if (sinceText !== undefined && !Number.isSafeInteger(since)) {
    problems.push(`--since must be a non-negative whole number, got ${sinceText}`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    since: sinceText === undefined ? undefined : since,
    voiceSafe: values["voice-safe"] === true,
  });
}

/**
 * Parse a `talk list-add` invocation. The draft's own limits are judged by `runningListDraftOf` once the text is
 * read; this refuses only what is wrong before any I/O.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseListAddArgs({ rest }: { rest: readonly string[] }): Result<ListAddArgs> {
  const parsed = parseFlags({ args: rest, spec: LIST_ADD_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const originText = stringOf({ value: values["origin"] });
  const origin = RUNNING_LIST_ORIGINS.find((candidate) => candidate === originText);
  if (origin === undefined) {
    problems.push(`talk list-add needs --origin ${RUNNING_LIST_ORIGINS.join("|")}`);
  }
  const from = stringOf({ value: values["from"] });
  if (from !== undefined && origin !== "fleet") {
    problems.push("--from names a fleet session, so it goes only with --origin fleet");
  }
  const foldText = stringOf({ value: values["fold-line"] });
  const foldLine = numberOf({ fallback: 0, name: "--fold-line", problems, value: values["fold-line"] });
  if (foldText !== undefined && !Number.isSafeInteger(foldLine)) {
    problems.push(`--fold-line must be a whole line number, got ${foldText}`);
  }
  if (origin === undefined || problems.length > 0) {
    return err(problems);
  }
  return ok({
    foldLine: foldText === undefined ? undefined : foldLine,
    from,
    home: stringOf({ value: values["home"] }),
    id: stringOf({ value: values["id"] }),
    json: values["json"] === true,
    label: stringOf({ value: values["label"] }),
    origin,
  });
}
