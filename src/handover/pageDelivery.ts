/**
 * Whether a page a run delivered ever REACHED the owner — the pure half of the uncarded-page rule.
 *
 * ## The defect, measured
 *
 * Over one stretch, 39 pages were published and nine the owner had asked for had finished with no Queue card at all. Each was a registered `kind: ask` row a seat picked up, the
 * seat published `$SLOPWEAVER_HOME/pages/<slug>/index.html`, then ran `handover settle <row> --as answered
 * --witness page:<slug>` and `handover finish`. The Queue draws only a row whose `ownerWait` is the owner's
 * (`./ownerWait.ts`) and a hand step, and none of those journals holds a `question` event, so nothing ever drew a
 * card: the row left the board and the page sat in a directory the owner does not visit. Reproduce on one such row:
 * `slopweaver handover show <slug>` prints its settlement and no `question` event.
 *
 * ## The rule
 *
 * A terminal transition on a row whose deliverable is page `p` proceeds only when one of these facts holds:
 *
 * - a card a question drew THIS cycle carried `p`: while `p` is the row's effective artifact, one drawn after it
 *   became so by journal order; otherwise one whose text names `p`;
 * - the row carries a ruling of the owner's;
 * - the lock-in ledger holds the owner's ruling on `page:p`;
 * - a hand step the owner was shown names `p`.
 *
 * A bare `kind: ask` is not evidence: the measured rows were exactly that. Nor is a registered ask's own card, however
 * whole its shape: its text is front matter no journal orders. A question naming a DIFFERENT page is not evidence
 * either, so an old ask cannot clear a newly published page.
 *
 * The residue, stated: the doc, the lock-in ledger and the hand register are files on a shared home, and a hand edit
 * of one can manufacture a ruling or a step. The gate catches a seat that forgets to card a page, not one forging
 * state — the same partial protection `.claude/rules/journalled-grants.md` names.
 *
 * ## Exact references only
 *
 * A page is named only by the exact spellings `./pageReference.ts` reads; name similarity and a prose mention of a
 * slug are not references.
 *
 * Pure: parsed docs, events and already-projected register facts in, a verdict out. No filesystem, no clock — the
 * effectful shell is `../cli/commands/handover/uncardedPageGate.ts`.
 */
import { pageIdentity } from "../pages/url.js";
import { derivedRowState } from "./derivedRowState.js";
import type { HandoverDoc } from "./doc.js";
import type { RunEvent } from "./ledger.js";
import { pageSlugFromReference, pageSlugsNamedIn, stringLeaves } from "./pageReference.js";

/** Which fact showed the page reached the owner — the first one found, named so a receipt can say which. */
export type PageReachEvidence =
  | { readonly kind: "queue-question"; readonly atIso: string }
  | { readonly kind: "row-ruling" }
  | { readonly kind: "page-ruling"; readonly identity: string }
  | { readonly kind: "hand-step"; readonly stepId: string };

/** Everything the rule reads about one row, already off disk. */
export interface PageReachFacts {
  readonly doc: HandoverDoc;
  readonly events: readonly RunEvent[];
  /** Every lock-in identity the owner has ruled on, `page:<slug>` among them. */
  readonly ruledIdentities: ReadonlySet<string>;
  /** Page slug to the id of a hand step that names it, over every step ever posted. */
  readonly handPageSteps: ReadonlyMap<string, string>;
}

/** Whether any string leaf of a value names the page. */
function namesPage({ home, slug, value }: { home: string; slug: string; value: unknown }): boolean {
  return stringLeaves({ value }).some((text) => pageSlugsNamedIn({ home, text }).includes(slug));
}

/**
 * The row's effective artifact: the latest `artifact` event, else the front matter's `artifact:` unless it is the
 * placeholder a fresh doc carries.
 *
 * @param doc the row
 * @param events its journal
 * @returns the pointer, or undefined when the row names none
 */
function effectiveArtifact({ doc, events }: { doc: HandoverDoc; events: readonly RunEvent[] }): string | undefined {
  const derived = derivedRowState({ doc, events }).artifact;
  if (derived !== undefined) {
    return derived;
  }
  return doc.artifactIsPlaceholder ? undefined : doc.artifact;
}

/**
 * The page a row's effective artifact names, when it names one.
 *
 * @param home the state home a `file:` page must live under
 * @param doc the row
 * @param events its journal
 * @returns the slug, or undefined when the artifact is absent or not a page
 */
export function artifactPageSlug({
  home,
  doc,
  events,
}: {
  home: string;
  doc: HandoverDoc;
  events: readonly RunEvent[];
}): string | undefined {
  const artifact = effectiveArtifact({ doc, events });
  return artifact === undefined ? undefined : pageSlugFromReference({ home, reference: artifact });
}

