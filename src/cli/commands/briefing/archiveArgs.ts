/**
 * `briefing archive`'s own flags, usage line and parser.
 *
 * Split out of `./core.ts` on size, along the verb boundary that was already there: `archive` trims a form
 * FILE in place and shares nothing with the other four verbs' arguments — no stdin lane, no projection flag,
 * no page path. It stays out of its runner for the same reason they all do: `helpTruth.test.ts` compares the
 * manifest's literal usage line against the REAL parser rather than against a copy of it.
 */
import { HISTORY_MAX_SECTIONS, SECTION_MAX_NOTES } from "../../../briefing/caps.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { type BriefingCommandError, BriefingCommandErrors } from "./errors.js";

/**
 * `archive`'s flags.
 *
 * @internal — exported for `helpTruth.test.ts`, which compares the manifest's usage line against the real
 * parser rather than a copy of it.
 */
export const BRIEFING_ARCHIVE_FLAGS: FlagSpec = {
  boolean: ["dry-run", "oldest-first"],
  string: ["form", "keep-notes", "keep-sections", "out"],
};

/**
 * Every accepted `archive` flag, WITH the `--`, for the help-truth ratchet.
 *
 * @internal — the ratchet's own input; nothing else names it.
 */
// Destructured defaults rather than `??` at the spread: both halves are present on the literal directly
// above, so neither default can fire — and `FlagSpec` still declares both optional, so the absence has to be
// spelled somewhere a reader sees it rather than folded into an operator.
const { boolean: archiveBooleanFlags = [], string: archiveStringFlags = [] } = BRIEFING_ARCHIVE_FLAGS;

export const BRIEFING_ARCHIVE_FLAG_NAMES: readonly string[] = [...archiveStringFlags, ...archiveBooleanFlags].map(
  (name) => `--${name}`,
);

/**
 * A parsed `briefing archive` invocation.
 *
 * @internal — the shape {@link parseBriefingArchiveArgs} returns and `./archiveRun.ts` reads.
 */
export interface BriefingArchiveArgs {
  /** The form file, rewritten in place. A path, never inline JSON: the whole point is the file it trims. */
  readonly formPath: string;
  /** How many of the newest `earlierToday` notes stay. */
  readonly keepNotes: number;
  /** How many of the newest `history` sections stay. */
  readonly keepSections: number;
  /** Where the overflow is written. Absent means `<form dir>/briefing-archive-<instant>.json`. */
  readonly out: string | undefined;
  /** Report what would move, write nothing. */
  readonly dryRun: boolean;
  /**
   * The form APPENDS, holding its oldest notes first, so the overflow is cut from the start. Absent, the form is
   * read as the supervisor chair's is — newest first — and the overflow comes off the end.
   */
  readonly oldestFirst: boolean;
}

/**
 * Read one `--keep-*` count: a whole number from 1 up to the cap the schema enforces.
 *
 * @param raw the flag's value, absent when it was not passed
 * @param flag the flag name, for the refusal
 * @param cap the schema's own cap, which is both the default and the ceiling
 * @returns the count, or the operator-facing refusal
 */
function parseKeep({
  raw,
  flag,
  cap,
}: {
  raw: string | boolean | undefined;
  flag: string;
  cap: number;
}): Result<number, BriefingCommandError> {
  if (raw === undefined) {
    return ok(cap);
  }
  if (typeof raw !== "string") {
    return err(BriefingCommandErrors.flagValueMissing({ flag }));
  }
  const count = Number.parseInt(raw, 10);
  if (!Number.isInteger(count) || count < 1 || count > cap) {
    return err(BriefingCommandErrors.keepOutOfRange({ cap, flag }));
  }
  return ok(count);
}

/**
 * Parse `briefing archive`'s argv tail.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseBriefingArchiveArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<BriefingArchiveArgs, BriefingCommandError> {
  const parsed = parseFlags({ args: rest, spec: BRIEFING_ARCHIVE_FLAGS });
  if (parsed.isErr()) {
    return err(BriefingCommandErrors.upstreamRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const formPath = typeof values["form"] === "string" ? values["form"] : undefined;
  if (formPath === undefined) {
    return err(BriefingCommandErrors.formFlagMissing({ verb: "archive" }));
  }
  const keepNotes = parseKeep({ cap: SECTION_MAX_NOTES, flag: "--keep-notes", raw: values["keep-notes"] });
  if (keepNotes.isErr()) {
    return err(keepNotes.error);
  }
  const keepSections = parseKeep({ cap: HISTORY_MAX_SECTIONS, flag: "--keep-sections", raw: values["keep-sections"] });
  if (keepSections.isErr()) {
    return err(keepSections.error);
  }
  return ok({
    dryRun: values["dry-run"] === true,
    formPath,
    keepNotes: keepNotes.value,
    keepSections: keepSections.value,
    oldestFirst: values["oldest-first"] === true,
    out: typeof values["out"] === "string" ? values["out"] : undefined,
  });
}
