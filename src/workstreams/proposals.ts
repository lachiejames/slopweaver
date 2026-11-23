/**
 * A workstream a person proposes in their own words, kept in `proposals.jsonl` until a mining pass reads it into a
 * candidate with evidence, definitions of done and the people to loop in.
 *
 * Reading the candidates, the owner SPLITS one from a neighbour (a separate workstream around a wider concern),
 * answers one with "not this, but THIS instead", spawns an adjacent one while marking another done, and proposes one
 * outright. Each is what they want, said rather than mined, so it is kept as said and the next mine owes it a
 * candidate.
 *
 * Pure. `./proposalStore.ts` is the effectful half.
 */
import { z } from "zod";

import { type Candidate, idSchema, REACTION_VIAS, textSchema } from "./candidates.js";

/**
 * How a proposal stands to the candidate it was said beside: split off it, instead of it, a sibling beside it — or
 * `own`, proposed with no candidate in view.
 */
export const PROPOSAL_RELATIONS = ["split", "instead", "sibling", "own"] as const;

/** One proposals.jsonl row. */
export const proposalRowSchema = z
  .strictObject({
    /** Where the owner said it, when a session relayed it; `null` for a console press. */
    anchor: textSchema.nullable(),
    bySession: textSchema,
    /** The candidate it was said beside, or `null` for one proposed outright. */
    from: idSchema.nullable(),
    id: z.string().regex(/^p-\d{3,}$/u, "a proposal id is p- and three or more digits"),
    iso: z.iso.datetime(),
    relation: z.enum(PROPOSAL_RELATIONS),
    title: textSchema,
    via: z.enum(REACTION_VIAS),
    /** What the owner wants from it, in their words, when they said more than its title. */
    why: textSchema.nullable(),
  })
  .refine((row) => (row.relation === "own") === (row.from === null), {
    message: "a proposal said beside a candidate names it (from) and how it relates; one proposed outright is own",
    path: ["from"],
  });

/** One proposals.jsonl row. */
export type ProposalRow = z.infer<typeof proposalRowSchema>;

/** A proposal, and the candidate a mining pass has read it into — `null` while the next mine still owes one. */
export type ProposalView = ProposalRow & { readonly minedAs: string | null };

/**
 * The id the next proposal takes: one past the highest standing, three digits at least.
 *
 * @param rows every proposal recorded so far
 * @returns e.g. `p-004`
 */
export function nextProposalId({ rows }: { rows: readonly ProposalRow[] }): string {
  const highest = rows.reduce((most, row) => Math.max(most, Number(row.id.slice(2))), 0);
  return `p-${String(highest + 1).padStart(3, "0")}`;
}

/**
 * Each proposal and the candidate it became, by the candidate's own `proposal` field.
 *
 * @param catalog every candidate the owner can answer (`./candidateCatalog.ts`)
 * @returns the proposals in the order the owner made them
 */
export function proposalViews({
  catalog,
  rows,
}: {
  catalog: { readonly candidates: readonly Candidate[] };
  rows: readonly ProposalRow[];
}): readonly ProposalView[] {
  const minedAs = new Map<string, string>();
  for (const candidate of catalog.candidates) {
    if (candidate.proposal !== null) {
      minedAs.set(candidate.proposal, candidate.id);
    }
  }
  return rows.map((row) => {
    const mined = minedAs.get(row.id);
    // oxlint-disable-next-line prefer-nullish-coalescing -- no-silent-fallback bans `?? null`; not mined yet is by design
    return { ...row, minedAs: mined === undefined ? null : mined };
  });
}