/**
 * From which journal POSITION the row's card has shown the page as its artifact chip: the first `artifact` event
 * naming it since the last one naming anything else, or `-1` when the front matter names it and no event moved it.
 * A card renders the CURRENT artifact, so a question asked before the page was published never carried it: publish after the card was drawn, then settle, and the owner never sees the page. Append order,
 * never the instant: two events can share a millisecond, and a tie read as "after" would let a pre-publish question
 * through.
 */
function artifactShownFrom({
  facts,
  home,
  slug,
}: {
  facts: PageReachFacts;
  home: string;
  slug: string;
}): number | undefined {
  if (artifactPageSlug({ doc: facts.doc, events: facts.events, home }) !== slug) {
    return undefined;
  }
  const artifacts = facts.events.flatMap((event, index) => (event.kind === "artifact" ? [{ event, index }] : []));
  if (artifacts.length === 0) {
    // The front matter alone names it: the card has carried it since it was first drawn.
    return -1;
  }
  // The run of events naming this page that the LAST event naming anything else left standing; none when it is last.
  const lastOther = artifacts.findLastIndex(
    ({ event }) => pageSlugFromReference({ home, reference: event.url }) !== slug,
  );
  return artifacts[lastOther + 1]?.index;
}

/**
 * The text a card an event DREW shows above its fold: a `question`'s text, problem, options, lean, stakes and
 * examples, and only the corrected `question` of a `question-corrected` — its `why` is journal metadata no card
 * renders (`./openQuestion.ts`). Never a drafted message (`action`): its body folds on the card, so a page named on a
 * hidden line reached nobody, and an allowlist cannot be widened by a field nobody looked at. Every other kind draws
 * nothing: a withdrawal REMOVES the card, and a post, offer, reconfirm, shape, example or shot only annotates one
 * already drawn. A withdrawal after the publish, a page named only in a correction's `why`, and one on a mail
 * body's ninth line would each read as a card carrying the page, and none does.
 *
 * @param event one journal event
 * @returns the strings the card renders
 */
export function cardTextOf({ event }: { event: RunEvent }): readonly string[] {
  if (event.kind === "question-corrected") {
    return [event.question];
  }
  if (event.kind !== "question") {
    return [];
  }
  const options =
    event.options === undefined ? [] : event.options.flatMap((option) => [option.option, option.tradeoff]);
  const stakes =
    event.stakes === undefined ? [] : [event.stakes.risk, event.stakes.blastRadius, event.stakes.stillReal];
  const examples = event.examples === undefined ? [] : [...event.examples];
  return [event.question, event.problem, ...options, event.lean, ...stakes, ...examples, event.exampleGap].filter(
    (text): text is string => text !== undefined,
  );
}

/**
 * The journal positions this cycle at which a Queue card was drawn: every `question`, and a `question-corrected`
 * only while a question is still waiting — a correction with nothing open redraws nothing, the phase fold's own rule.
 */
function cardDrawings({ events }: { events: readonly RunEvent[] }): readonly { event: RunEvent; index: number }[] {
  const start = events.map((event) => event.kind).lastIndexOf("started");
  if (start === -1) {
    return [];
  }
  const drawings: { event: RunEvent; index: number }[] = [];
  let waiting: string | undefined;
  events.forEach((event, index) => {
    if (index < start) {
      return;
    }
    if (event.kind === "question") {
      waiting = event.question;
      drawings.push({ event, index });
    } else if (event.kind === "question-corrected" && waiting !== undefined) {
      waiting = event.question;
      drawings.push({ event, index });
    } else if (event.kind === "answered" || (event.kind === "question-withdrawn" && event.question === waiting)) {
      waiting = undefined;
    }
  });
  return drawings;
}

/**
 * The first card drawn this cycle that carried the page onto the Queue. While the page is the row's artifact, only a
 * card drawn AFTER it became so counts, named or not — a question naming a page not yet published linked to nothing.
 * Otherwise the card must name the page itself.
 */
function queueQuestion({
  facts,
  home,
  slug,
}: {
  facts: PageReachFacts;
  home: string;
  slug: string;
}): PageReachEvidence | undefined {
  const from = artifactShownFrom({ facts, home, slug });
  const carrying = cardDrawings({ events: facts.events }).find(({ event, index }) =>
    from === undefined ? namesPage({ home, slug, value: cardTextOf({ event }) }) : index > from,
  );
  return carrying === undefined ? undefined : { atIso: carrying.event.atIso, kind: "queue-question" };
}

/**
 * The first fact showing one page reached the owner, or undefined when none does. A registered ask's own card is
 * deliberately NOT one: its text is front matter, which no journal orders, so nothing can say the card showing the
 * page was ever drawn, since the reference could have been edited in after the card had gone. A page a
 * registration card carried closes with a question, or the hatch; the board sweep still reads such a card.
 *
 * @param facts the row and the register facts already read
 * @param home the state home a `file:` page must live under
 * @param slug the page being judged
 * @returns the evidence, checked in the order the module header lists
 */
