/**
 * `slopweaver github stack dissolve` — the pure decisions behind unregistering every entry in a native
 * GitHub stack, leaving every pull request open and its base untouched.
 *
 * Maps directly onto GitHub's one native removal endpoint, `POST .../stacks/{n}/unstack`: it removes every
 * unmerged entry, and its own documented contract already IS "leave a merged or locked entry in place" —
 * so unlike `stack remove` (which composes unstack with a recreate step and refuses a merged entry outright
 * because a partial removal there is ambiguous), dissolve has no composition to get wrong. It calls the one
 * endpoint and reports exactly what it reports back.
 */
import type { DoorRequest } from "../../../admit/types.js";
import type { GithubStack } from "../../../corpus/github/stack.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { sameEntryNumbers } from "./stackEntrySet.js";
import type { Freshness } from "./updateCore.js";

/** The flags this verb accepts. */
const GITHUB_STACK_DISSOLVE_FLAGS: FlagSpec = {
  boolean: ["dry-run"],
  string: ["repo", "stack", "home"],
};

/** Every accepted flag, with the `--` callers type, for the repo-wide help-truth ratchet. */
export const GITHUB_STACK_DISSOLVE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_STACK_DISSOLVE_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_STACK_DISSOLVE_FLAGS }),
].map((name) => `--${name}`);

/** The parsed, side-effect-free invocation. */
export interface GithubStackDissolveArgs {
  readonly owner: string;
  readonly repo: string;
  readonly stackNumber: number;
  readonly dryRun: boolean;
  readonly home: string | undefined;
}

/** One declared string flag, or `undefined`. */
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
 * Parse a `stack dissolve` invocation, before any network read.
 *
 * `--repo` is required, matching `stack remove` and `pr retarget`: this verb never touches Git, so there
 * is no worktree to derive an owner/repo from.
 *
 * @param argv the verb's own argument tail, after `github stack dissolve`
 * @returns the parsed options or every usage error
 */
export function parseGithubStackDissolveArgs({ argv }: { argv: readonly string[] }): Result<GithubStackDissolveArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: argv, spec: GITHUB_STACK_DISSOLVE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const rawRepo = stringFlag({ name: "repo", values });
  const repo = rawRepo === undefined ? undefined : parseRepoSlug({ slug: rawRepo });
  if (rawRepo === undefined) {
    errors.push("--repo owner/name is required");
  } else if (repo === undefined) {
    errors.push(`--repo must be owner/name; "${rawRepo}" is not`);
  }
  const rawStack = stringFlag({ name: "stack", values });
  const stackNumber = rawStack === undefined ? Number.NaN : Number(rawStack);
  if (rawStack === undefined) {
    errors.push("--stack <n> is required");
  } else if (!Number.isInteger(stackNumber) || stackNumber <= 0) {
    errors.push("--stack must be a positive whole number");
  }
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  return ok({
    dryRun: values["dry-run"] === true,
    home: stringFlag({ name: "home", values }),
    owner: repo.owner,
    repo: repo.repo,
    stackNumber,
  });
}

/** What dissolving may do, decided purely from the stack it would act on. */
export type StackDissolveDecision =
  | { readonly kind: "proceed"; readonly stackNumber: number; readonly entryNumbers: readonly number[] }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Decide whether a native stack may be dissolved — before any write. There is nothing to refuse on the
 * stack's own shape (unlike `stack remove`, a merged entry is not a problem: `unstack` already leaves it in
 * place and this verb reports exactly that), only the degenerate case of a stack with no entries at all.
 *
 * @param stack the full native stack read live
 * @returns the plan, or the reason there is nothing to do
 */
export function githubStackDissolveDecisionFor({ stack }: { stack: GithubStack }): StackDissolveDecision {
  if (stack.entries.length === 0) {
    return { kind: "refused", reason: `native stack #${String(stack.number)} has no entries — nothing to dissolve` };
  }
  return { kind: "proceed", entryNumbers: stack.entries.map((entry) => entry.number), stackNumber: stack.number };
}

/**
 * Describe what dissolving the stack would do, for the dry-run line and the final report.
 *
 * @param decision the resolved dissolve plan
 * @returns the one-line description; always contains "dissolve" so a caller can grep for it
 */
export function stackDissolveDescription({
  decision,
}: {
  decision: Extract<StackDissolveDecision, { kind: "proceed" }>;
}): string {
  const numbers = decision.entryNumbers.map((number) => `#${String(number)}`).join(", ");
  return `dissolve native stack #${String(decision.stackNumber)} (${numbers})`;
}

/**
 * Re-check, inside the door, that the stack's own entry set has not moved since it was planned against.
 * Order-insensitive, matching `stack remove`'s own freshness check — what matters is which pull requests
 * are still present, not their live order.
 *
 * @param previewed the entry numbers read while building the plan
 * @param current the entry numbers read again inside the door
 * @returns whether the write may proceed, naming what moved when it may not
 */
export function githubStackDissolveFreshnessFor({
  previewed,
  current,
}: {
  previewed: readonly number[];
  current: readonly number[];
}): Freshness {
  if (sameEntryNumbers({ a: previewed, b: current })) {
    return { fresh: true };
  }
  return {
    fresh: false,
    reason:
      "the stack's own entries changed between planning and writing this dissolve, so nothing was sent. Re-run to work from the current state",
  };
}

/**
 * The external-write door request for one exact stack dissolve.
 *
 * @param home the Slopweaver state home whose door records the write
 * @param owner the repository owner
 * @param repo the repository name
 * @param decision the resolved dissolve plan being admitted
 * @returns the external-write request admitted by the door
 */
export function githubStackDissolveDoorRequest({
  home,
  owner,
  repo,
  decision,
}: {
  home: string;
  owner: string;
  repo: string;
  decision: Extract<StackDissolveDecision, { kind: "proceed" }>;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "stack dissolve" },
    artifact: { entryNumbers: decision.entryNumbers, repo: `${owner}/${repo}`, stackNumber: decision.stackNumber },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
