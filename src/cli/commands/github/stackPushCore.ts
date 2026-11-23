/**
 * `slopweaver github stack push` — the pure decisions behind adding one entry to a native GitHub stack.
 *
 * A stack entry is an ordinary pull request whose `target.base` names another open pull request's branch
 * (or the repository default, for the bottom of a fresh stack). This file decides only what `stack push`
 * itself is uniquely responsible for — refusing a mismatched form, and classifying what registration (if
 * any) should follow a successful create; the push and the create themselves reuse `pushCore.ts`'s and
 * `run.ts`'s existing pure decisions unchanged, in `./stackPushRun.ts`.
 *
 * ## This is the ONE door that opens a pull request
 *
 * Owner ruling: slopweaver tooling uses native GitHub stack verbs for every pull request creation.
 * `github pr create` is refused outright, so every argument that used to belong
 * to it lives here — `--file`'s authoring-file input, the `--form-example`/`--file-example` shape printers,
 * and the `--cwd`/`--remote`/`--acknowledge` base-freshness fields the creation gates read. A push whose
 * `target.base` is the repository default is the bottom of a fresh stack: it is a stack of one until
 * something is pushed on top of it, and GitHub's own stack object only exists from the second entry, so the
 * registration step reports `none` there rather than inventing a local ledger to disagree with GitHub.
 */

import type { DoorRequest } from "../../../admit/types.js";
import type { InstallationIdentifiers } from "../../../hygiene/installationIdentifiers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { PrFormDraft } from "../../../outbound/github/types.js";
import { parseWaitOptions, WAIT_FLAG_SPEC, type WaitOptions } from "../../../wait/flags.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type BaseFreshnessAcknowledgement, baseFreshnessAcknowledgementFrom } from "./baseFreshnessCore.js";
import { type GithubVerbError, GithubVerbErrors } from "./errors.js";
import { ORPHAN_ABOVE_FLAG, parseOrphanAbove } from "./stackCarryCore.js";
import { remoteFlag } from "./stackCommonArgs.js";
import type { StackPushAmendPin } from "./stackPushTree.js";

/** The flags this verb accepts; the help-truth ratchet reads the names derived from it below. */
const GITHUB_STACK_PUSH_FLAGS: FlagSpec = {
  boolean: ["dry-run", "form-example", "file-example", "acknowledge-all", ...WAIT_FLAG_SPEC.boolean],
  string: [
    ...WAIT_FLAG_SPEC.string,
    "form",
    "file",
    "self-review",
    "cwd",
    "remote",
    "acknowledge",
    "reason",
    "home",
    ORPHAN_ABOVE_FLAG,
  ],
};

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_STACK_PUSH_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_STACK_PUSH_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_STACK_PUSH_FLAGS }),
].map((name) => `--${name}`);

/** The parsed, side-effect-free invocation. */
export interface GithubStackPushArgs {
  /** The whole form as inline JSON, or `-` for stdin. Absent when `--file` or an example flag was used. */
  readonly formSource: string | undefined;
  /**
   * A markdown+frontmatter authoring file, as a real path or `-` for stdin — the human-editable alternative
   * to `--form`'s raw JSON, and a separate field because its source is a PATH rather than the text itself.
   */
  readonly fileSource: string | undefined;
  /** Print the canonical example form and exit, rather than requiring a real `--form`. */
  readonly formExample: boolean;
  /** Print the canonical example authoring file and exit — `--form-example`'s counterpart for `--file`. */
  readonly fileExample: boolean;
  readonly selfReviewSource: string | undefined;
  readonly cwd: string | undefined;
  readonly remote: string;
  readonly dryRun: boolean;
  /** What the creation gates may proceed past: base-moved, base-unmeasurable, already-landed, and so on. */
  readonly baseFreshnessAcknowledgement: BaseFreshnessAcknowledgement;
  /**
   * The pull requests stacked above this branch whose orphaning the caller deliberately accepts — the carry
   * gate's break-glass, empty for every ordinary push. See `./stackCarryCore.ts` for why it is exact.
   */
  readonly orphanAbove: readonly number[];
  /**
   * `--wait`/`--timeout-seconds`: hold this push at the repository's operation lock until the stack verb
   * already running there finishes, instead of refusing so the caller retries the whole verb in a loop.
   */
  readonly lockWait: WaitOptions;
  readonly home: string | undefined;
}

