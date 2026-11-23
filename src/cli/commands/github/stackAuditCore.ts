/**
 * The chained-not-natively-stacked class, computed and reported — pure, so every door that must refuse it
 * and the audit verb that reports it all decide from the same function rather than from four descriptions of
 * the same idea.
 *
 * ## The class, stated exactly
 *
 * A pull request `c` is CHAINED when its base branch is the head branch of another OPEN pull request `p` in
 * the same repository. Chaining is legitimate and is what a stack is made of; what the owner ruled against
 * is a chain that GitHub does not know is one: every stack must be an actual GitHub native stack. So the violation is the chain MINUS the membership:
 *
 * > `c` and `p` are both open, `c.baseRef === p.headRef` in the same repository, and it is NOT the case that
 * > both carry the same native stack number.
 *
 * Four distinguishable shapes fall out of that last clause and they are not interchangeable, because the
 * repair differs: {@link ChainKind}. Naming which one a violation is, is what lets a refusal say the stack a
 * pull request must join rather than "this is wrong".
 *
 * ## Why the head repository is compared and not just the branch name
 *
 * A fork's branch may be called anything an internal branch is called. Matching on `headRef` alone would pair
 * an internal pull request based on `main` with a fork pull request whose head branch is also `main`, and
 * report a chain that does not exist. Every pairing here therefore requires the child's BASE repository to be
 * the parent's HEAD repository, which is the only reading under which "this branch is that branch" is true.
 */
import type { WrittenPr } from "../../../corpus/github/write.js";
import { err, ok } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";

/** One open pull request, reduced to the fields the chain relation is computed from. */
export interface AuditPr {
  readonly number: number;
  readonly headRef: string;
  readonly baseRef: string;
  /** The repository owning the head branch — `undefined` once a fork has been deleted, which never pairs. */
  readonly headRepoFullName: string | undefined;
  readonly baseRepoFullName: string;
  /** The native GitHub stack this pull request belongs to, or `undefined` when it belongs to none. */
  readonly stackNumber: number | undefined;
  readonly htmlUrl: string;
  /** Whether the token's own account authored it — the only violations this installation may repair itself. */
  readonly yours: boolean;
}

/**
 * Which half of a chained pair is missing its membership. The repair differs per shape, so the audit and
 * every refusal name it rather than reporting one undifferentiated "not stacked".
 */
export type ChainKind =
  /** Neither is stacked: a fresh native stack has to be formed from the pair. */
  | "neither-stacked"
  /** The parent is in a stack and the child is in none: the child joins that stack, which is nameable. */
  | "child-unstacked"
  /** The child is in a stack and the parent is in none: the parent joins the child's stack, below it. */
  | "parent-unstacked"
  /** Both are stacked, in DIFFERENT stacks: one of the two has to be dissolved before either can join. */
  | "different-stacks";

/** One chained pair GitHub does not know is a stack. */
export interface ChainViolation {
  readonly child: AuditPr;
  readonly parent: AuditPr;
  readonly kind: ChainKind;
}

/**
 * Project one live pull request into the audit's own shape.
 *
 * @param pr the pull request as the provider reports it
 * @param viewerId the token account's own immutable id, or `undefined` when the provider reported none
 * @returns the projection the pure relation is computed over
 */
export function auditPrOf({ pr, viewerId }: { pr: WrittenPr; viewerId: number | undefined }): AuditPr {
  return {
    baseRef: pr.baseRef,
    baseRepoFullName: pr.baseRepoFullName,
    headRef: pr.head.ref,
    headRepoFullName: pr.head.repoFullName,
    htmlUrl: pr.htmlUrl,
    number: pr.number,
    stackNumber: pr.stack?.number,
    yours: viewerId !== undefined && pr.authorId === viewerId,
  };
}

/**
 * The open pull request whose head branch is `baseRef` in `baseRepoFullName` — the parent a pull request
 * chains onto, or `undefined` when the base is nobody's head and the chain does not exist.
 *
 * `excludeNumber` keeps a pull request from ever being read as its own parent. That pairing is already
 * impossible for a well-formed pull request (GitHub refuses a base equal to the head), but this function is
 * also called from the creation and retarget doors with a base a caller merely PROPOSED, which is not.
 *
 * @param baseRef the base branch being chained onto
 * @param baseRepoFullName the repository that base branch lives in
 * @param excludeNumber a pull request that may not be its own parent, when one is in hand
 * @param openPrs every open pull request in the repository
 * @returns the parent pull request, or `undefined`
 */
