/**
 * Repository labels with their colour and description, as `github repo --apply-manifest` reads and CREATES them.
 * It never updates, renames or deletes one: an existing label is somebody's, and the apply refuses a same-name
 * label that differs rather than overwriting it. On the write lane's context (`./writeCtx.ts`), so a create is
 * sent once.
 *
 * The list read refuses a truncated answer rather than returning what it saw: a collision check over a partial
 * list would call a label new that already exists past the last page read.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { errAsync, okAsync, type ResultAsync } from "../../lib/result.js";
import type { RepoRef } from "./write.js";
import type { WriteCtx } from "./writeCtx.js";

/** One label as GitHub holds it. */
export interface RepoLabel {
  readonly name: string;
  /** Six hexadecimal characters, no `#`, as GitHub returns it. */
  readonly color: string;
  readonly description: string | null;
}

const LABELS_MAX_PAGES = 5;
const LABELS_PAGE_SIZE = 100;

/**
 * Read every label the repository defines. Repeatable.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository to read
 * @returns every label, or an error when the repository holds more than the read ceiling
 */
export function listRepoLabelsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef;
}): ResultAsync<readonly RepoLabel[], IngestError> {
  const { owner, repo } = input;
  return safeProviderCall({
    execute: async () => {
      const labels: RepoLabel[] = [];
      for (let page = 1; page <= LABELS_MAX_PAGES; page += 1) {
        const res = await ctx.client.rest.issues.listLabelsForRepo({ owner, page, per_page: LABELS_PAGE_SIZE, repo });
        for (const label of res.data) {
          labels.push({ color: label.color, description: label.description, name: label.name });
        }
        if (res.data.length < LABELS_PAGE_SIZE) {
          return labels;
        }
      }
      throw new Error(
        `${owner}/${repo} defines more than ${String(LABELS_MAX_PAGES * LABELS_PAGE_SIZE)} labels, so whether a label exists is unknown`,
      );
    },
    operation: "github.issues.listLabelsForRepo",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Read one label by name. Repeatable; GitHub matches the name without regard to case.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository and the label name
 * @returns the label, or undefined when GitHub answers 404
 */
export function getRepoLabelVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly name: string };
}): ResultAsync<RepoLabel | undefined, IngestError> {
  const { owner, repo, name } = input;
  return safeProviderCall({
    execute: async (): Promise<RepoLabel | undefined> => {
      const { data } = await ctx.client.rest.issues.getLabel({ name, owner, repo });
      return { color: data.color, description: data.description, name: data.name };
    },
    operation: "github.issues.getLabel",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  }).orElse((error) => (error.status === 404 ? okAsync(undefined) : errAsync(error)));
}

/**
 * Create one label. Sent once; the caller confirms it by reading the label back.
 *
 * @param ctx the shared write-lane client and rate-limit scope
 * @param input the repository and the label to create
 * @returns nothing on GitHub's acceptance
 */
export function createRepoLabelVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { readonly label: RepoLabel };
}): ResultAsync<void, IngestError> {
  const { owner, repo, label } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.issues.createLabel({
        color: label.color,
        name: label.name,
        owner,
        repo,
        ...(label.description === null ? {} : { description: label.description }),
      });
    },
    operation: "github.issues.createLabel",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
