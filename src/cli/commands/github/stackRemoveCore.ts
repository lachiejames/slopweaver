/**
 * `slopweaver github stack remove` — the pure decisions behind dropping ONE pull request out of its native
 * GitHub stack while leaving every other entry registered and every pull request open.
 *
 * GitHub's REST API exposes exactly one native removal endpoint — `POST .../stacks/{n}/unstack` — and it
 * removes every UNMERGED entry at once; there is no way to name a single one. So "remove one entry" is
 * built from two already-verified endpoints rather than a guessed single-shot mutation: unstack the whole
 * native stack, then — when two or more entries would remain — recreate it from exactly those, in their
 * original order. A stack containing a merged or otherwise-locked entry is refused outright rather than
 * partially handled: `unstack` would silently leave that entry in place, which this composite has no way to
 * distinguish from "nothing needed removing", so the safe answer is to refuse and say why (matching `stack
 * sync`'s own refusal at the first merged entry it meets).
 */
import type { DoorRequest } from "../../../admit/types.js";
import type { GithubStack } from "../../../corpus/github/stack.js";
import type { WrittenPr } from "../../../corpus/github/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { sameEntryNumbers } from "./stackEntrySet.js";
import type { Freshness } from "./updateCore.js";

/** The flags this verb accepts. */
const GITHUB_STACK_REMOVE_FLAGS: FlagSpec = {
  boolean: ["dry-run"],
  string: ["repo", "pr", "home"],
};

/** Every accepted flag, with the `--` callers type, for the repo-wide help-truth ratchet. */
export const GITHUB_STACK_REMOVE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_STACK_REMOVE_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_STACK_REMOVE_FLAGS }),
].map((name) => `--${name}`);

/** The parsed, side-effect-free invocation. */
export interface GithubStackRemoveArgs {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
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
 * Parse a `stack remove` invocation, before any network read.
 *
 * `--repo` is required rather than derived from the checked-out worktree's remote, unlike `stack push`
 * and `stack adopt`: this verb never touches Git, so there is no worktree to derive it from, and the
 * pull request it targets can live in a repository entirely different from the one this command runs in —
 * matching `pr retarget`'s own `--repo`, the closest sibling verb.
 *
 * @param argv the verb's own argument tail, after `github stack remove`
 * @returns the parsed options or every usage error
 */
export function parseGithubStackRemoveArgs({ argv }: { argv: readonly string[] }): Result<GithubStackRemoveArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: argv, spec: GITHUB_STACK_REMOVE_FLAGS });
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
  const rawPr = stringFlag({ name: "pr", values });
  const prNumber = rawPr === undefined ? Number.NaN : Number(rawPr);
  if (rawPr === undefined) {
    errors.push("--pr <n> is required");
  } else if (!Number.isInteger(prNumber) || prNumber <= 0) {
    errors.push("--pr must be a positive whole number");
  }
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  return ok({
    dryRun: values["dry-run"] === true,
    home: stringFlag({ name: "home", values }),
    owner: repo.owner,
    prNumber,
    repo: repo.repo,
  });
}

/** What a stack-remove may do, decided purely from the pull request and its full native stack. */
export type StackRemoveDecision =
  | {
      readonly kind: "proceed";
      readonly stackNumber: number;
      readonly removedNumber: number;
      /** The stack's remaining entries, bottom to top, in their original order. */
      readonly remainingNumbers: readonly number[];
    }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Decide whether one pull request may be removed from its native stack, and what removing it would leave
 * behind — before any write.
 *
 * @param pr the pull request GitHub reports now, read for its own stack membership
 * @param stack the full native stack that membership names
 * @returns the plan, or the safety reason it was refused
 */
export function githubStackRemoveDecisionFor({
  pr,
  stack,
}: {
  pr: WrittenPr;
  stack: GithubStack;
}): StackRemoveDecision {
  if (pr.stack === undefined) {
    return {
      kind: "refused",
      reason: `#${String(pr.number)} is not a member of any native GitHub stack — nothing to remove`,
    };
  }
  const merged = stack.entries.find((entry) => entry.mergedAtIso !== undefined);
  if (merged !== undefined) {
    return {
      kind: "refused",
      reason:
        `native stack #${String(stack.number)} has a merged entry (#${String(merged.number)}) — remove only ` +
        "handles a stack where every entry is still open, since GitHub's own unstack endpoint would leave a " +
        "merged entry in place rather than remove it",
    };
  }
  if (!stack.entries.some((entry) => entry.number === pr.number)) {
    return {
      kind: "refused",
      reason: `#${String(pr.number)} was not found among native stack #${String(stack.number)}'s own entries`,
    };
  }
  return {
    kind: "proceed",
    remainingNumbers: stack.entries.filter((entry) => entry.number !== pr.number).map((entry) => entry.number),
    removedNumber: pr.number,
    stackNumber: stack.number,
  };
}

/**
 * Describe what removing the pull request would do, for the dry-run line and the final report — the same
 * sentence either way, since a remove either lands exactly as planned or is refused before any write.
 *
 * @param decision the resolved removal plan
 * @returns the one-line description; always contains "remove" so a caller can grep for it
 */
export function stackRemoveDescription({
  decision,
}: {
  decision: Extract<StackRemoveDecision, { kind: "proceed" }>;
}): string {
  const { removedNumber, stackNumber, remainingNumbers } = decision;
  if (remainingNumbers.length === 0) {
    return `remove #${String(removedNumber)} from native stack #${String(stackNumber)} — the stack has no other entries, so it dissolves entirely`;
  }
  if (remainingNumbers.length === 1) {
    return (
      `remove #${String(removedNumber)} from native stack #${String(stackNumber)} — dissolve the stack entirely, ` +
      `since only #${String(remainingNumbers[0])} would remain, too few to re-stack`
    );
  }
  const remainingList = remainingNumbers.map((number) => `#${String(number)}`).join(", ");
  return (
    `remove #${String(removedNumber)} from native stack #${String(stackNumber)} — dissolve it and re-form the ` +
    `remaining ${String(remainingNumbers.length)} entries (${remainingList}) as a new stack, in the same order`
  );
}

/**
 * Re-check, inside the door, that the stack's own entry set has not moved since it was planned against.
 *
 * Order-insensitive by design: `remove`'s write always re-derives the plan from whichever order the stack
 * reports at write time (see `stackRemoveRun.ts`), so what matters here is that the same PULL REQUESTS are
 * still the ones present — not that they still sit in the same positions.
 *
 * @param previewed the entry numbers read while building the plan
 * @param current the entry numbers read again inside the door
 * @returns whether the write may proceed, naming what moved when it may not
 */
export function githubStackRemoveFreshnessFor({
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
      "the stack's own entries changed between planning and writing this removal, so nothing was sent. Re-run to work from the current state",
  };
}

/**
 * The external-write door request for one exact stack-remove.
 *
 * @param home the Slopweaver state home whose door records the write
 * @param owner the repository owner
 * @param repo the repository name
 * @param decision the resolved removal plan being admitted
 * @returns the external-write request admitted by the door
 */
export function githubStackRemoveDoorRequest({
  home,
  owner,
  repo,
  decision,
}: {
  home: string;
  owner: string;
  repo: string;
  decision: Extract<StackRemoveDecision, { kind: "proceed" }>;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "stack remove" },
    artifact: {
      remainingNumbers: decision.remainingNumbers,
      removedNumber: decision.removedNumber,
      repo: `${owner}/${repo}`,
      stackNumber: decision.stackNumber,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
