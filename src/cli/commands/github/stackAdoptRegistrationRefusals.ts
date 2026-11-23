/**
 * `github stack adopt --register-only`'s per-pair refusal checks — the pull-request shape both adopt modes share,
 * the child's own refusals, the parent chain's, and the parent's authorisation on a `create`. Pure.
 *
 * `githubStackAdoptRegistrationPlan` in `./stackAdoptRegistrationCore.ts` runs them in order; they were split
 * out of that file when it reached the size ratchet.
 */

import type { WrittenPr } from "../../../corpus/github/write.js";
import type { RegistrationFacts, RegistrationOperation } from "./stackAdoptRegistrationCore.js";
import { headRepositoryField } from "./stackAdoptRegistrationFields.js";
import { type AuditPr, auditPrOf, chainKindFor, chainViolationLines } from "./stackAuditCore.js";
import type { Authorisation } from "./updateCore.js";

/** Whether two `owner/repo` spellings name the same repository, case-insensitively as GitHub treats them. */
function sameRepoName({ a, b }: { a: string | undefined; b: string }): boolean {
  return a !== undefined && a.toLowerCase() === b.toLowerCase();
}

/**
 * The four shape refusals a pull request must clear before EITHER mode touches it — open, in this
 * repository, with a head repository that still exists and is this one.
 *
 * Shared with `./stackAdoptCore.ts` rather than re-worded here: the same four sentences described twice is
 * how a session learns two vocabularies for one defect. The check ORDER is `stackAdoptCore.ts`'s, unchanged,
 * so which refusal wins for a multiply-invalid pull request is exactly what it was.
 *
 * @param owner the repository owner the caller resolved
 * @param pr the pull request GitHub reports now
 * @param repo the repository name the caller resolved
 * @returns the refusal, or `undefined` when all four pass
 */
export function adoptableShapeRefusal({
  owner,
  pr,
  repo,
}: {
  owner: string;
  pr: WrittenPr;
  repo: string;
}): string | undefined {
  const label = `PR #${String(pr.number)}`;
  const slug = `${owner}/${repo}`;
  if (pr.state !== "open") {
    return `${label} is ${pr.state}, not open — adopt only handles an open pull request`;
  }
  if (!sameRepoName({ a: pr.baseRepoFullName, b: slug })) {
    return `${label}'s base repository (${pr.baseRepoFullName}) is not ${slug}`;
  }
  if (pr.head.repoFullName === undefined) {
    return `${label}'s head repository is gone (the fork was deleted) — there is nothing to adopt from`;
  }
  if (!sameRepoName({ a: pr.head.repoFullName, b: slug })) {
    return (
      `${label}'s head repository (${pr.head.repoFullName}) is a fork of ${slug} — adopt only ` +
      "handles a branch in the same repository"
    );
  }
  return undefined;
}

/**
 * Every refusal the child alone decides, before a parent is even looked for.
 *
 * @returns the refusal, or `undefined` when the child passes every check
 */
export function childRefusal({ facts }: { facts: RegistrationFacts }): string | undefined {
  const { child, owner, repo, defaultBranch } = facts;
  const shape = adoptableShapeRefusal({ owner, pr: child, repo });
  if (shape !== undefined) {
    return shape;
  }
  if (child.head.ref === defaultBranch) {
    return `PR #${String(child.number)}'s head branch is the repository default (${defaultBranch}) — there is nothing to adopt`;
  }
  return undefined;
}

/** Every refusal the resolved parent decides — that it is a distinct, open, same-repository chain parent. */
function parentRefusal({ child, owner, parent, repo }: RegistrationFacts & { parent: WrittenPr }): string | undefined {
  const slug = `${owner}/${repo}`;
  if (parent.number === child.number) {
    return `PR #${String(child.number)} cannot be its own stack parent`;
  }
  if (parent.state !== "open") {
    return `parent PR #${String(parent.number)} is ${parent.state}, not open`;
  }
  if (!sameRepoName({ a: parent.head.repoFullName, b: slug })) {
    return `parent PR #${String(parent.number)}'s head repository (${headRepositoryField({ pr: parent })}) is not ${slug}`;
  }
  if (parent.head.ref !== child.baseRef) {
    return (
      `PR #${String(child.number)}'s base branch (${child.baseRef}) is not parent PR ` +
      `#${String(parent.number)}'s head branch (${parent.head.ref})`
    );
  }
  return undefined;
}

/**
 * The membership refusal for the two chain shapes GitHub's own endpoints cannot repair, carrying the audit's
 * exact repair lines rather than a second wording of them.
 *
 * `chainKindFor` (`./stackAuditCore.ts`) is the one classifier `pushChainGate`, the audit and this mode all
 * decide from, so there is no second membership policy here — `parent-unstacked` needs a dissolve-and-reform
 * because GitHub's add endpoint cannot insert BELOW an existing entry, and `different-stacks` needs one of
 * the two dissolved first.
 */
function incompatibleMembershipLines({
  child,
  parent,
  viewerId,
}: {
  child: WrittenPr;
  parent: WrittenPr;
  viewerId: number | undefined;
}): readonly string[] | undefined {
  const kind = chainKindFor({ childStackNumber: child.stack?.number, parentStackNumber: parent.stack?.number });
  if (kind !== "parent-unstacked" && kind !== "different-stacks") {
    return undefined;
  }
  const auditChild: AuditPr = auditPrOf({ pr: child, viewerId });
  const auditParent: AuditPr = auditPrOf({ pr: parent, viewerId });
  return [
    `cannot register PR #${String(child.number)} against parent PR #${String(parent.number)}: ${kind}`,
    ...chainViolationLines({ violation: { child: auditChild, kind, parent: auditParent } }),
  ];
}

