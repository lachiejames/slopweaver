/**
 * The flag set every whole-repository stack verb takes, and its one parser.
 *
 * `stack sync` and `stack restack` accept exactly the same four flags — which repository, which remote,
 * which state home, and whether this is a preview — because both operate over a repository rather than over
 * a named pull request. Two copies of that parser is how they drift into disagreeing about what a blank
 * `--remote` means, and the `duplicate-windows` gate saw the second copy the moment it was written.
 */
import { err, ok } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";

/** The flags a whole-repository stack verb accepts. */
export const STACK_COMMON_FLAGS: FlagSpec = {
  boolean: ["dry-run"],
  string: ["cwd", "remote", "home"],
};

/** Every accepted flag, with the `--` callers type — exported for the repo-wide help-truth ratchet. */
export const STACK_COMMON_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: STACK_COMMON_FLAGS }),
  ...booleanFlagsOf({ spec: STACK_COMMON_FLAGS }),
].map((name) => `--${name}`);

/** One parsed whole-repository stack invocation. */
export interface StackCommonArgs {
  readonly cwd: string | undefined;
  readonly remote: string;
  readonly dryRun: boolean;
  readonly home: string | undefined;
}

/** One optional string flag. */
function stringFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The Git remote a push or stack verb talks to. No `--remote` is a supported invocation meaning `origin`,
 * not a missing value; a blank one is still returned as typed, for the caller's own blank-remote refusal.
 *
 * @param values the parsed flag values, read for `remote` only
 * @returns the named remote, or `origin` when the flag was not passed
 */
export function remoteFlag({ values }: { values: Readonly<Record<string, string | boolean>> }): string {
  const named = values["remote"];
  if (typeof named !== "string") {
    return "origin";
  }
  return named;
}

/**
 * Parse a whole-repository stack invocation without touching Git or the network.
 *
 * @param argv the verb's own argument tail, after its own name
 * @param spec the flag set to parse against, for a verb that accepts the common four plus its own
 * @returns the parsed options and the raw values, or every usage error
 */
export function parseStackCommonArgs({
  argv,
  spec = STACK_COMMON_FLAGS,
}: {
  argv: readonly string[];
  spec?: FlagSpec;
}): GithubVerbResult<{ readonly args: StackCommonArgs; readonly values: Readonly<Record<string, string | boolean>> }> {
  const parsed = parseFlags({ args: argv, spec });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const remote = remoteFlag({ values });
  if (remote.trim().length === 0) {
    return err(GithubVerbErrors.remoteBlank({ got: remote }));
  }
  return ok({
    args: {
      cwd: stringFlag({ name: "cwd", values }),
      dryRun: values["dry-run"] === true,
      home: stringFlag({ name: "home", values }),
      remote,
    },
    values,
  });
}
