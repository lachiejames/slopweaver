/**
 * What `slopweaver talk file` ACCEPTS — its flag spec, its typed usage errors and the pure parser. Its own module,
 * like `./verbArgs.ts`, so `./args.ts` does not grow and the help-truth ratchet reads one spec.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { DEFAULT_CODE_BUDGET } from "./args.js";
import { flagNames, numberOf, stringOf } from "./flagValues.js";

/** The flags `talk file` accepts, across both of its modes. */
const FILE_FLAGS = {
  boolean: ["json", "words"],
  string: ["path", "dir", "from", "budget", "limit", "home"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_FILE_FLAG_NAMES: readonly string[] = flagNames({ spec: FILE_FLAGS });

/** The most entries `talk file list` returns unless asked for fewer. */
export const DEFAULT_LIST_LIMIT = 500;

/** A parsed `talk file` invocation. */
export interface FileArgs {
  readonly mode: "read" | "list";
  /** The path to read, or the directory to list. */
  readonly target: string;
  readonly from: number;
  readonly budget: number;
  readonly limit: number;
  readonly home: string | undefined;
  readonly json: boolean;
  /** Read an HTML page as its words, masked after the markup is gone (`src/talk/pageWordsRead.ts`). */
  readonly words: boolean;
}

/** A `talk file` invocation refused before anything is read. */
export interface TalkFileArgsError {
  readonly code: "FLAGS_UNPARSED" | "MODE_MISSING" | "TARGET_MISSING";
  readonly message: string;
}

/** The factories for {@link TalkFileArgsError}. */
export const TalkFileArgsErrors = {
  flagsUnparsed: ({ problems }: { problems: readonly string[] }): TalkFileArgsError => ({
    code: "FLAGS_UNPARSED",
    message: problems.join("\n"),
  }),
  modeMissing: ({ got }: { got: string }): TalkFileArgsError => ({
    code: "MODE_MISSING",
    message: `talk file needs a mode — read or list — got ${got}`,
  }),
  targetMissing: ({ mode }: { mode: "read" | "list" }): TalkFileArgsError => ({
    code: "TARGET_MISSING",
    message:
      mode === "read"
        ? "talk file read needs --path <absolute|~/path>"
        : "talk file list needs --dir <absolute|~/path>",
  }),
} as const;

/**
 * Parse a `talk file` invocation, including which mode its first positional names.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the usage problem that refused them
 */
export function parseFileArgs({ rest }: { rest: readonly string[] }): Result<FileArgs, TalkFileArgsError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: FILE_FLAGS });
  if (parsed.isErr()) {
    return err(TalkFileArgsErrors.flagsUnparsed({ problems: parsed.error }));
  }
  const { values, positionals } = parsed.value;
  const mode = positionals[0];
  if (mode !== "read" && mode !== "list") {
    return err(TalkFileArgsErrors.modeMissing({ got: String(mode) }));
  }
  const target = stringOf({ value: mode === "read" ? values["path"] : values["dir"] });
  if (target === undefined) {
    return err(TalkFileArgsErrors.targetMissing({ mode }));
  }
  const problems: string[] = [];
  const from = numberOf({ fallback: 0, name: "--from", problems, value: values["from"] });
  const budget = numberOf({ fallback: DEFAULT_CODE_BUDGET, name: "--budget", problems, value: values["budget"] });
  const limit = numberOf({ fallback: DEFAULT_LIST_LIMIT, name: "--limit", problems, value: values["limit"] });
  if (problems.length > 0) {
    return err(TalkFileArgsErrors.flagsUnparsed({ problems }));
  }
  return ok({
    budget,
    from,
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    limit,
    mode,
    target,
    words: values["words"] === true,
  });
}
