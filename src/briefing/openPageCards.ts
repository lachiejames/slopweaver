/**
 * A react-now CARD per open page, projected from the same `--open-artifacts` document the ranked index reads.
 *
 * Each open page gets its own card, because the owner needs the what, the why, the options and the lean for
 * every page. Folding every open page beyond the authored cards into a numbered line inside ONE card's fold
 * would leave those fields existing for the five authored pages and for none of the other eighteen.
 *
 * ## Why this reads the document a second time rather than widening the reading
 *
 * `./openArtifacts.ts` owns what is OPEN and what the owner has RULED, and ranks the two together, so the
 * page at the top is known to be fresh. Carrying four prose fields through its reading
 * would put a card's authoring vocabulary inside the module whose whole job is judging validity, and a later
 * change to one would arrive in the diff of the other.
 *
 * So this module takes the ranked output as a VALUE and pairs it back to the document by URL. The rank is
 * read, never recomputed — a card's position is `./openArtifacts.ts`'s answer, so the cards and the band
 * beside them can never disagree about which page is freshest.
 *
 * ## The prose fields are AUTHORED, and the projection refuses without them
 *
 * There is no derivation here and that is the design rather than a gap. A `what` synthesised from a page's
 * `ask` would be the same sentence twice, and twenty-five cards of filler is a worse wall than the one fold
 * they replace — the exact failure rule 7 names, arrived at from the other direction. A sweep that has not
 * written the fields yet gets a refusal naming the page and the missing keys.
 *
 * ## Except the question and the lean, which a PAGE states and the card reads
 *
 * Those two are claims ABOUT the page, so a copy typed onto the entry can drift from it and read perfectly
 * while doing so — measured as a lock-in stamped with a lean the page never took
 * (`./pageCardMarks.ts` carries the instances). So for a subject that is a local page, the card's question and
 * lean are read from the page's newest FROZEN bytes, the version a lock-in rules against, and an entry that
 * types either beside the page's own marks is refused. A GitHub or Slack subject is not a page and keeps its
 * typed pair, because there is nothing to read it from.
 *
 * A page that marks neither is refused once it landed on or after {@link PAGE_MARKS_REQUIRED_FROM_ISO}. One
 * that landed before keeps its typed pair and is named in `typed` on every run: the live document held about
 * thirty local pages predating marks, every one typing both fields and none marking them, and refusing them all at once would take the owner's briefing dark — the
 * same trade this module's opt-in flag makes
 * (`skills/supervisor/reference/open-page-cards.md`). Republishing an old page with its marks moves it onto
 * the read path.
 *
 * ## The seventh field is the fold
 *
 * An entry may also carry a `detail`, which becomes the card's collapsed fold. It reads as a footnote and it
 * is not: a projection that discards it silently lets a composer write depth, pass `briefing check`, and serve
 * a card that shows none of it — see `./openPageEntry.ts`'s `decodeDetail` for why, and for how an entry is
 * decoded.
 *
 * Pure: a document, a ranked index and a page reader in, cards or refusals out. The reader answers from pages the
 * caller already fetched from the store (`./publishedPageRead.ts`), so this module does no I/O and reads no clock.
 * Only a page the store holds no freeze of may stand as typed before the cutoff; one that could not be read is
 * refused whenever it landed.
 */

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { BriefingCard, BriefingOpenArtifact } from "../outbound/briefing/types.js";
import { localPageSlug } from "../pages/url.js";
import { stillAsks } from "./cardPremise.js";
import { type BriefingError, BriefingErrors, briefingErrorLines } from "./errors.js";
import { lacksLocalCopy, localCopyRefusal } from "./localCopySubject.js";
import { decodeCardFields, type OpenPageCardFields, type QuestionAndLean, stringField } from "./openPageEntry.js";
import { readPageCardMarks } from "./pageCardMarks.js";
import type { ReadPublishedPage } from "./publishedPageRead.js";