/**
 * Whether forming a FRESH stack from this pair would leave the pull request below it worse off — the defect
 * a Codex review reproduced against this module's own core.
 *
 * In a three-deep unregistered chain (bottom, middle, top), registering the UPPER pair puts the middle into a
 * new stack while the bottom stays in none. The middle-onto-bottom relation therefore moves from `neither-stacked`, which a
 * single `--register-only` repairs, to `parent-unstacked`, which GitHub's add endpoint cannot repair at all:
 * it needs the new stack DISSOLVED and re-formed from the bottom. A run that reported success would have
 * made the tree harder to fix than it found it, which is exactly the outcome this mode exists to avoid.
 *
 * The rule that follows is bottom-first, and it is the same discipline the audit's own `parent-unstacked`
 * repair already teaches: a chain is registered from its lowest pair upward, one invocation per pair.
 */
function belowWouldBeOrphaned({
  child,
  defaultBranch,
  grandparent,
  parent,
}: {
  child: WrittenPr;
  defaultBranch: string;
  grandparent: WrittenPr | undefined;
  parent: WrittenPr;
}): string | undefined {
  if (parent.stack !== undefined || grandparent === undefined) {
    return undefined;
  }
  const preamble =
    `registering PR #${String(child.number)} onto PR #${String(parent.number)} would form a FRESH stack, but ` +
    `#${String(parent.number)} is itself based on open PR #${String(grandparent.number)} ` +
    `(${grandparent.head.ref}) and carries no stack — so this pair would leave that lower one needing a ` +
    "dissolve rather than a registration. ";
  // Never prescribe a repair this verb would itself refuse: in a chain
  // deep enough that the bottom-up walk reaches a pull request whose HEAD is the repository default, the
  // "adopt the parent first" instruction terminates in "there is nothing to adopt" and the whole chain stays
  // refused. Stack automation will not enrol the default branch, so the honest answer is that this chain
  // cannot be registered while it hangs off a pull request headed by it.
  if (parent.head.ref === defaultBranch) {
    return (
      `${preamble}Registering #${String(parent.number)} first is not available either: its head branch IS the ` +
      `repository default (${defaultBranch}), which stack automation never enrols. Re-base this chain off ` +
      `${defaultBranch} directly before registering it`
    );
  }
  return (
    `${preamble}Register a chain from the bottom up: ` +
    `\`slopweaver github stack adopt --pr ${String(parent.number)} --register-only\` first, then re-run this`
  );
}

/**
 * The foreign-author gate for the OTHER pull request a `create` enrols — the parent.
 *
 * `createStack` takes both numbers, so forming a fresh stack writes native membership onto the parent every
 * bit as much as onto the child. Authorising only the child would let a chain whose parent belongs
 * to a colleague register that colleague's pull request with neither a refusal nor an override notice. An `add` is outside this, because the parent is
 * already in the stack the child joins and only the child's own membership changes.
 *
 * The reason and notice are prefixed with the parent's number: `authorisationFor`'s own wording says "this
 * pull request", which reads as the one the caller named.
 *
 * @param operation what the pair decided on — only a `create` writes to the parent
 * @param parentAuthorisation whether this account may act on the parent, or `undefined` when the shell could
 *   not resolve one
 * @returns the refusal line, the override notice to print, or neither
 */
export function parentAuthorisationOutcome({
  operation,
  parent,
  parentAuthorisation,
}: {
  operation: RegistrationOperation;
  parent: WrittenPr;
  parentAuthorisation: Authorisation | undefined;
}): { readonly refusal?: string; readonly notice?: string } {
  if (operation.kind !== "create") {
    return {};
  }
  const label = `parent PR #${String(parent.number)}`;
  if (parentAuthorisation === undefined) {
    return {
      refusal:
        `forming a fresh stack registers ${label} as well as PR #${String(operation.pullRequests[1])}, and ` +
        "whether you may act on it was never checked. Refusing rather than guessing",
    };
  }
  if (parentAuthorisation.kind === "refused") {
    return { refusal: `forming a fresh stack also registers ${label}, and ${parentAuthorisation.reason}` };
  }
  if (parentAuthorisation.kind === "overridden") {
    return { notice: `${label}: ${parentAuthorisation.notice}` };
  }
  return {};
}

/**
 * Every refusal the resolved parent and the chain below it decide, in the order `stackAdoptCore.ts` fixed:
 * parent topology, then the membership shapes GitHub's endpoints cannot repair, then the bottom-first rule.
 *
 * Extracted so the plan in `./stackAdoptRegistrationCore.ts` stays readable rather than to hide anything — each
 * half is its own named function above, and this is only the sequence they run in.
 *
 * @param facts the live pull-request facts the shell read
 * @param parent the resolved parent, which this chain is about
 * @param viewerId the token account's own id, for the audit lines a membership refusal carries
 * @returns every refusal line, or `undefined` when the chain is registerable
 */
export function parentChainRefusal({
  facts,
  parent,
  viewerId,
}: {
  facts: RegistrationFacts;
  parent: WrittenPr;
  viewerId: number | undefined;
}): readonly string[] | undefined {
  const parentProblem = parentRefusal({ ...facts, parent });
  if (parentProblem !== undefined) {
    return [parentProblem];
  }
  const incompatible = incompatibleMembershipLines({ child: facts.child, parent, viewerId });
  if (incompatible !== undefined) {
    return incompatible;
  }
  const orphaned = belowWouldBeOrphaned({
    child: facts.child,
    defaultBranch: facts.defaultBranch,
    grandparent: facts.grandparent,
    parent,
  });
  return orphaned === undefined ? undefined : [orphaned];
}
