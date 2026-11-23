/**
 * An issue's or pull request's labels — read and add, split out of `./write.ts` to keep it under the repo's
 * 700-code-line file-size ratchet (`src/devLint/fileSizeRatchet.ts`).
 *
 * GitHub's `POST /issues/{n}/labels` CREATES a label the repository does not define, with a colour it picks
 * itself. That turns one typo into a permanent repository label nobody asked for, so the caller is given
 * {@link repoLabelsVia} to check against first rather than being trusted to spell.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { PrRef, RepoRef, WriteCtx } from "./write.js";

/** One issue's or pull request's current labels, and its own URL. */
export interface IssueLabelState {
  readonly labels: readonly string[];
  readonly htmlUrl: string;
}

/** How many pages of repository labels are read before stopping — a ceiling, never an unbounded fetch. */
const REPO_LABELS_MAX_PAGES = 5;
const REPO_LABELS_PAGE_SIZE = 100;

/**
 * Every label the repository DEFINES, paginated client-side — what a requested label is checked against.
 *
 * Capped at {@link REPO_LABELS_MAX_PAGES} pages (500 labels). A repository past that ceiling reports the
 * truncation to the caller rather than silently answering "not defined" for a label it never read.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository to read
 * @returns the defined label names and whether the read was truncated, or the provider failure
 */
export function repoLabelsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<{ readonly names: readonly string[]; readonly truncated: boolean }, IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const names: string[] = [];
      let truncated = true;
      for (let page = 1; page <= REPO_LABELS_MAX_PAGES; page += 1) {
        const res = await ctx.client.rest.issues.listLabelsForRepo({
          owner,
          page,
          per_page: REPO_LABELS_PAGE_SIZE,
          repo,
        });
        for (const label of res.data) {
          names.push(label.name);
        }
        if (res.data.length < REPO_LABELS_PAGE_SIZE) {
          truncated = false;
          break;
        }
      }
      return { names, truncated };
    },
    operation: "github.issues.listLabelsForRepo",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Narrow GitHub's label payload, which types a label as either a name string or an object.
 *
 * A nameless entry is DROPPED rather than coalesced to a blank name: a blank would compare equal to nothing
 * a caller could ask for, and would make the read-back check quietly unfalsifiable.
 */
function labelNamesOf({ labels }: { labels: readonly (string | { readonly name?: string })[] }): readonly string[] {
  return labels.flatMap((label) => {
    const name = typeof label === "string" ? label : label.name;
    return name === undefined || name.length === 0 ? [] : [name];
  });
}

/**
 * Read one issue's or pull request's current labels. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the issue or pull request to read
 * @returns the labels currently on it and its own URL, or the provider failure
 */
export function issueLabelsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef;
}): ResultAsync<IssueLabelState, IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.issues.get({ issue_number: number, owner, repo });
      return { htmlUrl: res.data.html_url, labels: labelNamesOf({ labels: res.data.labels }) };
    },
    operation: "github.issues.get",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Add labels to one issue or pull request. Sent once; the caller confirms with a separate read-back.
 *
 * Additive by GitHub's own semantics — this endpoint cannot remove a label — so a label already present is
 * left exactly as it is rather than re-applied.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the issue or pull request, and the label names to add
 * @returns the labels GitHub reports after the write, or the provider failure
 */
export function addIssueLabelsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef & { labels: readonly string[] };
}): ResultAsync<readonly string[], IngestError> {
  const { owner, repo, number, labels } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.issues.addLabels({
        issue_number: number,
        labels: [...labels],
        owner,
        repo,
      });
      return labelNamesOf({ labels: res.data });
    },
    operation: "github.issues.addLabels",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