export function pageReachEvidence({
  facts,
  home,
  slug,
}: {
  facts: PageReachFacts;
  home: string;
  slug: string;
}): PageReachEvidence | undefined {
  const asked = queueQuestion({ facts, home, slug });
  if (asked !== undefined) {
    return asked;
  }
  if (derivedRowState({ doc: facts.doc, events: facts.events }).ruling !== undefined) {
    return { kind: "row-ruling" };
  }
  const identity = pageIdentity({ slug });
  if (facts.ruledIdentities.has(identity)) {
    return { identity, kind: "page-ruling" };
  }
  const stepId = facts.handPageSteps.get(slug);
  return stepId === undefined ? undefined : { kind: "hand-step", stepId };
}

/**
 * The pages among the candidates that never reached the owner.
 *
 * @param facts the row and the register facts already read
 * @param home the state home a `file:` page must live under
 * @param slugs the pages the row delivered
 * @returns each one with no reach evidence, deduplicated, in candidate order
 */
export function uncardedPageSlugs({
  facts,
  home,
  slugs,
}: {
  facts: PageReachFacts;
  home: string;
  slugs: readonly string[];
}): readonly string[] {
  return [...new Set(slugs)].filter((slug) => pageReachEvidence({ facts, home, slug }) === undefined);
}

/** The hand-step fields its note and card draw for the owner, read structurally so a posted step and a fixture both fit. */
interface NoteDrawnStep {
  readonly id: string;
  readonly what?: string | undefined;
  readonly literal?: string | undefined;
  readonly where?: string | undefined;
  readonly url?: string | undefined;
  readonly opened?: string | undefined;
  readonly unblocks?: string | undefined;
  readonly ifIgnored?: string | undefined;
  readonly unaddressed?: string | undefined;
  readonly witness?: string | undefined;
  readonly details?: readonly string[] | undefined;
  readonly cites?: readonly string[] | undefined;
  readonly shot?: { readonly boxes: readonly { readonly label: string }[] } | undefined;
  readonly quotes?: readonly { readonly text: string }[] | undefined;
  readonly checklist?:
    | readonly {
        readonly action: string;
        readonly command?: string | undefined;
        readonly find?: readonly string[] | undefined;
        readonly url?: string | undefined;
      }[]
    | undefined;
  readonly decision?:
    | {
        readonly problem: string;
        readonly options: readonly { readonly option: string; readonly tradeoff: string }[];
        readonly lean: string;
        readonly stakes: { readonly risk: string; readonly blastRadius: string; readonly stillReal: string };
      }
    | undefined;
}

/**
 * The text a step's note draws for the owner — its sentence, addresses, citations, screenshot box labels, copy block, prose,
 * quotes, checklist and carried
 * decision. Never its bookkeeping (`id`, `postedBy`, `postedIso`, `row`, `context`, `recheck`): `hand post
 * --by-session` copies free text into `postedBy`, so a page named there reached nobody.
 *
 * @returns every drawn string, in no particular order
 */
function noteDrawnTexts({ step }: { step: NoteDrawnStep }): readonly string[] {
  const single = [
    step.what,
    step.literal,
    step.where,
    step.url,
    step.opened,
    step.unblocks,
    step.ifIgnored,
    step.unaddressed,
    step.witness,
  ];
  const lines =
    step.checklist === undefined
      ? []
      : step.checklist.flatMap((line) => [
          line.action,
          line.command,
          line.url,
          ...(line.find === undefined ? [] : [...line.find]),
        ]);
  const decision = step.decision;
  const decided =
    decision === undefined
      ? []
      : [
          decision.problem,
          ...decision.options.flatMap((option) => [option.option, option.tradeoff]),
          decision.lean,
          decision.stakes.risk,
          decision.stakes.blastRadius,
          decision.stakes.stillReal,
        ];
  const quoted = step.quotes === undefined ? [] : step.quotes.map((quote) => quote.text);
  const details = step.details === undefined ? [] : [...step.details];
  const cites = step.cites === undefined ? [] : [...step.cites];
  const labels = step.shot === undefined ? [] : step.shot.boxes.map((box) => box.label);
  return [...single, ...lines, ...decided, ...quoted, ...details, ...cites, ...labels].filter(
    (text): text is string => text !== undefined,
  );
}

/**
 * Project hand steps into the page-to-step map {@link PageReachFacts} carries — every step ever posted counts,
 * settled ones included, because the question is whether the page reached a note, not whether one is still open.
 * Only the text the note draws is read ({@link noteDrawnTexts}).
 *
 * @param home the state home a `file:` page must live under
 * @param steps each posted step, read for the fields its note draws
 * @returns page slug to the first step id naming it
 */
export function handPageStepsOf({
  home,
  steps,
}: {
  home: string;
  steps: readonly NoteDrawnStep[];
}): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const step of steps) {
    for (const text of noteDrawnTexts({ step })) {
      for (const slug of pageSlugsNamedIn({ home, text })) {
        if (!map.has(slug)) {
          map.set(slug, step.id);
        }
      }
    }
  }
  return map;
}
