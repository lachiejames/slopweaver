/**
 * The `UNCARDED` verdict — an ask of the owner's that delivered a page and closed without that page ever reaching their
 * Queue. Pure: composed rows, their journals and the register facts in, candidates out.
 *
 * ## Why the sweep looks at TERMINAL rows for this one verdict
 *
 * Every other verdict in `./classify.ts` is about a LIVE row that no longer earns its keep, and a terminal row is
 * `KEEP — already terminal` there. This finding is the opposite shape: the row's closing is the defect. Nine
 * briefings the owner asked for were settled `answered` with `page:<slug>` as the witness and no question
 * ever asked (`../handover/pageDelivery.ts` carries the measurement). The closing gate stops the next one; this is
 * what finds the ones that closed before it existed, and any a hatch let through.
 *
 * ## What counts, and what does not
 *
 * A row is a subject only when it is `kind: ask`, has no `origin` (a `finding` row is a session's, not the owner's ask), and
 * is terminal by its register — a settlement, or a run that finished or closed. Its delivered page is its settlement
 * witness or its effective artifact, read by the exact spellings `pageDelivery.ts` accepts; prose is never read.
 *
 * Reach is judged board-wide here, where the gate judges one row: a page another row's card carries — the repair
 * card a later session registered for it, say — DID reach the owner, and reporting it again would be the stale finding
 * this sweep exists to prune. {@link pagesCardedOnBoard} builds that map once per pass.
 *
 * Age is never a criterion, exactly as `./classify.ts`'s rule says: the verdict is carried by the witness and the
 * absence of a card, and its act is `none` — what to do about it is the daily Queue card's question.
 */
import { shapeCompleteness } from "../handover/askShape.js";
import type { BoardModel } from "../handover/boardTypes.js";
import type { RunEvent } from "../handover/ledger.js";
import { artifactPageSlug, cardTextOf, uncardedPageSlugs } from "../handover/pageDelivery.js";
import { pageSlugFromReference, pageSlugsNamedIn, stringLeaves } from "../handover/pageReference.js";
import { pageIdentity } from "../pages/url.js";

import type { SweepCandidate } from "./classify.js";

/** The register facts one pass reads once and every row is judged against. */
export interface BoardReachFacts {
  /** Every lock-in identity the owner has ruled on. */
  readonly ruledIdentities: ReadonlySet<string>;
  /** Page slug to a hand step naming it. */
  readonly handPageSteps: ReadonlyMap<string, string>;
  /** Page slug to a board row whose Queue card carried it ({@link pagesCardedOnBoard}). */
  readonly cardedOnBoard: ReadonlyMap<string, string>;
}

/** Whether a row's register says it has closed: a settlement, or a run that finished or closed. */
function isTerminal({ model }: { model: BoardModel }): boolean {
  return model.derived.settlement !== undefined || model.run.kind === "finished" || model.run.kind === "closed";
}

/** The pages a row delivered: its settlement witness and its effective artifact, deduplicated. */
function deliveredPages({
  model,
  events,
  home,
}: {
  model: BoardModel;
  events: readonly RunEvent[];
  home: string;
}): readonly string[] {
  const pages: string[] = [];
  const witness = model.derived.settlementWitness;
  if (witness !== undefined) {
    const slug = pageSlugFromReference({ home, reference: witness });
    if (slug !== undefined) {
      pages.push(slug);
    }
  }
  const artifact = artifactPageSlug({ doc: model.doc, events, home });
  if (artifact !== undefined && !pages.includes(artifact)) {
    pages.push(artifact);
  }
  return pages;
}

/** The pages one row's Queue card ever carried: any card a question drew, and a wholly shaped registered ask. */
function pagesOnRowCard({
  model,
  events,
  home,
}: {
  model: BoardModel;
  events: readonly RunEvent[];
  home: string;
}): readonly string[] {
  const texts = events.flatMap((event) => [...cardTextOf({ event })]);
  const { doc } = model;
  if (
    doc.kind === "ask" &&
    shapeCompleteness({ lean: doc.lean, options: doc.options, problem: doc.problem }) === "whole"
  ) {
    texts.push(...stringLeaves({ value: [doc.summary, doc.problem, doc.lean, doc.options] }));
  }
  return texts.flatMap((text) => pageSlugsNamedIn({ home, text }));
}

/**
 * Page slug to the first board row whose Queue card carried it — asked in its journal, or named by its registered
 * shape — so a page carded on ANY row reads as having reached the owner.
 *
 * @param models every composed row, terminal ones included
 * @param journals each row's journal events, keyed by slug
 * @param home the state home a `file:` page must live under
 * @returns the map
 */
export function pagesCardedOnBoard({
  models,
  journals,
  home,
}: {
  models: readonly BoardModel[];
  journals: ReadonlyMap<string, { readonly events: readonly RunEvent[] }>;
  home: string;
}): ReadonlyMap<string, string> {
  const carded = new Map<string, string>();
  for (const model of models) {
    // A row nobody ever ran has no journal and can still carry a card by its registered shape.
    const journal = journals.get(model.doc.slug);
    const events = journal === undefined ? [] : journal.events;
    for (const page of pagesOnRowCard({ events, home, model })) {
      if (!carded.has(page)) {
        carded.set(page, model.doc.slug);
      }
    }
  }
  return carded;
}

/**
 * The `UNCARDED` candidate one composed row earns, or undefined when it earns none.
 *
 * @param model the composed row
 * @param events its journal
 * @param home the state home a `file:` page must live under
 * @param facts the pass's register facts
 * @returns the candidate, `act: none`, its witness naming each page and the terminal that closed the row
 */
export function uncardedCandidate({
  model,
  events,
  home,
  facts,
}: {
  model: BoardModel;
  events: readonly RunEvent[];
  home: string;
  facts: BoardReachFacts;
}): SweepCandidate | undefined {
  const { doc } = model;
  if (doc.kind !== "ask" || doc.origin !== undefined || !isTerminal({ model })) {
    return undefined;
  }
  const delivered = deliveredPages({ events, home, model }).filter((page) => !facts.cardedOnBoard.has(page));
  if (delivered.length === 0) {
    return undefined;
  }
  const missing = uncardedPageSlugs({
    facts: { doc, events, handPageSteps: facts.handPageSteps, ruledIdentities: facts.ruledIdentities },
    home,
    slugs: delivered,
  });
  if (missing.length === 0) {
    return undefined;
  }
  const closedBy =
    model.derived.settlement === undefined
      ? `its run ${model.run.kind}`
      : `settled ${model.derived.settlement} with witness ${String(model.derived.settlementWitness)}`;
  return {
    act: "none",
    path: doc.path,
    slug: doc.slug,
    verdict: "UNCARDED",
    witness: `${closedBy}; ${missing.map((page) => pageIdentity({ slug: page })).join(", ")} never reached the owner's Queue — no question naming it, no ruling, no hand step, no other row's card`,
  };
}