export function chainParentFor({
  baseRef,
  baseRepoFullName,
  excludeNumber,
  openPrs,
}: {
  baseRef: string;
  baseRepoFullName: string;
  excludeNumber?: number | undefined;
  openPrs: readonly AuditPr[];
}): AuditPr | undefined {
  return openPrs.find(
    (candidate) =>
      candidate.number !== excludeNumber &&
      candidate.headRef === baseRef &&
      candidate.headRepoFullName === baseRepoFullName,
  );
}

/**
 * Which membership shape a chained pair has, or `undefined` when the pair is a properly formed native stack
 * and there is nothing to report.
 *
 * @param childStackNumber the chained pull request's native stack, or `undefined`
 * @param parentStackNumber the pull request it chains onto, or `undefined`
 * @returns the violation shape, or `undefined` when both sit in the same native stack
 */
export function chainKindFor({
  childStackNumber,
  parentStackNumber,
}: {
  childStackNumber: number | undefined;
  parentStackNumber: number | undefined;
}): ChainKind | undefined {
  if (childStackNumber === undefined && parentStackNumber === undefined) {
    return "neither-stacked";
  }
  if (childStackNumber === undefined) {
    return "child-unstacked";
  }
  if (parentStackNumber === undefined) {
    return "parent-unstacked";
  }
  return childStackNumber === parentStackNumber ? undefined : "different-stacks";
}

/**
 * Every chained pair in a repository that GitHub does not know is a stack, child-first and in the order the
 * pull requests were given.
 *
 * @param openPrs every open pull request in the repository, whoever authored it
 * @returns one entry per violating pair
 */
export function chainViolationsIn({ openPrs }: { openPrs: readonly AuditPr[] }): readonly ChainViolation[] {
  const violations: ChainViolation[] = [];
  for (const child of openPrs) {
    const parent = chainParentFor({
      baseRef: child.baseRef,
      baseRepoFullName: child.baseRepoFullName,
      excludeNumber: child.number,
      openPrs,
    });
    if (parent === undefined) {
      continue;
    }
    const kind = chainKindFor({ childStackNumber: child.stackNumber, parentStackNumber: parent.stackNumber });
    if (kind !== undefined) {
      violations.push({ child, kind, parent });
    }
  }
  return violations;
}

/**
 * How a drifted entry is adopted, named wherever a repair says "adopt".
 *
 * An {@link AuditPr} carries no commit count by construction, so this text cannot know whether a given
 * branch is replayable — and prescribing the replay alone would
 * fail: the repair for `parent-unstacked` would tell an operator to dissolve a stack and then run a plain
 * `stack adopt` that refuses a multi-commit branch, which is exactly the deadlock `--register-only` exists
 * to end. Naming both routes costs one clause and cannot be wrong either way.
 */
const DRIFTED_ADOPT_HINT = " (add --register-only if its branch has drifted past a one-commit replay)";

/**
 * The order a chain has to be registered in, named wherever a repair says "form a stack".
 *
 * An {@link AuditPr} carries only its own pair, so this text cannot see whether the PARENT is itself a chain
 * child — and `--register-only` refuses a fresh stack over an unstacked parent that has one, because forming
 * the upper pair would leave the lower needing a dissolve. Without it, a
 * three-deep unregistered chain would be told to adopt its TOP pair, which both modes then refuse. Naming
 * the order is unconditional for the same reason the drift hint is — it cannot be wrong either way.
 *
 * **Stated residue: neither hint corrects the prescribed pull-request NUMBER.** The shape: pull
 * request A heads `parent-branch`, targets `main`, carries no stack, and nothing open heads `main`; B targets
 * `parent-branch` and sits in a stack with C above it. The `parent-unstacked` repair says dissolve that stack
 * and adopt A, and adopting A registers nothing at all, because its own base has no open pull request — the
 * real lowest pair is B onto A. Correcting the
 * NUMBER needs the whole open-pull-request set, which an {@link AuditPr} does not carry;
 * {@link chainViolationsIn} has it and this function does not, so the fix is to thread it rather than to
 * word this differently. No case was found where a register-only write degrades a
 * relation, so the residue is stated here rather than fixed.
 */
const BOTTOM_FIRST_HINT =
  ". Register a chain from its LOWEST pair upward: if that parent is itself based on another open pull " +
  "request, adopt that pair first";

