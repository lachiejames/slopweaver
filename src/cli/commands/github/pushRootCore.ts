/**
 * `slopweaver github push-root`'s pure half: the argv parse, the check that a recorded root really is a
 * parentless commit, and the lines the verb prints. The effectful shell is `./pushRootRun.ts`.
 */
import { isPushRootRepository, isPushRootSha, type PushRootBinding } from "../../../admit/pushRootRegistry.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail, requiredFlagValue } from "../../optionParsers.js";
import { GITHUB_PUSH_ROOT_USAGE, type RecutArgsError, RecutArgsErrors } from "./repositoryRecutUsage.js";

/** `record`'s flags: `list` takes the `json`/`home` subset of the same names. */
const RECORD_SPEC = { boolean: ["dry-run", "json"], value: ["repo", "root", "cwd", "home"] } as const;

/** Every flag either sub-command accepts, as the help-truth sweep reads them. */
export const GITHUB_PUSH_ROOT_FLAG_NAMES: readonly string[] = [...RECORD_SPEC.value, ...RECORD_SPEC.boolean].map(
  (name) => `--${name}`,
);

/** What one invocation asked for. `home` and `cwd` are `undefined` when not passed; the shell resolves them. */
export type PushRootArgs =
  | {
      readonly kind: "record";
      readonly repository: string;
      readonly rootSha: string;
      readonly cwd: string | undefined;
      readonly dryRun: boolean;
      readonly json: boolean;
      readonly home: string | undefined;
    }
  | { readonly kind: "list"; readonly json: boolean; readonly home: string | undefined };

/**
 * The refusal for `push-root`, its usage last.
 *
 * @param problems every line naming what was wrong
 * @returns the typed usage error
 */
function usageError({ problems }: { problems: readonly string[] }): RecutArgsError {
  return RecutArgsErrors.usage({ problems, usage: GITHUB_PUSH_ROOT_USAGE });
}

/**
 * Parse `list`'s flags.
 *
 * @param tail the flags after `list`
 * @returns the invocation, or the refusal
 */
function parseListArgs({ tail }: { tail: readonly string[] }): Result<PushRootArgs, RecutArgsError> {
  const parsed = parseFlagTail({ rest: tail, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(usageError({ problems: parsed.error }));
  }
  // Unset is undefined, exactly what the shell's resolveHome reads as this install's state home.
  return ok({ home: parsed.value.values["home"], json: parsed.value.flags.has("json"), kind: "list" });
}

/**
 * Every problem with `record`'s two required values: each one missing, then each one malformed.
 *
 * @param repository the `--repo` read
 * @param rootSha the `--root` read
 * @returns the problem lines, empty when both are present and well-formed
 */
function recordValueProblems({
  repository,
  rootSha,
}: {
  repository: Result<string>;
  rootSha: Result<string>;
}): readonly string[] {
  const problems = [...(repository.isErr() ? repository.error : []), ...(rootSha.isErr() ? rootSha.error : [])];
  if (repository.isOk() && !isPushRootRepository({ value: repository.value })) {
    problems.push(`--repo ${repository.value} is not an owner/name repository`);
  }
  if (rootSha.isOk() && !isPushRootSha({ value: rootSha.value })) {
    problems.push(`--root ${rootSha.value} is not a full 40-character lower-case sha`);
  }
  return problems;
}

/**
 * Parse `record`'s flags.
 *
 * @param tail the flags after `record`
 * @returns the invocation, or every problem with it
 */
function parseRecordArgs({ tail }: { tail: readonly string[] }): Result<PushRootArgs, RecutArgsError> {
  const parsed = parseFlagTail({ rest: tail, spec: RECORD_SPEC });
  if (parsed.isErr()) {
    return err(usageError({ problems: parsed.error }));
  }
  const repository = requiredFlagValue({
    missing: "--repo <owner/name> is required: the repository whose history was re-cut",
    name: "repo",
    parsed: parsed.value,
  });
  const rootSha = requiredFlagValue({
    missing: "--root <sha> is required: the full sha of the fresh history's one root commit",
    name: "root",
    parsed: parsed.value,
  });
  const problems = recordValueProblems({ repository, rootSha });
  if (problems.length > 0 || repository.isErr() || rootSha.isErr()) {
    return err(usageError({ problems }));
  }
  return ok({
    // Unset is undefined for both: the shell resolves the checkout and the state home.
    cwd: parsed.value.values["cwd"],
    dryRun: parsed.value.flags.has("dry-run"),
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    kind: "record",
    repository: repository.value,
    rootSha: rootSha.value,
  });
}

/**
 * Parse the argv after `github push-root`.
 *
 * @param rest the sub-command and its flags
 * @returns the parsed invocation, or every line refusing it (the usage last)
 */
export function parsePushRootArgs({ rest }: { rest: readonly string[] }): Result<PushRootArgs, RecutArgsError> {
  const [sub, ...tail] = rest;
  if (sub === "list") {
    return parseListArgs({ tail });
  }
  if (sub === "record") {
    return parseRecordArgs({ tail });
  }
  let named = "(none)";
  if (sub !== undefined) {
    named = sub;
  }
  return err(usageError({ problems: [`unknown sub-command ${named}: pass record or list`] }));
}

/**
 * Why `rootSha` cannot be a recorded root, judged from `git rev-list --parents -n 1 <sha>^{commit}`: that prints
 * the commit followed by its parents, so a root prints itself and nothing else.
 *
 * @param rootSha the sha the invocation named
 * @param parentsLine what git printed, or `undefined` when git could not resolve the commit at all
 * @returns the refusal line, or `undefined` when the sha is a parentless commit
 */
export function rootCommitProblem({
  rootSha,
  parentsLine,
}: {
  rootSha: string;
  parentsLine: string | undefined;
}): string | undefined {
  if (parentsLine === undefined) {
    return `${rootSha} is not a commit in this checkout; record the root from a clone of the fresh history`;
  }
  const [self, ...parents] = parentsLine.trim().split(/\s+/);
  if (self !== rootSha) {
    let resolved = "nothing";
    if (self !== undefined) {
      resolved = self;
    }
    return `${rootSha} resolved to ${resolved}, not itself; pass the full commit sha`;
  }
  if (parents.length > 0) {
    return `${rootSha} has ${String(parents.length)} parent(s), so it is not a root; pass the fresh history's first commit`;
  }
  return undefined;
}

/**
 * One binding as a printed line.
 *
 * @returns `<owner/name> accepts only <root> (recorded <instant>)`
 */
export function bindingLine({ binding }: { binding: PushRootBinding }): string {
  return `${binding.repository} accepts only ${binding.rootSha} (recorded ${binding.recordedAtIso})`;
}
