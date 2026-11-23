/**
 * What `slopweaver talk cursor-retire` ACCEPTS — its flag spec, its usage refusals and its pure parser. A preview
 * takes no `--source-sha256` or `--reason`; an apply takes both, so nothing is moved without naming the bytes the
 * preview read and why.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { SUPERVISOR_UNREAD_CURSOR } from "../../../talk/unreadCursorStore.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf, stringOr } from "./flagValues.js";

/** The flags `talk cursor-retire` accepts. */
const CURSOR_RETIRE_FLAGS = {
  boolean: ["apply", "json"],
  string: ["cursor", "home", "reason", "source-sha256"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_CURSOR_RETIRE_FLAG_NAMES: readonly string[] = flagNames({ spec: CURSOR_RETIRE_FLAGS });

/** A hex sha256, as the preview prints it. */
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** A flag the tokenizer refused — unknown, a positional, or missing its value; the messages are the tokenizer's own. */
export interface CursorRetireFlagsInvalidError {
  readonly code: "CURSOR_RETIRE_FLAGS_INVALID";
  readonly message: string;
}

/** `--apply` without the digest or the reason it needs. */
export interface CursorRetireApplyIncompleteError {
  readonly code: "CURSOR_RETIRE_APPLY_INCOMPLETE";
  readonly message: string;
}

/** `--source-sha256` or `--reason` given to a preview, which writes nothing and would silently ignore them. */
export interface CursorRetireApplyOnlyError {
  readonly code: "CURSOR_RETIRE_APPLY_ONLY";
  readonly message: string;
}

/** `--source-sha256` is not 64 lowercase hex characters. */
export interface CursorRetireDigestShapeError {
  readonly code: "CURSOR_RETIRE_DIGEST_SHAPE";
  readonly message: string;
}

/** Every way a `talk cursor-retire` invocation is refused before anything is read. */
export type CursorRetireArgsError =
  | CursorRetireFlagsInvalidError
  | CursorRetireApplyIncompleteError
  | CursorRetireApplyOnlyError
  | CursorRetireDigestShapeError;

/** The factories every `talk cursor-retire` usage refusal is constructed through. */
export const CursorRetireArgsErrors = {
  applyIncomplete: (): CursorRetireApplyIncompleteError => ({
    code: "CURSOR_RETIRE_APPLY_INCOMPLETE",
    message:
      "talk cursor-retire --apply needs --source-sha256 <the digest the preview printed> and --reason " +
      '"<what rewrote the call files>"',
  }),
  applyOnly: (): CursorRetireApplyOnlyError => ({
    code: "CURSOR_RETIRE_APPLY_ONLY",
    message: "talk cursor-retire takes --source-sha256 and --reason only with --apply; without it, it only previews",
  }),
  digestShape: ({ given }: { given: string }): CursorRetireDigestShapeError => ({
    code: "CURSOR_RETIRE_DIGEST_SHAPE",
    message: `talk cursor-retire --source-sha256 ${JSON.stringify(given)} is not a sha256: 64 lowercase hex characters`,
  }),
  flagsInvalid: ({ messages }: { messages: readonly string[] }): CursorRetireFlagsInvalidError => ({
    code: "CURSOR_RETIRE_FLAGS_INVALID",
    message: messages.join("; "),
  }),
} as const;

/** A parsed `talk cursor-retire` invocation. */
export interface CursorRetireArgs {
  /** The reader whose cursor is retired — `supervisor` unless named. */
  readonly cursor: string;
  /** What `--apply` names, `undefined` for a preview. */
  readonly apply: { readonly sourceSha256: string; readonly reason: string } | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk cursor-retire` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the first usage problem found
 */
export function parseCursorRetireArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<CursorRetireArgs, CursorRetireArgsError> {
  const parsed = parseFlags({ args: rest, spec: CURSOR_RETIRE_FLAGS });
  if (parsed.isErr()) {
    return err(CursorRetireArgsErrors.flagsInvalid({ messages: parsed.error }));
  }
  const { values } = parsed.value;
  const sourceSha256 = stringOf({ value: values["source-sha256"] });
  const reason = stringOf({ value: values["reason"] });
  const common = {
    cursor: stringOr({ fallback: SUPERVISOR_UNREAD_CURSOR, value: values["cursor"] }),
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
  };
  if (values["apply"] !== true) {
    if (sourceSha256 !== undefined || reason !== undefined) {
      return err(CursorRetireArgsErrors.applyOnly());
    }
    return ok({ ...common, apply: undefined });
  }
  if (sourceSha256 === undefined || reason === undefined || reason.trim() === "") {
    return err(CursorRetireArgsErrors.applyIncomplete());
  }
  if (!SHA256_HEX.test(sourceSha256)) {
    return err(CursorRetireArgsErrors.digestShape({ given: sourceSha256 }));
  }
  return ok({ ...common, apply: { reason, sourceSha256 } });
}
