/**
 * What `slopweaver talk land`, `talk cards` and `talk restore` ACCEPT — their flag specs and pure parsers. A file of
 * their own for the reason `./callArgs.ts` gives.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf } from "./flagValues.js";

/** The flags `talk land` accepts. */
const LAND_FLAGS = {
  boolean: ["json"],
  string: ["card", "words", "anchor", "decided", "dir", "home"],
} satisfies FlagSpec;

/** The flags `talk cards` accepts. */
const CARDS_FLAGS = { boolean: ["json"], string: ["home"] } satisfies FlagSpec;

/** The flags `talk restore` accepts. */
const RESTORE_FLAGS = { boolean: ["json"], string: ["card", "anchor", "why", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_LAND_FLAG_NAMES: readonly string[] = flagNames({ spec: LAND_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_CARDS_FLAG_NAMES: readonly string[] = flagNames({ spec: CARDS_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_RESTORE_FLAG_NAMES: readonly string[] = flagNames({ spec: RESTORE_FLAGS });

/** `--`-prefixed, for the help-truth ratchet: `talk steers` takes exactly what `talk cards` does. */
export const TALK_STEERS_FLAG_NAMES: readonly string[] = flagNames({ spec: CARDS_FLAGS });

/** The flags `talk laps` accepts. */
const LAPS_FLAGS = { boolean: ["json", "calibrate"], string: ["since", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_LAPS_FLAG_NAMES: readonly string[] = flagNames({ spec: LAPS_FLAGS });

/** A parsed `talk laps` invocation. */
export interface LapsArgs {
  /** An ISO instant or a span back from now (`14d`, `12h`), or `undefined` for the default fortnight. */
  readonly since: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
  /** Score the card matcher against the words whose card is recorded, instead of reading laps. */
  readonly calibrate: boolean;
}

/**
 * Parse a `talk laps` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseLapsArgs({ rest }: { rest: readonly string[] }): Result<LapsArgs> {
  const parsed = parseFlags({ args: rest, spec: LAPS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  return ok({
    calibrate: values["calibrate"] === true,
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    since: stringOf({ value: values["since"] }),
  });
}

/** A parsed `talk land` invocation. */
export interface LandArgs {
  readonly card: string;
  readonly words: string;
  readonly anchor: string;
  readonly decidedIso: string;
  readonly dir: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `talk cards` invocation. */
export interface CardsArgs {
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `talk restore` invocation. */
export interface RestoreArgs {
  readonly card: string;
  readonly anchor: string;
  readonly why: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk land` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseLandArgs({ rest }: { rest: readonly string[] }): Result<LandArgs> {
  const parsed = parseFlags({ args: rest, spec: LAND_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const card = stringOf({ value: values["card"] });
  const words = stringOf({ value: values["words"] });
  const anchor = stringOf({ value: values["anchor"] });
  const decidedIso = stringOf({ value: values["decided"] });
  const problems: string[] = [];
  if (card === undefined) {
    problems.push("talk land needs --card <kind:id>, the card their words also answer");
  }
  if (words === undefined) {
    problems.push("talk land needs --words <their words>, exactly as the first card carries them");
  }
  if (anchor === undefined) {
    problems.push("talk land needs --anchor <call:…#… | talk:…>, the utterance the words came from");
  }
  if (decidedIso === undefined || Number.isNaN(Date.parse(decidedIso))) {
    problems.push("talk land needs --decided <iso>, the instant they said them");
  }
  if (card === undefined || words === undefined || anchor === undefined || decidedIso === undefined) {
    return err(problems);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    anchor,
    card,
    decidedIso,
    dir: stringOf({ value: values["dir"] }),
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    words,
  });
}

/**
 * Parse a `talk cards` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseCardsArgs({ rest }: { rest: readonly string[] }): Result<CardsArgs> {
  const parsed = parseFlags({ args: rest, spec: CARDS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  return ok({ home: stringOf({ value: values["home"] }), json: values["json"] === true });
}

/**
 * Parse a `talk restore` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseRestoreArgs({ rest }: { rest: readonly string[] }): Result<RestoreArgs> {
  const parsed = parseFlags({ args: rest, spec: RESTORE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const card = stringOf({ value: values["card"] });
  const anchor = stringOf({ value: values["anchor"] });
  const why = stringOf({ value: values["why"] });
  const problems: string[] = [];
  if (card === undefined) {
    problems.push("talk restore needs --card <kind:id>, the card to put back on their queue");
  }
  if (anchor === undefined) {
    problems.push("talk restore needs --anchor <where you decided>, a run, a transcript line or their word");
  }
  if (why === undefined) {
    problems.push("talk restore needs --why <reason>, what the words were really about");
  }
  if (card === undefined || anchor === undefined || why === undefined) {
    return err(problems);
  }
  return ok({ anchor, card, home: stringOf({ value: values["home"] }), json: values["json"] === true, why });
}
