/**
 * Pure parser, queue-safety verdict, door request and refusal for `slopweaver github required-contexts`.
 *
 * The verb exists because a CI check is usually a required check, or else it is
 * meaningless. A check nothing requires is a check a landing can ignore, and until this
 * verb the only way to change which contexts `main` requires was GitHub's own settings page — which rule 3
 * puts outside the door entirely.
 *
 * ## ADD is the default, and that is a safety property rather than a convenience
 *
 * GitHub's endpoint REPLACES the context array. A caller naming only what it wants to add would silently
 * drop everything already required, and on a branch with a merge queue an empty required set means the
 * queue merges each entry on arrival without testing the merged result — the failure
 * `skills/github/reference/ungated-queue.md` exists about, and which `github enqueue` already refuses to
 * create. So this verb composes the list: `--require <name>` UNIONS with what is already there, and
 * `--exact` is the explicit opt-in to a replacement.
 */

import type { DoorRequest } from "../../../admit/types.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";

/* The two flag lists are named rather than written inline into the FlagSpec so the help-truth ratchet below
   reads the same arrays the parser does, with nothing to fall back to when one of them is absent. */
const STRING_FLAGS = ["repo", "branch", "require", "drop", "entries", "home"] as const;
const BOOLEAN_FLAGS = ["exact", "dry-run", "json"] as const;

const GITHUB_REQUIRED_CONTEXTS_FLAGS: FlagSpec = {
  boolean: [...BOOLEAN_FLAGS],
  string: [...STRING_FLAGS],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_REQUIRED_CONTEXTS_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS].map(
  (name) => `--${name}`,
);

/**
 * The parsed, side-effect-free invocation.
 *
 * `repo` is the raw `owner/name` typed, or absent — resolving it against the current checkout is the
 * shell's job, exactly as it is in `./ciRunsCore.ts`, so this parser stays a pure function of argv.
 */
export interface GithubRequiredContextsArgs {
  readonly repo: string | undefined;
  readonly branch: string;
  readonly require: readonly string[];
  readonly drop: readonly string[];
  readonly exact: boolean;
  readonly entries: number;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

const DEFAULT_BRANCH = "main";
const DEFAULT_ENTRIES = 5;
const MAX_ENTRIES = 100;

/**
 * Split a comma list into trimmed, non-empty names, preserving the order the caller typed.
 *
 * @param value the raw flag value, or undefined when the flag was not passed
 * @returns the names, deduped
 */
function nameList({ value }: { value: unknown }): readonly string[] {
  if (typeof value !== "string") {
    return [];
  }
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return [...new Set(parts)];
}

/**
 * Parse the invocation before resolving a repository or a credential.
 *
 * @param rest argv after `github required-contexts`
 * @returns the parsed change, or every usage problem
 */
export function parseGithubRequiredContextsArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubRequiredContextsArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_REQUIRED_CONTEXTS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const require = nameList({ value: parsed.value.values["require"] });
  const drop = nameList({ value: parsed.value.values["drop"] });
  const exact = parsed.value.values["exact"] === true;
  if (exact && require.length === 0) {
    errors.push("--exact needs --require <a,b>: a required set of nothing gates nothing");
  }
  const overlap = require.filter((name) => drop.includes(name));
  if (overlap.length > 0) {
    errors.push(`--require and --drop name the same context: ${overlap.join(", ")}`);
  }
  const entriesValue = parsed.value.values["entries"];
  const entries = typeof entriesValue === "string" ? Number.parseInt(entriesValue, 10) : DEFAULT_ENTRIES;
  if (!Number.isInteger(entries) || entries < 1 || entries > MAX_ENTRIES) {
    errors.push(`--entries must be an integer 1..${String(MAX_ENTRIES)}`);
  }
  if (errors.length > 0) {
    return err(errors);
  }
  const branchValue = parsed.value.values["branch"];
  const home = parsed.value.values["home"];
  const repoValue = parsed.value.values["repo"];
  return ok({
    branch: typeof branchValue === "string" && branchValue.length > 0 ? branchValue : DEFAULT_BRANCH,
    drop,
    dryRun: parsed.value.values["dry-run"] === true,
    entries,
    exact,
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    repo: typeof repoValue === "string" ? repoValue : undefined,
    require,
  });
}