/**
 * Whether the description is read from stdin: `--form` decides when it was given, else `--file` does. Neither
 * given is an example run or a usage error, and reads nothing.
 */
function descriptionReadsStdin({
  formSource,
  fileSource,
}: {
  formSource: string | undefined;
  fileSource: string | undefined;
}): boolean {
  if (formSource !== undefined) {
    return formSource === "-";
  }
  return fileSource === "-";
}

/**
 * The one input mode this verb accepts: a whole form (JSON or an authoring file), or an example of either
 * printed in place of one. Exactly one, never two — a caller who gave both has said two things.
 *
 * @param selfReviewSource `--self-review`, when given, so the stdin collision can be caught here
 * @returns every usage error, empty when the invocation names exactly one mode
 */
function stackPushInputModeErrors({
  formSource,
  fileSource,
  selfReviewSource,
  formExample,
  fileExample,
}: {
  formSource: string | undefined;
  fileSource: string | undefined;
  selfReviewSource: string | undefined;
  formExample: boolean;
  fileExample: boolean;
}): readonly string[] {
  const errors: string[] = [];
  const modes = [formSource !== undefined, fileSource !== undefined, formExample, fileExample].filter(
    (given) => given,
  ).length;
  if (modes === 0) {
    errors.push(
      "stack push needs exactly one of: --form <json|-> (use `-` to read from stdin), --file <path|-> (a " +
        "markdown authoring file), --form-example (print a complete JSON example and exit), or --file-example " +
        "(print a complete authoring-file example and exit)",
    );
  } else if (modes > 1) {
    errors.push("give exactly ONE of --form, --file, --form-example or --file-example to stack push");
  }
  if (descriptionReadsStdin({ fileSource, formSource }) && selfReviewSource === "-") {
    errors.push("--self-review and the description input cannot both read from stdin; pass one as inline JSON");
  }
  return errors;
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
 * Parse a stack-push invocation without touching Git, the form or the network.
 *
 * @param argv the verb's own argument tail, after `github stack push`
 * @returns the parsed options or every usage error
 */
export function parseGithubStackPushArgs({ argv }: { argv: readonly string[] }): Result<GithubStackPushArgs> {
  const parsed = parseFlags({ args: argv, spec: GITHUB_STACK_PUSH_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const formSource = stringFlag({ name: "form", values });
  const fileSource = stringFlag({ name: "file", values });
  const selfReviewSource = stringFlag({ name: "self-review", values });
  const formExample = values["form-example"] === true;
  const fileExample = values["file-example"] === true;
  const errors = [...stackPushInputModeErrors({ fileExample, fileSource, formExample, formSource, selfReviewSource })];
  const remote = remoteFlag({ values });
  if (remote.trim().length === 0) {
    errors.push("--remote must not be blank");
  }
  const baseFreshnessAcknowledgement = baseFreshnessAcknowledgementFrom({ enabled: true, errors, values });
  const orphanAbove = parseOrphanAbove({ errors, raw: stringFlag({ name: ORPHAN_ABOVE_FLAG, values }) });
  const lockWait = parseWaitOptions({ values });
  if (lockWait.isErr()) {
    return err([...errors, ...lockWait.error]);
  }
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    baseFreshnessAcknowledgement,
    cwd: stringFlag({ name: "cwd", values }),
    dryRun: values["dry-run"] === true,
    fileExample,
    fileSource,
    formExample,
    formSource,
    home: stringFlag({ name: "home", values }),
    lockWait: lockWait.value,
    orphanAbove,
    remote,
    selfReviewSource,
  });
}

/** The live Git facts the shell measured before asking this core for a plan. */
export interface GithubStackPushFacts {
  readonly repoRoot: string;
  /** `owner/name`, matching `admit/githubPush.ts`'s `GithubPushFacts.repo` shape so its push plan can be reused. */
  readonly repo: string;
  readonly branch: string;
  readonly defaultBranch: string;
  /** The commit the amend may rewrite: a HEAD that moved while the verb waited is refused, not amended. */
  readonly headSha: string;
  /** The tree the amend may commit, pinned before any gate ran — see `./stackPushTree.ts`. */
  readonly amendPin: StackPushAmendPin;
}

/** The one safe stack-push shape this verb can execute. */
export interface GithubStackPushPlan {
  readonly facts: GithubStackPushFacts;
  /** The unstamped draft; the door stamps the day it writes when it creates the pull request. */
  readonly form: PrFormDraft;
  readonly addArgs: readonly string[];
  readonly amendArgs: readonly string[];
}

/**
 * A gate-checked plan with the installation's own identifiers its PR gate forgives, read once so the preview and
 * the create gate alike.
 */
export type GatedStackPushPlan = GithubStackPushPlan & {
  readonly installationIdentifiers: InstallationIdentifiers | undefined;
};

/**
 * Decide whether a stack push may proceed, before any Git or network effect.
 *
 * @param facts the live repository facts the shell measured
 * @param form the parsed, gate-checked pull-request draft
 * @returns the push plan, or the safety reason it was refused
 */
export function githubStackPushPlan({
  facts,
  form,
}: {
  facts: GithubStackPushFacts;
  form: PrFormDraft;
}): Result<GithubStackPushPlan, GithubVerbError> {
  if (form.target.head !== facts.branch) {
    return err(GithubVerbErrors.stackHeadNotCheckedOut({ branch: facts.branch, head: form.target.head }));
  }
  if (facts.branch === facts.defaultBranch) {
    return err(GithubVerbErrors.stackPushDefaultBranch({ defaultBranch: facts.defaultBranch }));
  }
  if (form.target.base === form.target.head) {
    return err(GithubVerbErrors.stackBaseEqualsHead());
  }
  if (`${form.target.owner}/${form.target.repo}` !== facts.repo) {
    return err(
      GithubVerbErrors.stackRepoMismatch({ owner: form.target.owner, remoteRepo: facts.repo, repo: form.target.repo }),
    );
  }
  return ok({ addArgs: ["add", "--all"], amendArgs: ["commit", "--amend", "--no-edit"], facts, form });
}

/** One open pull request's identity and current stack membership, as much as a registration decision needs. */
export interface StackParentPr {
  readonly number: number;
  readonly stackNumber: number | undefined;
}

export type GithubStackRegistration =
  | { readonly kind: "create"; readonly parentNumber: number }
  | { readonly kind: "add"; readonly stackNumber: number; readonly parentNumber: number }
  | { readonly kind: "already-joined"; readonly stackNumber: number }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Decide what stack registration should follow a successful create — from facts the shell has already
 * fetched. Never called for a bottom-of-stack push (`base === defaultBranch`); the shell reports `none`
 * itself there without a parent lookup, since this function's job starts only once a parent is possible.
 *
 * @param base the new pull request's base branch
 * @param parentPr the open pull request whose head is `base`, if one was found
 * @param newPrStackNumber the newly created pull request's own inline stack number, already re-read —
 *   present when GitHub already auto-joined it by branch topology alone
 * @returns the registration this push should perform, or why it cannot be decided
 */
export function githubStackRegistrationFor({
  base,
  parentPr,
  newPrStackNumber,
}: {
  base: string;
  parentPr: StackParentPr | undefined;
  newPrStackNumber: number | undefined;
}): GithubStackRegistration {
  if (parentPr === undefined) {
    return {
      kind: "refused",
      reason: `base branch ${base} is not the repository default and no open pull request has it as its head`,
    };
  }
  if (newPrStackNumber !== undefined && newPrStackNumber === parentPr.stackNumber) {
    return { kind: "already-joined", stackNumber: newPrStackNumber };
  }
  return parentPr.stackNumber === undefined
    ? { kind: "create", parentNumber: parentPr.number }
    : { kind: "add", parentNumber: parentPr.number, stackNumber: parentPr.stackNumber };
}

/**
 * Describe the external write to the admit door.
 *
 * @param home the state home whose door ledger records the attempt
 * @param plan the exact stack-push plan being admitted
 * @returns the external-write door request
 */
export function githubStackPushDoorRequest({ home, plan }: { home: string; plan: GithubStackPushPlan }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "stack push" },
    artifact: {
      base: plan.form.target.base,
      branch: plan.facts.branch,
      head: plan.form.target.head,
      repo: plan.facts.repo,
    },
    meta: {
      createsWorkItem: true,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