/**
 * The instant from which a local page MUST mark its own question and lean to become a card.
 *
 * The day after this rule landed. Compared with the entry's `landedIso`, so a page already open
 * then keeps its typed pair until it is republished with marks or answered, and every page after it is read
 * at construction. See the module header for why the line is a date rather than a refusal of everything.
 */
export const PAGE_MARKS_REQUIRED_FROM_ISO = "2026-10-01T00:00:00Z";

/** A page whose card still carries a TYPED question and lean, because it landed before marks were required. */
export interface TypedOpenPage {
  readonly label: string;
  readonly url: string;
  /** Why the page could not supply them: it marks neither, or its bytes could not be read. */
  readonly why: string;
}

/** What the projection produced: the cards, and every page among them whose question and lean were typed. */
export interface ProjectedOpenPageCards {
  readonly cards: readonly BriefingCard[];
  readonly typed: readonly TypedOpenPage[];
}

/** One authored field as the single text run a cell of that length is. */
function runs({ text }: { text: string }): readonly [{ kind: "text"; text: string }] {
  return [{ kind: "text", text }];
}

/**
 * Build one card from a ranked page and its authored fields.
 *
 * The `subject` is the page's own link, which is what makes the card's title clickable — the same slot an
 * authored card uses for a pull request. It sits outside the field grid, so the voice pass never reads it and
 * a page whose own name is a colleague's sentence cannot refuse the whole render.
 */
function cardFor({ artifact, fields }: { artifact: BriefingOpenArtifact; fields: OpenPageCardFields }): BriefingCard {
  return {
    // THE FOLD, carried rather than dropped — see `decodeDetail` for what silence costs. Spread rather than assigned so an entry with no detail stays a card with no
    // `detail` key at all: `exactOptionalPropertyTypes` makes those two different values, and the
    // corrections diff (`../outbound/briefing/corrections.ts`) reads the second as unchanged.
    ...(fields.detail === undefined ? {} : { detail: fields.detail }),
    ifSilent: runs({ text: fields.ifSilent }),
    lean: runs({ text: fields.lean }),
    options: fields.options,
    question: fields.question,
    // READY, and derived rather than authored. The page this card projects is already published and already
    // waiting on the owner's word — that is the whole criterion `./openArtifacts.ts` ranked it by — so there is no
    // session for it to wait on. A composer cannot declare otherwise here, which is the point: readiness is
    // a fact about the subject, and this leg knows the subject.
    readiness: { state: "ready" },
    // THE AGE, carried from the page rather than invented here: a card dropping `landedIso` reaches the owner
    // with no age at all, however old it is (114 projected card-appearances measured in one morning carried none, one
    // on a card 23 hours old). `updatedIso`
    // travels beside it because a republish is what lapses a ruling, never what makes the question new —
    // `./cardPremise.ts` owns which of the two an age is computed from.
    premise: {
      kind: "artifact" as const,
      landedIso: artifact.landedIso,
      ...(artifact.updatedIso === undefined ? {} : { updatedIso: artifact.updatedIso }),
    },
    subject: { text: artifact.label, url: artifact.url },
    what: runs({ text: fields.what }),
    whyYou: runs({ text: fields.whyYou }),
  };
}

/**
 * The document's entries keyed by the URL each one names, for pairing back to a ranked row.
 *
 * Its own function because `projectOpenPageCards` scored over the branch-and-nesting ceiling once the
 * ruled-page guard landed beside it, and this loop is the half with no relation to the rest of the body.
 *
 * @param document the parsed `--open-artifacts` array
 * @returns each entry by its URL; an entry naming none is dropped, since nothing could pair it
 */
function documentByUrl({ document }: { document: readonly unknown[] }): ReadonlyMap<string, unknown> {
  const byUrl = new Map<string, unknown>();
  for (const entry of document) {
    const url = isRecord(entry) ? stringField({ key: "url", record: entry }) : undefined;
    if (url !== undefined) {
      byUrl.set(url, entry);
    }
  }
  return byUrl;
}

/** Where one page's question and lean come from, and the page to name when they are still typed. */
type PageSource =
  | { readonly kind: "resolved"; readonly page: QuestionAndLean; readonly typed?: TypedOpenPage }
  | { readonly kind: "refused"; readonly error: BriefingError };

