/**
 * What every `slopweaver talk` verb ACCEPTS — the flag specs, the usage blocks and the pure parsers.
 *
 * Split from the run modules for the same reason `handover/askRowArgs.ts` is: the help-truth ratchet
 * compares the printed usage against these specs rather than against a second list kept by hand.
 */
import { slopweaverHome } from "../../../config.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { MintMode } from "../../../talk/mintOpener.js";
import {
  DEFAULT_TALK_PLAN_VOICE,
  isPlanVoice,
  type PlanVoice,
  TALK_PLAN_VOICE_NAMES,
} from "../../../talk/planVoices.js";
import { SUPERVISOR_WINDOW_MAX_BYTES } from "../../../talk/supervisorWindow.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { codeFindText } from "./codeFindText.js";
import { flagNames, numberOf, stringOf, stringOr } from "./flagValues.js";
import { type TalkOfferArgsError, TalkOfferArgsErrors } from "./offerArgsErrors.js";

/** The flags `talk offer` accepts. */
const OFFER_FLAGS = {
  boolean: ["json", "reconnect", "rollover", "typed"],
  string: ["voice", "home", "test-instance"],
} satisfies FlagSpec;

/** The flags `talk code` accepts, across all three of its modes. */
const CODE_FLAGS = {
  boolean: ["json"],
  string: ["text", "text-hex", "path", "dir", "from", "max-hits", "budget", "cwd"],
} satisfies FlagSpec;

/** The flags `talk row` accepts. */
const ROW_FLAGS = {
  boolean: ["json"],
  string: ["slug", "dir", "home"],
} satisfies FlagSpec;

/** The flags `talk supervisor` accepts. */
const SUPERVISOR_FLAGS = {
  boolean: ["json"],
  string: ["max-bytes", "session", "home"],
} satisfies FlagSpec;

