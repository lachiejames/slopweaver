/*
 * The generation fixture both `generationSupersessionEdges` files build their rows from: a trusted, readable top-up
 * generation of the synthetic acme-admin repository unless a case says otherwise.
 */
import type { GenerationInput } from "../../../../sweep/supersession.js";

const ACME_ADMIN = "acme/acme-admin";

/**
 * One generation row for `generationSupersessionEdges`, trusted and with a readable brief by default.
 *
 * @returns the row, its repository defaulting to the synthetic acme-admin one
 */
export function generation({
  slug,
  askedIso,
  repo = ACME_ADMIN,
  briefReads = true,
  trusted = true,
}: {
  slug: string;
  askedIso: string | undefined;
  repo?: string;
  briefReads?: boolean;
  trusted?: boolean;
}): GenerationInput {
  return { askedIso, briefReads, repo, slug, trusted };
}
