/** `slopweaver onboard eval` — pure flag parsing for the onboarding self-evaluation scorer. */
import { err, ok, type Result } from "../../../lib/result.js";
import { WORKTREE_SUFFIX } from "../../../worktree/location.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type OnboardError, OnboardErrors } from "./errors.js";

const SPEC: FlagSpec = {
  boolean: ["json", "schema"],
  string: ["eval-home", "file-findings", "repo", "run"],
};

/**
 * The main checkout root a filed finding doc's `repo:` should name, derived from a working directory that
 * may itself be inside a throwaway `cmux spawn` worktree.
 *
 * An evaluation run's own worktree is disposable — `docs/workstreams.md` expects handover docs to name the
 * repository, not one of its worktrees, so a filed finding pointing at a since-closed worktree would be
 * unresolvable by the time anyone reads it.
 *
 * @param cwd the process's current working directory
 * @returns `cwd` with any trailing `.claude/worktrees.noindex/<slug>` (or `.claude/worktrees/<slug>`) stripped
 */
export function mainCheckoutRoot({ cwd }: { cwd: string }): string {
  return cwd.replace(WORKTREE_SUFFIX, "");
}

/** `--`-prefixed flag names, for the help-truth ratchet. */
export const ONBOARD_EVAL_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: SPEC }),
  ...booleanFlagsOf({ spec: SPEC }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** What a valid invocation asks the verb to do. */
export interface OnboardEvalOptions {
  /** Print {@link ../../../onboardEval/runArtifact.ONBOARD_EVAL_RUN_SCHEMA} and exit, reading nothing. */
  readonly schema: boolean;
  /** Path to the run artifact JSON. Required unless {@link schema} is true. */
  readonly runPath: string | undefined;
  /** `--eval-home`, when given; the run file applies {@link ../../../onboardEval/historyStore.defaultEvalHome} otherwise. */
  readonly evalHome: string | undefined;
  readonly fileFindings: number;
  /** `--repo`, when given; the run file applies {@link mainCheckoutRoot} to `process.cwd()` otherwise. */
  readonly repo: string | undefined;
  readonly json: boolean;
}

/**
 * Parse the verb's own flag tail.
 *
 * @param rest arguments after `onboard eval`
 * @returns parsed flags, or every syntax error
 */
export function parseOnboardEvalArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: SPEC });
}

/** Parse `--file-findings`, defaulting to 0 and rejecting anything but a non-negative integer. */
function parseFileFindings({ raw }: { raw: string | boolean | undefined }): Result<number, OnboardError> {
  if (raw === undefined) {
    return ok(0);
  }
  const asNumber = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isInteger(asNumber) && asNumber >= 0
    ? ok(asNumber)
    : err(OnboardErrors.fileFindingsNotNonNegative({ got: String(raw) }));
}

/**
 * Fold parsed flags into the verb's options.
 *
 * @param parsed the syntactically valid flags
 * @returns complete options, or why they were refused
 */
export function onboardEvalOptions({ parsed }: { parsed: ParsedFlags }): Result<OnboardEvalOptions, OnboardError> {
  const schema = parsed.values["schema"] === true;
  const runPath =
    typeof parsed.values["run"] === "string" && parsed.values["run"].length > 0 ? parsed.values["run"] : undefined;
  const fileFindings = parseFileFindings({ raw: parsed.values["file-findings"] });
  if (fileFindings.isErr()) {
    return err(fileFindings.error);
  }
  if (!schema && runPath === undefined) {
    return err(OnboardErrors.runMissing());
  }
  const evalHomeFlag = parsed.values["eval-home"];
  const repoFlag = parsed.values["repo"];
  return ok({
    evalHome: typeof evalHomeFlag === "string" && evalHomeFlag.length > 0 ? evalHomeFlag : undefined,
    fileFindings: fileFindings.value,
    json: parsed.values["json"] === true,
    repo: typeof repoFlag === "string" && repoFlag.length > 0 ? repoFlag : undefined,
    runPath,
    schema,
  });
}
