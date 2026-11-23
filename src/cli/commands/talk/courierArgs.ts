/**
 * Every `talk courier` invocation, parsed. There is no `--home` and no `--dir`: the courier types into this machine's
 * pinned chair, so it serves this machine's relays and nothing a test home could hand it.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames } from "./flagValues.js";

/** The flags `talk courier` accepts. */
const COURIER_FLAGS = {
  boolean: ["follow", "once", "json"],
  string: [],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_COURIER_FLAG_NAMES: readonly string[] = flagNames({ spec: COURIER_FLAGS });

/** A flag the tokenizer refused, or a mode that is not exactly one of `--follow` and `--once`. */
interface CourierFlagsInvalidError {
  readonly code: "COURIER_FLAGS_INVALID";
  readonly message: string;
}

/** Every way a `talk courier` invocation is refused. */
export type CourierArgsError = CourierFlagsInvalidError;

/** A parsed `talk courier` invocation. */
export interface CourierArgs {
  /** `follow` runs until stopped; `once` takes what is pending now and exits — the sweep's backstop. */
  readonly mode: "follow" | "once";
  readonly json: boolean;
}

/**
 * Parse a `talk courier` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the usage problem found
 */
export function parseCourierArgs({ rest }: { rest: readonly string[] }): Result<CourierArgs, CourierArgsError> {
  const parsed = parseFlags({ args: rest, spec: COURIER_FLAGS });
  if (parsed.isErr()) {
    return err({ code: "COURIER_FLAGS_INVALID", message: parsed.error.join("; ") });
  }
  const { values } = parsed.value;
  const follow = values["follow"] === true;
  const once = values["once"] === true;
  if (follow === once) {
    return err({ code: "COURIER_FLAGS_INVALID", message: "talk courier takes exactly one of --follow and --once" });
  }
  if (follow && values["json"] === true) {
    return err({
      code: "COURIER_FLAGS_INVALID",
      message: "talk courier --json goes with --once: --follow prints a line per relay",
    });
  }
  let mode: CourierArgs["mode"] = "once";
  if (follow) {
    mode = "follow";
  }
  return ok({ json: values["json"] === true, mode });
}
