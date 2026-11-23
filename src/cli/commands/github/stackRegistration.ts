/**
 * The native stack registration that follows a create or an adopt — shared by `stack push` (for the pull
 * request it just opened) and `stack adopt` (for one that already exists), because nothing in this decision
 * requires the pull request to be newly created.
 *
 * Split out of `stackPushRun.ts` when that file crossed the size ratchet. GitHub's own computed stack is the
 * membership and order authority here; this file only decides which of its endpoints to call.
 */
import type { GithubWriteApi } from "../../../corpus/github/write.js";
import { githubStackRegistrationFor } from "./stackPushCore.js";

/** The four write-API reads and writes a registration makes, and nothing else. */
type StackRegistrationApi = Pick<GithubWriteApi, "findOpenPrByHead" | "getPr" | "createStack" | "addToStack">;

/** What the registration step actually did, for the report. */
export type GithubStackRegistrationOutcome =
  | { readonly kind: "none" }
  /**
   * The base is not the repository default, but no OPEN pull request has it as its head — so there is no
   * parent to stack against and nothing was registered.
   *
   * Deliberately its OWN kind rather than a flavour of `unregistered`, because the two mean opposite things
   * to a caller that must fail on the chained-not-native class: this one is not a chain at all (nobody has
   * opened a pull request for that base), while `unregistered` is a chain that exists and could not be
   * registered. Collapsing them would either make a legitimate branch-with-no-pull-request base fatal, or
   * make a genuine registration failure survivable.
   */
  | { readonly kind: "no-parent"; readonly base: string }
  | { readonly kind: "already-joined"; readonly stackNumber: number }
  | { readonly kind: "registered"; readonly stackNumber: number }
  | { readonly kind: "unregistered"; readonly reason: string };

/**
 * Resolve the parent PR and this PR's own re-read stack, then decide and execute the registration. Shared
 * verbatim by `stack push` (for the PR it just created) and `stack adopt` (for an existing PR) — nothing in
 * this decision requires the PR to be newly created.
 *
 * @param api the GitHub write surface
 * @param owner the repository owner
 * @param repo the repository name
 * @param base the PR's base branch — used exactly as given, never retargeted
 * @param defaultBranch the repository's default branch, for the bottom-of-stack case
 * @param prNumber the PR being registered
 * @returns what actually happened
 */
export async function registerStackEntry({
  api,
  owner,
  repo,
  base,
  defaultBranch,
  prNumber,
}: {
  api: StackRegistrationApi;
  owner: string;
  repo: string;
  base: string;
  defaultBranch: string;
  prNumber: number;
}): Promise<GithubStackRegistrationOutcome> {
  if (base === defaultBranch) {
    return { kind: "none" };
  }
  const parent = await api.findOpenPrByHead({ head: base, owner, repo });
  if (parent.isErr()) {
    return { kind: "unregistered", reason: `could not resolve the parent PR: ${parent.error.message}` };
  }
  if (parent.value === undefined) {
    return { base, kind: "no-parent" };
  }
  return registerAgainstParent({
    api,
    base,
    owner,
    parentPr: { number: parent.value.number, stackNumber: parent.value.stack?.number },
    prNumber,
    repo,
  });
}

/**
 * Register one pull request against a parent that the caller has ALREADY resolved.
 *
 * Split out of {@link registerStackEntry} for `pr retarget --adopt`, which finds its parent by scanning every
 * open pull request rather than by branch lookup, and which knows by construction that the base is not the
 * repository default — there is no default branch in hand there to compare against, and inventing one to get
 * past a check that cannot fire is worse than not running the check.
 *
 * @param api the GitHub write surface
 * @param base the PR's base branch, used only in the refusal text when no parent was resolved
 * @param owner the repository owner
 * @param parentPr the already-resolved parent this pull request stacks on top of
 * @param prNumber the PR being registered
 * @param repo the repository name
 * @returns what actually happened
 */
export async function registerAgainstParent({
  api,
  base,
  owner,
  parentPr,
  prNumber,
  repo,
}: {
  api: StackRegistrationApi;
  base: string;
  owner: string;
  parentPr: { readonly number: number; readonly stackNumber: number | undefined };
  prNumber: number;
  repo: string;
}): Promise<GithubStackRegistrationOutcome> {
  const ownPr = await api.getPr({ number: prNumber, owner, repo });
  if (ownPr.isErr()) {
    return { kind: "unregistered", reason: `could not re-read this PR's own stack membership: ${ownPr.error.message}` };
  }
  const decision = githubStackRegistrationFor({ base, newPrStackNumber: ownPr.value.stack?.number, parentPr });
  if (decision.kind === "refused") {
    return { kind: "unregistered", reason: decision.reason };
  }
  if (decision.kind === "already-joined") {
    return { kind: "already-joined", stackNumber: decision.stackNumber };
  }
  const registered =
    decision.kind === "create"
      ? await api.createStack({ owner, pullRequests: [decision.parentNumber, prNumber], repo })
      : await api.addToStack({ owner, pullRequests: [prNumber], repo, stackNumber: decision.stackNumber });
  return registered.isErr()
    ? { kind: "unregistered", reason: `the stack ${decision.kind} call failed: ${registered.error.message}` }
    : { kind: "registered", stackNumber: registered.value.number };
}

/**
 * The lines a report prints for one registration outcome — shared by `stack push`, `stack adopt` and
 * `pr retarget --adopt` so all three describe the same five states with the same words.
 *
 * @param registration what the registration step actually did, or `undefined` when the command never
 *   reached one
 * @returns the report lines
 */
export function stackRegistrationLines({
  registration,
}: {
  registration: GithubStackRegistrationOutcome | undefined;
}): readonly string[] {
  if (registration === undefined) {
    return [];
  }
  if (registration.kind === "none") {
    return ["stack: this is the bottom of a fresh stack — no registration needed"];
  }
  if (registration.kind === "no-parent") {
    return [
      `stack: base ${registration.base} is not the repository default and no OPEN pull request has it as its ` +
        "head, so there is nothing to stack against — this is not a chain",
    ];
  }
  if (registration.kind === "already-joined") {
    return [
      `stack: GitHub had already joined this PR to stack #${String(registration.stackNumber)} by branch topology`,
    ];
  }
  if (registration.kind === "registered") {
    return [`stack: registered as part of stack #${String(registration.stackNumber)}`];
  }
  return [
    `stack: NOT registered natively — ${registration.reason}`,
    "  This pull request is now chained onto another open pull request's branch WITHOUT a native GitHub",
    "  stack, which is the exact state the doors exist to prevent. Repair it before anything else:",
    "    slopweaver github stack adopt --pr <n>",
    "    slopweaver github stack audit --repo <owner/name> --check",
  ];
}

/**
 * Whether a registration outcome is the chained-not-native class — a chain that exists and could not be
 * registered, as opposed to a base nobody has opened a pull request for.
 *
 * Its own predicate rather than an inline `kind === "unregistered"` at three call sites, because the whole
 * point of separating {@link GithubStackRegistrationOutcome}'s `no-parent` arm is that exactly one of the
 * five states may fail a command, and a fourth caller reading the union itself would be free to disagree.
 *
 * @param registration what the registration step actually did
 * @returns whether the caller must report failure
 */
export function stackRegistrationFailed({
  registration,
}: {
  registration: GithubStackRegistrationOutcome | undefined;
}): boolean {
  return registration?.kind === "unregistered";
}
