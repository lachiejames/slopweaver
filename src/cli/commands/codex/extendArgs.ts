/**
 * The argument surface of `slopweaver codex extend`: its usage, its flags, and the checks a grant's flags pass
 * before anything is read. A usage problem is refused here, before the register, the pin or the journal is opened.
 */
import { isFullSha256, isReviewLane, legibleText } from "../../../codex/passExtension.js";
import type { ReviewLane } from "../../../codex/reviewLane.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec, ParsedFlags } from "../../parseFlags.js";
import { parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** The flags `codex extend` accepts. Names omit the leading `--`, which is what `parseFlags` expects. */
const EXTEND_FLAGS: FlagSpec = {
  boolean: ["list"],
  string: ["run", "lane", "diff", "after", "reason", "branch", "repo", "home"],
};

/** The same flags, `--`-prefixed, for the help-truth ratchet. Derived rather than retyped. */
export const CODEX_EXTEND_FLAG_NAMES: readonly string[] = [
  "--list",
  ...[...stringFlagsOf({ spec: EXTEND_FLAGS })].map((name) => `--${name}`),
].toSorted();

/** Usage for `codex extend`, kept beside the parser so `--help` and the parser share one string. */
export const CODEX_EXTEND_USAGE =
  "usage: slopweaver codex extend --run <slug> --lane general|baseline-bump-witness --diff <sha256> --reason <text>\n" +
  "                               [--after <id>] [--repo <dir>] [--home <dir>]\n" +
  "       slopweaver codex extend --list [--branch <name>] [--home <dir>]\n" +
  "\n" +
  "The pinned supervisor approves ONE exact diff to review past the two-pass cap, for one run's branch in one lane.\n" +
  "The branch is read from the run's journal, never typed. A review of that diff is admitted and names the row; a\n" +
  "later fix is a new diff, refused again. One extension per run and lane: each further one names the last with\n" +
  "--after and carries its own reason. It records the hash it is given and computes none, so read that diff\n" +
  "yourself before granting. Refused for every session but the pinned supervisor: a seat never grants itself a\n" +
  "pass, and sends the supervisor one line instead. Reach the owner only on a big trade-off in the approach.\n" +
  "\n" +
  "  --run <slug>      the handover run the extra pass is for\n" +
  "  --lane <lane>     general, or baseline-bump-witness for a ratchet bump's witness review\n" +
  "  --diff <sha256>   the full sha256 of the diff the cap refused, exactly as the refusal printed it\n" +
  "  --reason <text>   why this pass earns its cost; printed beside the pass it admits\n" +
  "  --after <id>      the run's latest extension in this lane, required on every one after the first\n" +
  "  --repo <dir>      the run's checkout, when its journal names no launched worktree\n" +
  "  --list            print every recorded extension (filter by the recorded --branch name)";

/**
 * Parse `codex extend` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseCodexExtendArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: EXTEND_FLAGS });
}

/**
 * One declared string flag, trimmed.
 *
 * @param parsed the flags `parseCodexExtendArgs` returned
 * @param name the flag, without its leading `--`
 * @returns the value, or `undefined` when it is absent or blank
 */
export function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

/** What one grant asks for, every field checked. */
export interface ExtendGrantArgs {
  readonly run: string;
  readonly lane: ReviewLane;
  readonly diff: string;
  readonly reason: string;
  readonly after: string | undefined;
  readonly repo: string | undefined;
}

/** A grant's flags refused as usage, and whether the usage text helps the caller. */
interface ExtendUsageProblem {
  readonly message: string;
  readonly showUsage: boolean;
}

/**
 * Check a grant's flags before anything is read.
 *
 * @param parsed the flags `parseCodexExtendArgs` returned
 * @returns the grant's arguments, or the usage problem to print
 */
export function extendGrantArgs({ parsed }: { parsed: ParsedFlags }): Result<ExtendGrantArgs, ExtendUsageProblem> {
  const run = stringFlag({ name: "run", parsed });
  const lane = stringFlag({ name: "lane", parsed });
  const diff = stringFlag({ name: "diff", parsed });
  const reason = stringFlag({ name: "reason", parsed });
  const legibleReason = reason !== undefined && legibleText({ text: reason });
  if (run === undefined || lane === undefined || diff === undefined || reason === undefined || !legibleReason) {
    return err({
      message:
        "codex extend: --run <slug>, --lane <lane>, --diff <sha256> and a legible --reason <text> are all required",
      showUsage: true,
    });
  }
  if (!isReviewLane(lane)) {
    return err({
      message: `codex extend: --lane ${lane} is not a review lane (general or baseline-bump-witness)`,
      showUsage: false,
    });
  }
  if (!isFullSha256(diff)) {
    return err({
      message: `codex extend: --diff ${diff} is not a full lowercase sha256 — copy the one the cap's refusal printed`,
      showUsage: false,
    });
  }
  const after = stringFlag({ name: "after", parsed });
  return ok({ after, diff, lane, reason, repo: stringFlag({ name: "repo", parsed }), run });
}
