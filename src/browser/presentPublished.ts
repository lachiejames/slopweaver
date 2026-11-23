/**
 * `browser present`'s question "is this page published", asked of the store before the pure resolve rather than
 * inside it. {@link resolvePresentTarget} is synchronous and the store is not, so the resolve runs twice: once
 * answering every page published, to learn which slugs it asks about, then over the store's answer for exactly those.
 * A request that names no local page never opens the store, so a Datadog or Linear tab opens with the store stopped.
 *
 * The second resolve is the one that counts. Should it ask about a slug the first did not, it is refused
 * (`PRESENT_PAGE_NOT_ASKED`) rather than answered "not published", so a page the store was never asked about is
 * never reported missing. Stage 4 of [the published pages doc](../../docs/store/published-pages.md).
 */
import { err, ok, type Result } from "#lib/result.js";

import type { PublishedPagesReadError } from "../store/publishedPages/readErrors.js";
import { type PresentError, type PresentRequest, type PresentTarget, resolvePresentTarget } from "./present.js";

/** Why `browser present` could not learn whether the pages it names are published. */
export type PresentPagesError =
  | {
      readonly code: "PRESENT_PAGE_STORE_UNREADABLE";
      readonly message: string;
      readonly cause: PublishedPagesReadError;
    }
  | { readonly code: "PRESENT_PAGE_NOT_ASKED"; readonly message: string; readonly slugs: readonly string[] };

/** The {@link PresentPagesError} factory. */
export const PresentPagesErrors = {
  notAsked: ({ slugs }: { slugs: readonly string[] }): PresentPagesError => ({
    code: "PRESENT_PAGE_NOT_ASKED",
    message: `browser present: the store was never asked about ${slugs.join(", ")}, so whether it is published is unknown`,
    slugs,
  }),
  storeUnreadable: ({ cause }: { cause: PublishedPagesReadError }): PresentPagesError => ({
    cause,
    code: "PRESENT_PAGE_STORE_UNREADABLE",
    message: `browser present: the store could not say whether the page is published: ${cause.message}`,
  }),
} as const;

/**
 * Resolve over the store's answer: learn which slugs the resolve asks about, ask the store once for all of them, and
 * resolve again over that answer.
 *
 * @param resolve the pure resolve, handed the published predicate it reads
 * @param publishedAmong asks the store which of the slugs are published
 * @returns the second resolve's answer, or why the store's answer could not be had
 */
export async function resolveOverPublishedPages<T>({
  resolve,
  publishedAmong,
}: {
  resolve: (pagePublished: (slug: string) => boolean) => T;
  publishedAmong: (input: {
    slugs: readonly string[];
  }) => Promise<Result<ReadonlySet<string>, PublishedPagesReadError>>;
}): Promise<Result<T, PresentPagesError>> {
  const asked = new Set<string>();
  const first = resolve((slug) => {
    asked.add(slug);
    return true;
  });
  if (asked.size === 0) {
    return ok(first);
  }
  const answer = await publishedAmong({ slugs: [...asked] });
  if (answer.isErr()) {
    return err(PresentPagesErrors.storeUnreadable({ cause: answer.error }));
  }
  const unasked = new Set<string>();
  const second = resolve((slug) => {
    if (!asked.has(slug)) {
      unasked.add(slug);
      return false;
    }
    return answer.value.has(slug);
  });
  if (unasked.size > 0) {
    return err(PresentPagesErrors.notAsked({ slugs: [...unasked] }));
  }
  return ok(second);
}

/**
 * Whether a refusal is the store's — it could not say, or was never asked — rather than the request's own. The
 * verb exits with an error for the first and a usage refusal for the second.
 *
 * @param error a refusal from {@link resolvePresentOverStore}
 * @returns true when the store, not the request, is why nothing opens
 */
export function isPresentPagesError(error: PresentError | PresentPagesError): error is PresentPagesError {
  return error.code === "PRESENT_PAGE_STORE_UNREADABLE" || error.code === "PRESENT_PAGE_NOT_ASKED";
}

/**
 * Resolve one `browser present` request to the page it opens, over the store's answer for every page it names.
 *
 * @param request the destination, the address or the page, exactly one
 * @param ddSite the environment's `DD_SITE`, or `undefined` when unset
 * @param consoleBase the console's origin with no trailing slash
 * @param publishedAmong asks the store which of the slugs are published
 * @returns the page, or the first reason it may not be opened
 */
export async function resolvePresentOverStore({
  request,
  ddSite,
  consoleBase,
  publishedAmong,
}: {
  request: PresentRequest;
  ddSite: string | undefined;
  consoleBase: string;
  publishedAmong: (input: {
    slugs: readonly string[];
  }) => Promise<Result<ReadonlySet<string>, PublishedPagesReadError>>;
}): Promise<Result<PresentTarget, PresentError | PresentPagesError>> {
  const resolved = await resolveOverPublishedPages({
    publishedAmong,
    resolve: (pagePublished) => resolvePresentTarget({ consoleBase, ddSite, pagePublished, request }),
  });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  return resolved.value.mapErr((refused): PresentError | PresentPagesError => refused);
}
