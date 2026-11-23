/**
 * What `github review-draft list` and `show` print — the `--json` document the console's review card reads, and
 * the lines a terminal reads. Pure.
 */
import type { ReviewDraftItem } from "../../../outbound/github/reviewDraft.js";
import { reviewPostCommand } from "./reviewDraftCore.js";

/** One row of `list --json`: the folded row, plus the command the owner's yes turns into while it is still held. */
export interface ReviewDraftListEntry {
  readonly id: string;
  readonly state: ReviewDraftItem["state"];
  readonly resolvedIso?: string | undefined;
  readonly outcome?: string | undefined;
  readonly draft: ReviewDraftItem["draft"];
  /** Present exactly while the row is held — a spent row offers nothing to run. */
  readonly post?: { readonly command: string } | undefined;
}

/**
 * The `list --json` document — the contract `site/components/live/readReviewDrafts.ts` reads, pinned by
 * `src/__tests__/fixtures/contract/github-review-draft-list.json`.
 *
 * @param items the folded rows to print
 * @returns the document
 */
export function reviewDraftListDocument({ items }: { items: readonly ReviewDraftItem[] }): {
  readonly items: readonly ReviewDraftListEntry[];
} {
  return {
    items: items.map((item) => ({
      draft: item.draft,
      id: item.id,
      state: item.state,
      ...(item.resolvedIso === undefined ? {} : { resolvedIso: item.resolvedIso }),
      ...(item.outcome === undefined ? {} : { outcome: item.outcome }),
      ...(item.state === "held"
        ? { post: { command: reviewPostCommand({ digest: item.draft.digest, id: item.id }) } }
        : {}),
    })),
  };
}

/**
 * One scannable line per row: held rows, or every row with `--all`.
 *
 * @param items the folded rows
 * @param showResolved whether posted and dropped rows are printed too
 * @returns the lines
 */
export function reviewDraftListLines({
  items,
  showResolved,
}: {
  items: readonly ReviewDraftItem[];
  showResolved: boolean;
}): readonly string[] {
  const shown = showResolved ? items : items.filter((item) => item.state === "held");
  if (shown.length === 0) {
    return [showResolved ? "no review drafts recorded" : "no review drafts waiting on the owner"];
  }
  return shown.map(
    ({ id, state, draft }) =>
      `${id}  ${state}  ${draft.repo}#${String(draft.number)}  ${draft.verdict}  ` +
      `${String(draft.comments.length)} comment(s)  ${draft.why}`,
  );
}

/**
 * One review, whole: what would be posted, where, and each comment on the hunk it sits on.
 *
 * @param item the row
 * @returns the lines
 */
export function reviewDraftShowLines({ item }: { item: ReviewDraftItem }): readonly string[] {
  const { draft } = item;
  const lines: string[] = [
    `${item.id}  ${item.state}  ${draft.verdict} on ${draft.repo}#${String(draft.number)} — ${draft.title}`,
    `  ${draft.url}  head ${draft.headSha.slice(0, 10)}${draft.author === undefined ? "" : `  by @${draft.author}`}`,
    `  why: ${draft.why}`,
  ];
  if (draft.deeperReview !== undefined) {
    lines.push(`  deeper review offered: ${draft.deeperReview}`);
  }
  lines.push("", ...draft.body.split("\n").map((line) => `  ${line}`));
  for (const comment of draft.comments) {
    const where =
      comment.startLine === undefined
        ? `${comment.path}:${String(comment.line)}`
        : `${comment.path}:${String(comment.startLine)}-${String(comment.line)}`;
    lines.push("", `  ── ${where}`);
    for (const hunkLine of comment.hunk) {
      lines.push(`  ${HUNK_MARK[hunkLine.kind]}${hunkLine.text}`);
    }
    lines.push(...comment.body.split("\n").map((line) => `    ▸ ${line}`));
  }
  if (item.state === "held") {
    lines.push("", `  on the owner's word: ${reviewPostCommand({ digest: draft.digest, id: item.id })}`);
  } else if (item.outcome !== undefined) {
    lines.push("", `  ${item.state}: ${item.outcome}`);
  }
  return lines;
}

/** The marker a terminal draws before each hunk line, as a unified diff does. */
const HUNK_MARK: Readonly<Record<"header" | "add" | "del" | "context", string>> = {
  add: "+",
  context: " ",
  del: "-",
  header: "",
};
