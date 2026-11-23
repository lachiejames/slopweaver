/**
 * The kind labels (`../../../outbound/github/kindLabels.ts`) applied to a pull request this verb just created or
 * updated, and read back.
 *
 * Only a pull request the door already holds as the owner's own reaches here: `stack push` creates one, and
 * `pr update` refuses one another account authored. A pull request from a fork is skipped, because its labels are
 * the fork author's to choose. A label the repository does not define is refused rather than added, because
 * GitHub CREATES an undefined label on add, and a missing definition is a repository fact to fix once, not one to
 * paper over on every pull request.
 *
 * The label write is never the verb's outcome: the description write has already happened, so a label that could
 * not be applied is printed as a warning, and the CI gate's `KIND_LABEL_MISSING` is what holds the pull request.
 */
import type { GithubWriteApi } from "../../../corpus/github/write.js";
import { kindLabelsForTitle, missingKindLabels } from "../../../outbound/github/kindLabels.js";

/** What the pre-write reads say to do. */
export type KindLabelPlan =
  | { readonly kind: "none" }
  | { readonly kind: "present" }
  | { readonly kind: "add"; readonly labels: readonly string[] }
  | { readonly kind: "undefined"; readonly labels: readonly string[]; readonly truncated: boolean };

/**
 * Decide what to add from the title, the labels the pull request carries and the labels the repository defines.
 *
 * @param title the pull request's title
 * @param current the labels it carries now
 * @param defined the label names the repository defines
 * @param truncated whether the defined-label read stopped before the end
 * @returns nothing to derive, all present, the labels to add, or the derived labels the repository lacks
 */
export function kindLabelPlan({
  current,
  defined,
  title,
  truncated,
}: {
  current: readonly string[];
  defined: readonly string[];
  title: string;
  truncated: boolean;
}): KindLabelPlan {
  if (kindLabelsForTitle({ title }).length === 0) {
    return { kind: "none" };
  }
  const missing = missingKindLabels({ labels: current, title });
  if (missing.length === 0) {
    return { kind: "present" };
  }
  const undefinedLabels = missing.filter((label) => !defined.includes(label));
  if (undefinedLabels.length > 0) {
    return { kind: "undefined", labels: undefinedLabels, truncated };
  }
  return { kind: "add", labels: missing };
}

/** The pull request a label write addresses. */
interface LabelTarget {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
}

/**
 * Apply the missing kind labels and read them back.
 *
 * @param api the label reads and the add, from the verb's own write client
 * @param target the pull request and its title
 * @returns the lines to print: what was added and confirmed, or why nothing was
 */
export async function applyKindLabels({
  api,
  target,
}: {
  api: Pick<GithubWriteApi, "addIssueLabels" | "issueLabels" | "repoLabels">;
  target: LabelTarget;
}): Promise<readonly string[]> {
  const { number, owner, repo, title } = target;
  if (kindLabelsForTitle({ title }).length === 0) {
    return [];
  }
  const ref = { number, owner, repo };
  const current = await api.issueLabels(ref);
  if (current.isErr()) {
    return [`kind labels not applied: could not read #${String(number)}'s labels: ${current.error.message}`];
  }
  const defined = await api.repoLabels({ owner, repo });
  if (defined.isErr()) {
    return [`kind labels not applied: could not read ${owner}/${repo}'s labels: ${defined.error.message}`];
  }
  const plan = kindLabelPlan({
    current: current.value.labels,
    defined: defined.value.names,
    title,
    truncated: defined.value.truncated,
  });
  return performPlan({ api, plan, ref, title });
}

/** The add and its read-back, for a plan that has something to add. */
async function performPlan({
  api,
  plan,
  ref,
  title,
}: {
  api: Pick<GithubWriteApi, "addIssueLabels" | "issueLabels">;
  plan: KindLabelPlan;
  ref: { owner: string; repo: string; number: number };
  title: string;
}): Promise<readonly string[]> {
  if (plan.kind === "none" || plan.kind === "present") {
    return [];
  }
  if (plan.kind === "undefined") {
    const read = plan.truncated ? " (the label read was truncated, so it may be further down)" : "";
    return [
      `kind labels not applied: ${ref.owner}/${ref.repo} defines no ${plan.labels.map((label) => `"${label}"`).join(", ")} label${read}; define it once, then re-run`,
    ];
  }
  const added = await api.addIssueLabels({ ...ref, labels: plan.labels });
  if (added.isErr()) {
    return [`kind labels not applied: the add was refused: ${added.error.message}`];
  }
  const back = await api.issueLabels(ref);
  if (back.isErr()) {
    return [`kind labels UNCONFIRMED: added ${plan.labels.join(", ")} but the read-back failed: ${back.error.message}`];
  }
  const still = missingKindLabels({ labels: back.value.labels, title });
  if (still.length > 0) {
    return [`kind labels UNCONFIRMED: the read-back still lacks ${still.join(", ")}`];
  }
  return [`kind labels: added ${plan.labels.join(", ")}, read back`];
}