/**
 * The repair one violation shape needs, as the exact verb to run.
 *
 * Every `kind` comes from {@link chainKindFor} over these same two stack numbers, which names
 * `different-stacks` and `parent-unstacked` only when the child HAS a stack and `child-unstacked` only when
 * the parent does — so each number read with `!` below is set on the arm that reads it.
 */
function repairFor({ violation }: { violation: ChainViolation }): string {
  const { child, parent, kind } = violation;
  if (kind === "different-stacks") {
    return (
      `dissolve one of the two first — \`slopweaver github stack dissolve --repo <owner/name> --stack ` +
      `${String(child.stackNumber!)}\` — then adopt #${String(child.number)} onto #${String(parent.number)}` +
      DRIFTED_ADOPT_HINT
    );
  }
  if (kind === "parent-unstacked") {
    return (
      `#${String(parent.number)} must join stack #${String(child.stackNumber!)} BELOW #${String(child.number)}, ` +
      `which GitHub's add endpoint cannot do — dissolve stack #${String(child.stackNumber!)} and re-form it ` +
      `from the bottom with \`slopweaver github stack adopt --pr ${String(parent.number)}\`${DRIFTED_ADOPT_HINT} ` +
      `first${BOTTOM_FIRST_HINT}`
    );
  }
  const joining =
    kind === "child-unstacked"
      ? ` — it must join native stack #${String(parent.stackNumber!)}`
      : `, forming a fresh native stack with it${BOTTOM_FIRST_HINT}`;
  return (
    `check out ${child.headRef} and run \`slopweaver github stack adopt --pr ${String(child.number)}\`` +
    `${DRIFTED_ADOPT_HINT}${joining}`
  );
}

/**
 * One violation as the lines every surface prints for it — the audit report, and every door that refuses.
 *
 * Shared rather than re-worded per call site for the reason the module doc gives: the same class described
 * four ways is how a session learns four different repairs for one defect.
 *
 * @param violation the chained pair
 * @returns the lines, already indented for a list
 */
export function chainViolationLines({ violation }: { violation: ChainViolation }): readonly string[] {
  const { child, parent, kind } = violation;
  const stacks = `child stack ${child.stackNumber === undefined ? "none" : `#${String(child.stackNumber)}`}, parent stack ${parent.stackNumber === undefined ? "none" : `#${String(parent.stackNumber)}`}`;
  return [
    `  #${String(child.number)} (${child.headRef}) is based on #${String(parent.number)} (${parent.headRef}) — ${kind}: ${stacks}`,
    `    ${child.htmlUrl}`,
    `    ${child.yours ? "yours" : "another author's — report it, do not adopt it"}: ${repairFor({ violation })}`,
  ];
}

/**
 * The refusal a door prints when the write it was asked for would leave a chain GitHub does not know about.
 *
 * @param base the base branch the caller proposed or already has
 * @param parent the open pull request that base branch belongs to
 * @param verb the exact invocation being refused, so the message names what the caller just ran
 * @returns the refusal lines
 */
export function chainDoorRefusalLines({
  base,
  parent,
  verb,
}: {
  base: string;
  parent: AuditPr;
  verb: string;
}): readonly string[] {
  const join =
    parent.stackNumber === undefined
      ? "there is no native stack yet, so one must be formed from the pair"
      : `it must join native stack #${String(parent.stackNumber)}`;
  return [
    `refused: ${verb} would leave a chained pull request that GitHub does not know is a stack.`,
    "",
    `  Base ${base} is the head branch of open pull request #${String(parent.number)} (${parent.htmlUrl}), and`,
    `  ${join}.`,
    "",
    "  Owner ruling: every stack must be an actual GitHub native stack. A chain that GitHub",
    "  cannot see is the class this door exists to make impossible, so it is refused rather than reported.",
    "",
    `  slopweaver github stack adopt --pr <n>          # pull an already-open pull request into the stack`,
    `  slopweaver github stack adopt --pr <n> --register-only   # ... when its branch is too drifted to replay`,
    `  slopweaver github stack push --form -           # open a new one directly as a stack entry`,
    `  slopweaver github stack audit --repo <owner/name>   # what else in this repository is chained this way`,
  ];
}

/**
 * The flags `stack audit` accepts.
 *
 * @internal read by this verb's own parser and its flag-name list; nothing else names it.
 */
export const GITHUB_STACK_AUDIT_FLAGS: FlagSpec = {
  boolean: ["json", "check", "mine"],
  string: ["repo", "home"],
};

