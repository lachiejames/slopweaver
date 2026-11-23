/*
 * The pure fixtures the `github stack push` run test files share: the commit and tree SHAs the Git fake answers,
 * the argv every run opens with, a written pull request and the PR form a run passes. Nothing here touches disk.
 * It moved here when `stackPushRun.test.ts` was split by behaviour.
 */
import type { WrittenPr } from "../../../../../../corpus/github/write.js";
import { EXAMPLE_PR_FORM } from "../../../../../../outbound/github/formExample.js";
import type { PrFormDraft } from "../../../../../../outbound/github/types.js";

/** The commit stack push is run over, before any amend: also what the remote branch holds before the push. */
export const LOCAL_SHA = "1111111111111111111111111111111111111111";
export const AMENDED_SHA = "2222222222222222222222222222222222222222";
/** `LOCAL_SHA`'s own tree: unlike the pinned tree, so a default run has something to amend. */
export const HEAD_TREE = "6666666666666666666666666666666666666666";
export const PINNED_TREE = "3333333333333333333333333333333333333333";
export const EDITED_TREE = "4444444444444444444444444444444444444444";
/** A same-tree commit another process moved the branch to inside the amend, with a different parent. */
export const RACED_SHA = "5555555555555555555555555555555555555555";
export const LINEAGE =
  "--no-replace-objects show -s --no-show-signature --encoding=UTF-8 --format=%P%x00%an%x00%ae%x00%ai%x00%B%x00.";
export const PREFIX: readonly string[] = ["node", "slopweaver", "github", "stack", "push"];

/**
 * An open pull request on `o/r`, heading `h` at the amended commit and based on `main`.
 *
 * @param stack the native stack membership GitHub reports for it, if any
 * @returns the pull request
 */
export function pr({ number, stack }: { number: number; stack?: WrittenPr["stack"] }): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "o:h", ref: "h", repoFullName: "o/r", sha: AMENDED_SHA },
    htmlUrl: `https://example.invalid/pr/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack,
    state: "open",
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
  };
}

/**
 * The example PR form, serialised the way `--form` takes it, on target `o/r` from `top` into `main` by default.
 *
 * @returns the form as JSON text
 */
export function baseForm({
  base = "main",
  explainerText = "An export dropped an entry. This keeps it.",
  head = "top",
}: {
  base?: string;
  /** The explainer's one text run, where a test puts the reference it is about. */
  explainerText?: string;
  head?: string;
} = {}): string {
  return JSON.stringify(baseDraft({ base, explainerText, head }));
}

/**
 * The example PR form as a draft, on target `o/r` from `head` into `base`.
 *
 * @param explainerText the explainer's one text run, where a test puts the reference it is about
 * @returns the draft
 */
export function baseDraft({
  base,
  explainerText,
  head,
}: {
  base: string;
  explainerText: string;
  head: string;
}): PrFormDraft {
  // Seen the day before the harness clock, so the write door never finds the problem seen after today.
  return {
    ...EXAMPLE_PR_FORM,
    explainer: [{ kind: "text", text: explainerText }],
    problemSeen: { by: "agent", kind: "seen", on: "2026-08-09", what: "an exported report was one row short" },
    target: { base, head, owner: "o", repo: "r" },
    title: "t",
  };
}
