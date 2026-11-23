/**
 * The ONE set of capability ids live routing never offers and never accepts.
 *
 * It lives here, below both consumers, because it was declared twice and the two copies diverged — which is
 * the whole of the defect this module was extracted to end. `../live/turn/judgement.ts` dropped the corpus
 * from its own copy, replacing the reservation with the `DecisionTruthMode` invariant so the
 * corpus could be NAMED in a plan (the corpus is one of the tools in the toolkit). The
 * copy in `./routingCapabilities.ts` was never touched, so the inventory went on refusing to OFFER the very
 * capability the judge had started accepting. Nothing failed — the roster simply came back with no history
 * in it, and a worker asked for history answered from current state.
 *
 * **The set is EMPTY, and that is a fact about the vocabulary rather than a placeholder.** A reservation
 * here says "this id names nothing in any table, generic or private, so a decision requesting it is confused
 * about its own vocabulary", and every id the vocabulary now carries names a real row. `corpus` is the
 * clearest case. It sat here precisely because it was a SYNONYM nothing answered to, and it is now the id of
 * the history row itself (`./genericCapabilities.ts`). The mechanism stays because the divergence it closed
 * is a property of having two copies, not of having entries.
 *
 * **Why the RETIRED spelling is not here either**, which is the question a reader arrives with: this set is
 * read by `./profile.ts`'s ROW schema, and `../live/turn/brief.ts` decodes every persisted brief's
 * capability rows through that same schema. A brief written before the rename carries the history row under
 * its old id, so reserving that id would refuse the brief rather than the decision — a read regression for
 * an id nobody can request any more anyway, since the roster never offers it and
 * `../live/turn/judgement.ts` already refuses a need no partition offered.
 *
 * This is NOT the overlay restriction in `./profile.ts`, which refuses a private profile that tries to
 * REPLACE the built-in `corpus` row. Stopping an installation from substituting its own history source and
 * stopping a decision from naming an id nothing answers to are different rules, and only the second is here.
 */

/** Capability ids a live routing decision may never request, and the inventory may never offer. */
export const RESERVED_LIVE_NEED_IDS: ReadonlySet<string> = new Set<string>();