/**
 * Where one ranked page's question and lean come from.
 *
 * A subject that is not a local page reads nothing, because there is no page to read. A local page that marks
 * both is read; one whose marks are malformed is refused whenever it landed, since a page that tried to mark
 * and got it wrong is never a legacy page, and so is one whose bytes could not be read. One that marks neither,
 * or that the store holds no freeze of, is refused from {@link PAGE_MARKS_REQUIRED_FROM_ISO} and typed before it.
 *
 * @param artifact the ranked page, whose `landedIso` is judged against the cutoff
 * @param readPage the seam onto the page's newest frozen bytes
 * @returns the source of the card's question and lean, or the refusal
 */
function pageSource({
  artifact,
  readPage,
}: {
  artifact: BriefingOpenArtifact;
  readPage: ReadPublishedPage;
}): PageSource {
  if (localPageSlug({ url: artifact.url }) === undefined) {
    return { kind: "resolved", page: { kind: "typed" } };
  }
  const html = readPage({ url: artifact.url });
  let why: string;
  if (html.isErr() && html.error.code !== "PAGES_NEVER_FROZEN") {
    // Only a page the store holds no freeze of may stand as typed: one that could not be read is never legacy.
    const unread = `its published bytes could not be read (${html.error.message})`;
    return {
      error: BriefingErrors.openPageUnmarked({ label: artifact.label, url: artifact.url, why: unread }),
      kind: "refused",
    };
  }
  if (html.isErr()) {
    why = `its published bytes could not be read (${html.error.message})`;
  } else {
    const marks = readPageCardMarks({ html: html.value });
    if (marks.isErr()) {
      return {
        error: BriefingErrors.openPageMarksInvalid({ label: artifact.label, problems: marks.error }),
        kind: "refused",
      };
    }
    if (marks.value.kind === "marked") {
      return { kind: "resolved", page: marks.value };
    }
    why = "the page marks no question and no lean";
  }
  if (Date.parse(artifact.landedIso) >= Date.parse(PAGE_MARKS_REQUIRED_FROM_ISO)) {
    return {
      error: BriefingErrors.openPageUnmarked({ label: artifact.label, url: artifact.url, why }),
      kind: "refused",
    };
  }
  return { kind: "resolved", page: { kind: "typed" }, typed: { label: artifact.label, url: artifact.url, why } };
}

/**
 * Every page {@link projectOpenPageCards} may read for this index — what a verb fetches from the store first. A page
 * that is not local reads nothing, so it is not asked for.
 *
 * @param ranked the ranked index the projection will follow
 * @returns each local page's address, in rank order
 */
export function openPageUrls({ ranked }: { ranked: readonly BriefingOpenArtifact[] }): readonly string[] {
  return ranked.map((artifact) => artifact.url).filter((url) => localPageSlug({ url }) !== undefined);
}

/**
 * Project one card per open page, in the order `./openArtifacts.ts` ranked them.
 *
 * @param document the parsed `--open-artifacts` file, the same array the ranked index read
 * @param ranked the ranked index, whose order this follows exactly
 * @param pagesDirectory the home's `pages/` directory, the only place a card's page may live
 * @param readPage the seam onto a local page's newest frozen bytes, where its question and lean are read
 * @returns one card per ranked page beside every page whose pair is still typed, or one refusal line per page
 *   that cannot become a card
 */
export function projectOpenPageCards({
  document,
  ranked,
  pagesDirectory,
  readPage,
}: {
  document: unknown;
  ranked: readonly BriefingOpenArtifact[];
  pagesDirectory: string;
  readPage: ReadPublishedPage;
}): Result<ProjectedOpenPageCards, BriefingError> {
  if (!Array.isArray(document)) {
    return err(BriefingErrors.openArtifactDocumentNotArray());
  }
  const byUrl = documentByUrl({ document });
  const cards: BriefingCard[] = [];
  const typed: TypedOpenPage[] = [];
  const refusals: string[] = [];
  for (const artifact of ranked) {
    const one = projectOne({ artifact, byUrl, pagesDirectory, readPage });
    if (one.kind === "refused") {
      refusals.push(...one.lines);
    } else if (one.kind === "card") {
      typed.push(...one.typed);
      cards.push(one.card);
    }
  }
  return refusals.length > 0 ? err(BriefingErrors.openPageCardsRefused({ reasons: refusals })) : ok({ cards, typed });
}