/**
 * The context list this invocation would store, composed from what the branch already requires.
 *
 * ADD, never replace, unless `--exact` was typed. The result is sorted so two orderings of the same
 * configuration compare equal, which is what makes the read-back check a real comparison.
 *
 * @param current the contexts the branch requires now
 * @param args the parsed change
 * @returns the complete list a write would send
 */
export function composeRequiredContexts({
  current,
  args,
}: {
  current: readonly string[];
  args: Pick<GithubRequiredContextsArgs, "require" | "drop" | "exact">;
}): readonly string[] {
  const base = args.exact ? args.require : [...current, ...args.require];
  return [...new Set(base)].filter((name) => !args.drop.includes(name)).toSorted();
}

/** What the merge-group safety read concluded about one context this write would ADD. */
export interface ContextSafety {
  readonly name: string;
  /** Whether a check of this name was seen on a merge-group ref in the window read. */
  readonly observed: boolean;
}

/**
 * Judge every context this write would newly require against what a merge group actually runs.
 *
 * Only ADDITIONS are judged. Dropping a name, or leaving one that is already required in place, cannot
 * create a check an entry has to wait for, so neither can stall the queue — and judging them would refuse a
 * write that only ever narrows the gate.
 *
 * @param adding the contexts that would be required after this write and are not required now
 * @param observed every context name seen on a merge-group ref in the window
 * @returns one verdict per addition, in the order they would be stored
 */
export function judgeQueueSafety({
  adding,
  observed,
}: {
  adding: readonly string[];
  observed: readonly string[];
}): readonly ContextSafety[] {
  const seen = new Set(observed);
  return adding.map((name) => ({ name, observed: seen.has(name) }));
}

/**
 * The refusal printed when a write would require a context no merge-group entry has run.
 *
 * The four lines are the register's, never this module's, for the reason `error-handling.md` gives. What is
 * added is the `detail` clause — the names, and the size of the window they were not seen in — because
 * "never observed" is only actionable next to how hard anybody looked.
 *
 * @param unobserved the additions with no merge-group run
 * @param entries how many queue entries the observation window actually covered
 * @param observed every name that WAS seen, so the reader can tell a typo from a structural gap
 * @returns the refusal, one line per element
 */
export function unobservedContextRefusal({
  unobserved,
  entries,
  observed,
}: {
  unobserved: readonly string[];
  entries: number;
  observed: readonly string[];
}): readonly string[] {
  const window =
    entries === 0
      ? "no merge-group entry was found at all, so nothing was measured"
      : `${String(entries)} merge-group entr${entries === 1 ? "y" : "ies"} carried: ${observed.toSorted().join(", ")}`;
  return hatchRefusalLines({
    detail: `${unobserved.join(", ")}; ${window}`,
    hatch: hatchFor({ id: "unobserved-required-context" }),
  });
}

/**
 * Whether the ambient hatch releases the unobserved-context refusal for this run.
 *
 * @param env the process environment to read the hatch out of
 * @returns true when the operator has opened the hatch for this invocation
 */
export function unobservedHatchOpen({ env }: { env: Record<string, string | undefined> }): boolean {
  return env["SLOPWEAVER_ALLOW_UNOBSERVED_REQUIRED_CONTEXT"] === "1";
}

/**
 * The external-write door request for one branch's required-context change.
 *
 * @param identity the resolved `owner/name`
 * @param branch the branch whose rule is being written
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function requiredContextsDoorRequest({
  identity,
  branch,
  home,
}: {
  identity: string;
  branch: string;
  home: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "required-contexts" },
    artifact: { id: `${identity}@${branch}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
