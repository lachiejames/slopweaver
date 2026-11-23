/**
 * Argument resolution shared by every `memory` verb, and the one constant they all judge freshness by.
 *
 * Kept out of `./run.ts` so `./hygiene.ts` can reach it without importing `check`/`sweep`/`hook`: the manifest
 * loads a command module per dispatched verb, and a scheduled `hygiene` run that pulled the hook's stdin reader
 * and the owner-directive store in behind it would be paying for three verbs it is not running.
 *
 * Resolution is kept separate from flag PARSING for a reason the help-truth ratchet enforces: the ratchet probes
 * each advertised flag on its own, so a parser that rejected `--json` for lacking `--dir` would fail that probe
 * for a reason that has nothing to do with `--json`.
 */
import { isAbsolute } from "node:path";

import { err, ok, type Result } from "../../../lib/result.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { type MemoryVerbError, MemoryVerbErrors } from "./errors.js";

/**
 * Where a verb's own arguments start: `[node, cli, memory, check, --dir, ...]`, so 4 — the same offset as
 * `codex` and `slack`. A noun whose verbs are all explicitly named never sees its verb token as a positional,
 * and slicing from 3 instead makes the verb name itself look like a stray argument.
 *
 * @internal
 */
export const VERB_ARG_OFFSET = 4;

/**
 * How recently the corpus may have changed before a whole-corpus pass declines to run.
 *
 * Worktrees share one memory directory, so another session can be mid-save when this one starts. Reading the
 * graph then would report an orphan or a double-route that the other session is about to resolve — and for
 * `hygiene`, would propose dropping a memory somebody is in the middle of writing.
 *
 * @internal
 */
export const QUIET_PERIOD_MS = 5_000;

/**
 * Pull a required absolute path out of an already-tokenised flag set.
 *
 * Absolute is required rather than resolved against the cwd, and that is the whole point of the check: a
 * scheduled run fires from whatever directory the recipe happened to be in, so a relative `--repo` would have
 * it measure referents against the wrong tree and report a clean pass.
 *
 * @param parsed the tokenised flags
 * @param key the flag's name without its leading dashes
 * @param why what to tell a caller who omitted it, when there is more to say than "it is required"
 * @returns the path, or the typed refusal
 */
export function requiredAbsolutePath({
  parsed,
  key,
  why,
}: {
  parsed: ParsedFlags;
  key: string;
  why?: string;
}): Result<string, MemoryVerbError> {
  const flag = `--${key}`;
  const value = parsed.values[key];
  if (typeof value !== "string") {
    if (why === undefined) {
      return err(MemoryVerbErrors.missingFlag({ flag, why: "there is no default" }));
    }
    return err(MemoryVerbErrors.missingFlag({ flag, why }));
  }
  return isAbsolute(value) ? ok(value) : err(MemoryVerbErrors.relativePath({ flag, value }));
}

/**
 * Why `--dir` has no default, said once so three verbs cannot drift on it.
 *
 * Claude Code keys auto-memory to the GIT REPOSITORY, so every worktree of a repo shares one directory, and the
 * `<project>` component of that path is undocumented. An earlier design derived it from the working directory:
 * measured against a real machine, that produces a path that does not exist whenever you are in a worktree,
 * which is most of the time.
 *
 * @internal
 */
export const DIR_HAS_NO_DEFAULT = "there is no default: auto-memory is keyed to the repository, not the cwd";

/**
 * Pull the required corpus directory out of an already-tokenised flag set.
 *
 * @param parsed the tokenised flags
 * @returns the directory, or the typed refusal
 */
export function requiredDir({ parsed }: { parsed: ParsedFlags }): Result<string, MemoryVerbError> {
  return requiredAbsolutePath({ key: "dir", parsed, why: DIR_HAS_NO_DEFAULT });
}

/**
 * Read a whole, non-negative number of days from a flag.
 *
 * Absent is `null`, not a default: a threshold nobody asked for would mark rows for a reason the owner never
 * chose, and a mark the owner did not set is a judgement a verb is not allowed to make. A malformed value is an error
 * rather than a silent fallback, for the same reason — a sweep that quietly used 50 days when told
 * `--stale-after ninety` would be reporting against a threshold that appears nowhere.
 *
 * @param parsed the tokenised flags
 * @param key the flag's name without its leading dashes
 * @returns the number of days, `null` when the flag is absent, or the typed refusal
 */
export function optionalWholeDays({
  parsed,
  key,
}: {
  parsed: ParsedFlags;
  key: string;
}): Result<number | null, MemoryVerbError> {
  const raw = parsed.values[key];
  if (raw === undefined) {
    return ok(null);
  }
  const days = typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(days) || days < 0) {
    return err(MemoryVerbErrors.notWholeNumber({ flag: `--${key}`, value: String(raw) }));
  }
  return ok(days);
}