/** Every accepted flag, with the `--` callers type, for the repo-wide help-truth ratchet. */
export const GITHUB_STACK_AUDIT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_STACK_AUDIT_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_STACK_AUDIT_FLAGS }),
].map((name) => `--${name}`);

/** The parsed, side-effect-free invocation. */
export interface GithubStackAuditArgs {
  readonly owner: string;
  readonly repo: string;
  readonly json: boolean;
  /** Exit non-zero when any violation survives the filter — what CI runs this verb as. */
  readonly check: boolean;
  /** Report only the violations the token's own account authored. */
  readonly mine: boolean;
  readonly home: string | undefined;
}

/**
 * Parse a `stack audit` invocation, before any network read.
 *
 * `--repo` is required and never derived from a checked-out remote, matching `stack remove` and
 * `pr retarget`: this verb touches no Git at all, and the repository it audits is routinely not the one the
 * session is working in — auditing acme-admin from a slopweaver worktree is the ordinary case.
 *
 * @param argv the verb's own argument tail, after `github stack audit`
 * @returns the parsed options or every usage error
 */
export function parseGithubStackAuditArgs({
  argv,
}: {
  argv: readonly string[];
}): GithubVerbResult<GithubStackAuditArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: argv, spec: GITHUB_STACK_AUDIT_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const rawRepo = values["repo"];
  const slug = typeof rawRepo === "string" ? rawRepo : undefined;
  const repo = slug === undefined ? undefined : parseRepoSlug({ slug });
  if (slug === undefined) {
    return err(GithubVerbErrors.repoRequired());
  }
  if (repo === undefined) {
    return err(GithubVerbErrors.repoMalformed({ got: slug }));
  }
  const home = values["home"];
  return ok({
    check: values["check"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    mine: values["mine"] === true,
    owner: repo.owner,
    repo: repo.repo,
  });
}

/** The line a cut-short walk prints, so a partial scan never reads as a whole one. */
export const STACK_AUDIT_TRUNCATED_LINE =
  "INCOMPLETE: the open-pull-request walk stopped at its page cap, so pull requests past it were never audited";

/**
 * The audit's exit code. FAIL CLOSED under `--check`: a walk the page cap cut short fails even with zero
 * violations, because a chain past the cap is one the relation never saw (owner ruling: every CI check
 * fails closed). Without `--check` the verb reports and exits 0 either way; the report says it was partial.
 *
 * @param check whether `--check` made this a gate
 * @param truncated whether the open-pull-request walk stopped at its page cap
 * @param violationCount the violations that survived the caller's filter
 * @returns `EXIT_ERROR` for a gate over a violation or a partial walk, else `EXIT_OK`
 */
export function stackAuditExitCode({
  check,
  truncated,
  violationCount,
}: {
  check: boolean;
  truncated: boolean;
  violationCount: number;
}): number {
  if (check && (truncated || violationCount > 0)) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * The whole human report for one audited repository.
 *
 * A clean repository prints the count it scanned as well as the zero, because "0 violations" over a set
 * nothing was read into is the same sentence as "0 violations" over a real scan, and only one of them is
 * the gold proof this verb exists to produce.
 *
 * A walk the page cap cut short says so instead, and never prints the every-chain sentence: a chain whose
 * child sits past the cap is invisible to the relation, so zero violations over a partial list proves nothing.
 *
 * @param openPrCount how many open pull requests were read
 * @param repo the audited `owner/name`
 * @param truncated whether the open-pull-request walk stopped at its page cap with more left unread
 * @param violations the violations that survived the caller's filter
 * @returns the report lines
 */
export function githubStackAuditReportLines({
  openPrCount,
  repo,
  truncated,
  violations,
}: {
  openPrCount: number;
  repo: string;
  truncated: boolean;
  violations: readonly ChainViolation[];
}): readonly string[] {
  const header = `${repo}: ${String(openPrCount)} open pull request(s) scanned, ${String(violations.length)} chained without a native stack`;
  const incomplete = truncated ? [STACK_AUDIT_TRUNCATED_LINE] : [];
  if (violations.length === 0) {
    if (truncated) {
      return [header, ...incomplete];
    }
    return [header, "every open chain in this repository is an actual GitHub native stack"];
  }
  const yours = violations.filter((violation) => violation.child.yours || violation.parent.yours).length;
  return [
    header,
    ...incomplete,
    `${String(yours)} of them involve a pull request this token authored`,
    "",
    ...violations.flatMap((violation) => chainViolationLines({ violation })),
  ];
}