/**
 * One ranked page's card, why it cannot become one, or nothing when the owner's ruling already settled it. Split from
 * {@link projectOpenPageCards} for the complexity ceiling.
 *
 * @param byUrl the document's entries by address
 * @returns the card with its typed-pair note, the refusal lines, or `settled`
 */
function projectOne({
  artifact,
  byUrl,
  pagesDirectory,
  readPage,
}: {
  artifact: BriefingOpenArtifact;
  byUrl: ReadonlyMap<string, unknown>;
  pagesDirectory: string;
  readPage: ReadPublishedPage;
}):
  | { readonly kind: "settled" }
  | { readonly kind: "refused"; readonly lines: readonly string[] }
  | { readonly kind: "card"; readonly card: BriefingCard; readonly typed: readonly TypedOpenPage[] } {
  // A PAGE THE OWNER'S OWN RULING HAS SETTLED STOPS ASKING. `partly-ruled` and `superseded` both mean a steer
  // of the owner's already covers what this page wants, so a card carrying its question is a card the owner has
  // to read to discover they have answered it. The row stays in the ranked index, where
  // `skills/supervisor/reference/one-index.md` deliberately keeps it; only the card goes. This is the one
  // keyed, exact relation available, and it is narrower than "the owner has spoken since" on purpose —
  // `./cardPremise.ts` carries why the broader rule is not decidable here.
  if (!stillAsks({ validity: artifact.validity })) {
    return { kind: "settled" };
  }
  // A CARD'S PAGE IS ITS LOCAL COPY. A page the owner is asked to act on lives under this home's `pages/`,
  // never on claude.ai or in a temp directory — `./localCopySubject.ts` carries the rule and the measurement.
  if (lacksLocalCopy({ pagesDirectory, url: artifact.url })) {
    return { kind: "refused", lines: [localCopyRefusal({ label: artifact.label, pagesDirectory, url: artifact.url })] };
  }
  const entry = byUrl.get(artifact.url);
  if (entry === undefined) {
    return { kind: "refused", lines: [`the ranked index carries ${artifact.url}, which the document no longer holds`] };
  }
  // THE PAGE'S OWN QUESTION AND LEAN, read rather than typed — see the module header for how a typed copy
  // drifts from its page.
  const source = pageSource({ artifact, readPage });
  if (source.kind === "refused") {
    return { kind: "refused", lines: briefingErrorLines({ error: source.error }) };
  }
  const fields = decodeCardFields({ page: source.page, url: artifact.url, value: entry });
  if (fields.isErr()) {
    return { kind: "refused", lines: briefingErrorLines({ error: fields.error }) };
  }
  const typed = source.typed === undefined ? [] : [source.typed];
  return { card: cardFor({ artifact, fields: fields.value }), kind: "card", typed };
}

/**
 * The lines a run prints for every card whose question and lean were typed rather than read from its page.
 *
 * Printed on every run rather than once, because each is a card that can still drift from its page, and a
 * leftover nothing names is one nobody retires.
 *
 * @param typed the pages the projection named
 * @returns a heading and one line per page, or nothing when every card read its page
 */
export function typedPageLines({ typed }: { typed: readonly TypedOpenPage[] }): readonly string[] {
  if (typed.length === 0) {
    return [];
  }
  return [
    `--open-page-cards typed the question and lean of ${String(typed.length)} page(s) that landed before ` +
      `${PAGE_MARKS_REQUIRED_FROM_ISO}; republish each with data-card marks so its card reads them from the page:`,
    ...typed.map((page) => `  ${page.label}: ${page.why} (${page.url})`),
  ];
}