/** The flags `talk pack` accepts. */
const PACK_FLAGS = {
  boolean: ["json", "write"],
  string: ["home", "dir", "base", "if-older-than"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_PACK_FLAG_NAMES: readonly string[] = flagNames({ spec: PACK_FLAGS });
/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_SUPERVISOR_FLAG_NAMES: readonly string[] = flagNames({ spec: SUPERVISOR_FLAGS });
/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_OFFER_FLAG_NAMES: readonly string[] = flagNames({ spec: OFFER_FLAGS });
/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_CODE_FLAG_NAMES: readonly string[] = flagNames({ spec: CODE_FLAGS });
/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_ROW_FLAG_NAMES: readonly string[] = flagNames({ spec: ROW_FLAGS });

/** The flags `talk check-ins` accepts. */
const CHECK_INS_FLAGS = {
  boolean: ["json"],
  string: ["skip", "home"],
} satisfies FlagSpec;

/** Every flag `talk check-ins` parses, for the help-truth guard. */
export const TALK_CHECK_INS_FLAG_NAMES: readonly string[] = flagNames({ spec: CHECK_INS_FLAGS });

/** A parsed `talk check-ins` invocation. */
export interface CheckInsArgs {
  /** How many rules to pass over — those the voice has already read. */
  readonly skip: number;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk check-ins` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseCheckInsArgs({ rest }: { rest: readonly string[] }): Result<CheckInsArgs> {
  const parsed = parseFlags({ args: rest, spec: CHECK_INS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const skip = numberOf({ fallback: 0, name: "--skip", problems, value: values["skip"] });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ home: stringOf({ value: values["home"] }), json: values["json"] === true, skip });
}

/** A parsed `talk supervisor` invocation. */
export interface SupervisorArgs {
  readonly maxBytes: number;
  readonly session: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * A parsed `talk offer` invocation: the plan voice the call speaks in. The verb prints what the console launches
 * `codex app-server` with and touches no network and no SDP.
 */
export interface OfferArgs {
  readonly voice: PlanVoice;
  /**
   * Why the console is minting: the owner pressing start (`fresh`), re-opening a call that dropped (`--reconnect`),
   * or rolling a long call over in a pause (`--rollover`), so the voice carries on rather than opening fresh.
   */
  readonly mode: MintMode;
  /** Whether this mints the orb messenger's typed conversation rather than a call: the same thread, its words read on screen. */
  readonly typed: boolean;
  /**
   * `e2e` when the desktop test instance placed this call (`--test-instance e2e`, passed only by the console's offer
   * route for an `e2e-voice` press): its reopen reminder is read off the test instance's own previous call, never
   * any call of the owner's. `undefined` on every call of the owner's.
   */
  readonly testInstance: "e2e" | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** Which of `talk code`'s three modes was asked for. */
export type CodeMode = "find" | "read" | "list";

/** A parsed `talk code` invocation. */
export interface CodeArgs {
  readonly mode: CodeMode;
  readonly text: string | undefined;
  readonly path: string | undefined;
  readonly dir: string | undefined;
  readonly from: number;
  readonly maxHits: number;
  readonly budget: number;
  readonly cwd: string | undefined;
  readonly json: boolean;
}

/** A parsed `talk row` invocation. */
export interface RowArgs {
  readonly slug: string;
  readonly dir: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * The default byte window for `talk code read` and `talk file read`, sized so one window's `--json` answer fits the
 * console page's 24 KiB tool cap (`site/components/live/talkSession.ts`'s `TOOL_OUTPUT_MAX`), which refuses an answer
 * over it whole, naming the tool and the cap. JSON escaping at most doubles printable text (`"`, `\` and a line break each become two
 * characters), so 10 KiB of window is at most 20 KiB serialised, and the rest carries the envelope. The residue,
 * every case pathological rather than a page or a source file: a window dense in C0 control characters (NUL
 * included, which `talk code read` does not refuse) escapes six-fold, and one dense in one-character secrets grows
 * as each becomes a `[redacted:…]` label — either can still overflow, and the voice is then told so.
 *
 * MEASURED: at a 256 KiB window a 29,419-byte published page came back as the notice alone, so the voice
 * could not read the Queue card's page the owner was looking at. Repro: `slopweaver talk file read --path
 * ~/.slopweaver/pages/<slug>/index.html --budget 262144 --json | wc -c` on a page over 24 KiB.
 */
export const DEFAULT_CODE_BUDGET = 10_240;

/** The default number of matching files `code find` returns. */
export const DEFAULT_MAX_HITS = 12;

/**
 * Parse a `talk offer` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseOfferArgs({ rest }: { rest: readonly string[] }): Result<OfferArgs, TalkOfferArgsError> {
  const parsed = parseFlags({ args: rest, spec: OFFER_FLAGS });
  if (parsed.isErr()) {
    return err(TalkOfferArgsErrors.flagsUnparsed({ problems: parsed.error }));
  }
  const { values } = parsed.value;
  const voice = stringOr({ fallback: DEFAULT_TALK_PLAN_VOICE, value: values["voice"] });
  if (!isPlanVoice(voice)) {
    return err(TalkOfferArgsErrors.voiceUnknown({ known: TALK_PLAN_VOICE_NAMES, voice }));
  }
  const reconnect = values["reconnect"] === true;
  const rollover = values["rollover"] === true;
  if (reconnect && rollover) {
    return err(TalkOfferArgsErrors.modesContradict());
  }
  let mode: MintMode = "fresh";
  if (reconnect) {
    mode = "reconnect";
  }
  if (rollover) {
    mode = "rollover";
  }
  const typed = values["typed"] === true;
  if (typed && mode !== "fresh") {
    return err(TalkOfferArgsErrors.typedNotACall({ flag: `--${mode}` }));
  }
  const instance = stringOf({ value: values["test-instance"] });
  if (instance !== undefined && instance !== "e2e") {
    return err(TalkOfferArgsErrors.testInstanceUnknown({ value: instance }));
  }
  let testInstance: "e2e" | undefined;
  if (instance === "e2e") {
    testInstance = "e2e";
  }
  return ok({
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    mode,
    testInstance,
    typed,
    voice,
  });
}

/**
 * Parse a `talk code` invocation, including which mode its first positional names.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseCodeArgs({ rest }: { rest: readonly string[] }): Result<CodeArgs> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: CODE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, positionals } = parsed.value;
  const mode = positionals[0];
  if (mode !== "find" && mode !== "read" && mode !== "list") {
    let got = "none";
    if (mode !== undefined) {
      got = mode;
    }
    return err([`talk code needs a mode — find, read or list — got ${got}`]);
  }
  const found = codeFindText({
    hex: stringOf({ value: values["text-hex"] }),
    plain: stringOf({ value: values["text"] }),
  });
  if (found.isErr()) {
    return err([found.error.message]);
  }
  const text = found.value;
  const path = stringOf({ value: values["path"] });
  const problems: string[] = [];
  if (mode === "find" && text === undefined) {
    problems.push("talk code find needs --text <literal>");
  }
  if (mode === "read" && path === undefined) {
    problems.push("talk code read needs --path <repo-relative>");
  }
  const from = numberOf({ fallback: 0, name: "--from", problems, value: values["from"] });
  const maxHits = numberOf({ fallback: DEFAULT_MAX_HITS, name: "--max-hits", problems, value: values["max-hits"] });
  const budget = numberOf({ fallback: DEFAULT_CODE_BUDGET, name: "--budget", problems, value: values["budget"] });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    budget,
    cwd: stringOf({ value: values["cwd"] }),
    dir: stringOf({ value: values["dir"] }),
    from,
    json: values["json"] === true,
    maxHits,
    mode,
    path,
    text,
  });
}

/**
 * Parse a `talk row` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseRowArgs({ rest }: { rest: readonly string[] }): Result<RowArgs> {
  const parsed = parseFlags({ args: rest, spec: ROW_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const slug = stringOf({ value: values["slug"] });
  if (slug === undefined) {
    return err(["talk row needs --slug <board-slug>"]);
  }
  return ok({
    dir: stringOf({ value: values["dir"] }),
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    slug,
  });
}

/**
 * Parse a `talk supervisor` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseSupervisorArgs({ rest }: { rest: readonly string[] }): Result<SupervisorArgs> {
  const parsed = parseFlags({ args: rest, spec: SUPERVISOR_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const maxBytes = numberOf({
    fallback: SUPERVISOR_WINDOW_MAX_BYTES,
    name: "--max-bytes",
    problems,
    value: values["max-bytes"],
  });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    maxBytes,
    session: stringOf({ value: values["session"] }),
  });
}

/** A parsed `talk pack` invocation. */
export interface PackArgs {
  readonly home: string | undefined;
  readonly dir: string | undefined;
  /** The ref whose recent commits are the landings; absent means `origin/main`. */
  readonly base: string | undefined;
  readonly write: boolean;
  /** With `--write`, rebuild only when the stored pack is older than this many minutes; absent always rebuilds. */
  readonly ifOlderThanMinutes: number | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk pack` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parsePackArgs({ rest }: { rest: readonly string[] }): Result<PackArgs> {
  const parsed = parseFlags({ args: rest, spec: PACK_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const write = values["write"] === true;
  const problems: string[] = [];
  let ifOlderThanMinutes: number | undefined;
  if (stringOf({ value: values["if-older-than"] }) !== undefined) {
    ifOlderThanMinutes = numberOf({ fallback: 0, name: "--if-older-than", problems, value: values["if-older-than"] });
    if (problems.length === 0 && ifOlderThanMinutes === 0) {
      problems.push("--if-older-than must be at least 1 minute; leave it off to rebuild every time");
    }
    if (!write) {
      problems.push("--if-older-than decides whether --write rebuilds, so it needs --write");
    }
    if (values["json"] === true) {
      problems.push("--if-older-than may skip the build and so print no pack; drop --json");
    }
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    base: stringOf({ value: values["base"] }),
    dir: stringOf({ value: values["dir"] }),
    home: stringOf({ value: values["home"] }),
    ifOlderThanMinutes,
    json: values["json"] === true,
    write,
  });
}

/**
 * The home a `talk` verb's registers live under.
 *
 * Exported because `talk log` and `talk relay` both resolve it and the two must not drift; the same `if`
 * form as `stringOr` in `flagValues.ts`, and for the same pair of rules.
 *
 * @param home whatever `--home` carried, if anything
 * @returns the flag's directory, or this machine's Slopweaver home
 */
export function talkHomeOf({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}
