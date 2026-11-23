/**
 * The pure half of `slopweaver briefing card`: hold ONE `open-pages.json` row to every gate the rendered page
 * is held to, then place it in the document — appended, or swapped in for the row that already names its url.
 *
 * ## What it replaces
 *
 * `cardsN-M.py`, a script every supervisor seat wrote per card: the six fields as Python literals, the word
 * and sentence caps re-asserted as bare `assert`s, a duplicate-url check, `rows.insert(0, row)` and a
 * `json.dump` — 122 copies in one scratch (count again with
 * `find ~/.slopweaver/supervisor-scratch -name 'cards*.py' | wc -l`), and once the Python gate closed that
 * road the same edit moved to `jq` and heredocs: 2,403 hand edits of `open-pages.json` and `form.json` in
 * one week. Every rule those asserts restated already lived in `./caps.ts`, `./cardVoice.ts`,
 * `./cardOptions.ts`, `./cardSubject.ts`, `./cardPremise.ts` and `./cardReadiness.ts`; what was missing was a
 * verb that applied them to a row BEFORE it reached the file.
 *
 * ## The gate is the page's own, over one card
 *
 * There is no field-level checker to call: every card rule in `./reactNowCard.ts` reads the rendered
 * `div.need`. So a row is judged the way the page judges it — projected to a ranked artifact
 * (`./openArtifacts.ts`), held to the index schema (`../outbound/briefing/schema.ts`), projected to a card
 * (`./openPageCards.ts`), rendered (`../outbound/briefing/render.ts`) and checked (`checkReactNowCards`) as
 * the one me-facing card of a one-card block. A row that passes here passes `--open-page-cards`; a row that
 * fails is refused with the same lines `briefing check` would have printed a sweep later.
 *
 * Unknown keys pass through untouched. The live document carries keys no projection reads (`readiness`,
 * `previousUrl`), and a verb that refused them would be unusable on the file it exists to edit.
 *
 * Pure: a row, a document, a ledger and a clock in; a verdict or an edited document out. No I/O.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { renderCard } from "../outbound/briefing/render.js";
import { openArtifactSchema } from "../outbound/briefing/schema.js";
import {
  type BriefingCard,
  type BriefingOpenArtifact,
  ME_FACING_ID,
  REACT_NOW_ID,
} from "../outbound/briefing/types.js";
import type { ExactVoiceRule } from "../outbound/voice/exactRules.js";
import { OPEN_ARTIFACTS_MAX_ITEMS } from "./caps.js";
import { stillAsks } from "./cardPremise.js";
import { briefingErrorLines } from "./errors.js";
import { projectOpenArtifacts } from "./openArtifacts.js";
import { projectOpenPageCards, type TypedOpenPage } from "./openPageCards.js";
import { type OpenPageRowError, OpenPageRowErrors } from "./openPageRowErrors.js";
import type { ReadPublishedPage } from "./publishedPageRead.js";
import { CARD_FIELD_LABELS, cardAboveFoldWords, checkReactNowCards } from "./reactNowCard.js";

/** What holding one row to the page's gates produced, when it passed. */
export interface OpenPageRowGate {
  /** The row as the ranked index would carry it — rank 1 of a one-row index. */
  readonly artifact: BriefingOpenArtifact;
  /** The row as a card, exactly as `--open-page-cards` would project it. */
  readonly card: BriefingCard;
  /** The card's words above the fold, against `CARD_ABOVE_FOLD_MAX_WORDS`. */
  readonly aboveFoldWords: number;
  /** The row's page, when its card's question and lean were typed rather than read from it; empty otherwise. */
  readonly typed: readonly TypedOpenPage[];
}

/** Where a row landed in the document. */
export interface OpenPageRowPlacement {
  /** The edited document, every other row byte-for-byte as it was. */
  readonly document: readonly unknown[];
  /** The row's 1-based position in the edited document. */
  readonly position: number;
  readonly action: "appended" | "replaced";
}

/**
 * The one-card react-now block a row is checked inside: the heading the checker keys on, and the me-facing
 * marker so the own-hand rules (`checkOwnHandWhat`, `checkCommandAboveFold`) run — a projected page card
 * lands in `meFacing`, so those are the rules it meets on the page.
 */
function oneCardBlock({ cardHtml }: { cardHtml: string }): string {
  return [
    `<h2 id="${REACT_NOW_ID}">react now</h2>`,
    `<h3 id="${ME_FACING_ID}">yours — nobody else sees it</h3>`,
    cardHtml,
  ].join("\n");
}

/**
 * One Zod issue's path as a composer reads it, or `row` when the issue is about the whole value.
 *
 * @param path the issue's path into the parsed value
 * @returns the dotted path, or `row` for an empty one
 */
function issuePath({ path }: { path: readonly PropertyKey[] }): string {
  if (path.length === 0) {
    return "row";
  }
  return path.join(".");
}

/**
 * The row as the ranked index carries it: readable, still asking, and inside the index schema's own caps.
 *
 * The schema leg is the one no projection runs — `ask`'s word and sentence caps and `label`'s length are
 * judged by `../outbound/briefing/schema.ts` only once the index is injected into the form at render, so a
 * row past them would have been written and refused a sweep later.
 */
function indexRow({
  row,
  ledgerText,
  nowIso,
}: {
  row: Record<string, unknown>;
  ledgerText: string;
  nowIso: string;
}): Result<readonly BriefingOpenArtifact[], OpenPageRowError> {
  const ranked = projectOpenArtifacts({ document: [row], ledgerText, nowIso });
  if (ranked.isErr()) {
    return err(OpenPageRowErrors.rowRefused({ defects: briefingErrorLines({ error: ranked.error }) }));
  }
  const artifact = ranked.value[0];
  if (artifact === undefined) {
    return err(OpenPageRowErrors.rowNotAnObject());
  }
  if (!stillAsks({ validity: artifact.validity })) {
    return err(OpenPageRowErrors.rowAlreadyRuled({ mark: artifact.validity.mark }));
  }
  const indexed = openArtifactSchema.safeParse(artifact);
  if (!indexed.success) {
    return err(
      OpenPageRowErrors.rowRefused({
        defects: indexed.error.issues.map((issue) => `${issuePath({ path: issue.path })}: ${issue.message}`),
      }),
    );
  }
  return ok(ranked.value);
}

/**
 * The card's own defects: everything `checkReactNowCards` finds in the rendered card, one line each, in the
 * words `briefing check` prints them — minus the card number, since there is one card.
 */
function cardDefects({
  cardHtml,
  nowIso,
  rules,
  applyVoice,
  applyFraming,
}: {
  cardHtml: string;
  nowIso: string;
  rules: readonly ExactVoiceRule[];
  applyVoice: boolean;
  applyFraming: boolean;
}): readonly string[] {
  const checked = checkReactNowCards({ applyFraming, applyVoice, html: oneCardBlock({ cardHtml }), nowIso, rules });
  return [
    ...checked.parseProblems,
    ...checked.defects.map((defect) => `${CARD_FIELD_LABELS[defect.field]} — ${defect.reason}`),
  ];
}

/**
 * Hold one row to every gate the rendered page applies to a projected card.
 *
 * @param row the row as parsed JSON
 * @param ledgerText the raw `lock-in.jsonl` contents, empty when the home has none
 * @param nowIso the run's own instant, which the card's age and a deferred ruling are judged against
 * @param pagesDirectory the home's `pages/` directory, the only place a card's page may live
 * @param readPage the seam onto a local page's newest frozen bytes, where the card's question and lean are read
 * @param rules the operator's private exact voice rules, empty when none are configured
 * @param applyVoice whether the packing and voice pass runs, lifted by the shared break-glass at the door
 * @param applyFraming whether the four card-framing rules run, lifted by their own break-glass at the door
 * @returns the artifact, the card and its budget, or the refusal carrying every defect
 */
export function gateOpenPageRow({
  row,
  ledgerText,
  nowIso,
  pagesDirectory,
  readPage,
  rules,
  applyVoice,
  applyFraming,
}: {
  row: unknown;
  ledgerText: string;
  nowIso: string;
  pagesDirectory: string;
  readPage: ReadPublishedPage;
  rules: readonly ExactVoiceRule[];
  applyVoice: boolean;
  applyFraming: boolean;
}): Result<OpenPageRowGate, OpenPageRowError> {
  if (!isRecord(row)) {
    return err(OpenPageRowErrors.rowNotAnObject());
  }
  const ranked = indexRow({ ledgerText, nowIso, row });
  if (ranked.isErr()) {
    return err(ranked.error);
  }
  const artifact = ranked.value[0]!;
  const cards = projectOpenPageCards({ document: [row], pagesDirectory, ranked: ranked.value, readPage });
  if (cards.isErr()) {
    return err(OpenPageRowErrors.rowRefused({ defects: briefingErrorLines({ error: cards.error }) }));
  }
  const card = cards.value.cards[0];
  if (card === undefined) {
    return err(OpenPageRowErrors.rowAlreadyRuled({ mark: artifact.validity.mark }));
  }
  const cardHtml = renderCard({ card, nowIso, position: 1 });
  const defects = cardDefects({ applyFraming, applyVoice, cardHtml, nowIso, rules });
  if (defects.length > 0) {
    return err(OpenPageRowErrors.rowRefused({ defects }));
  }
  return ok({ aboveFoldWords: cardAboveFoldWords({ cardHtml }), artifact, card, typed: cards.value.typed });
}

/** The 0-based index of the row naming this url, or -1 when none does. */
function indexOfUrl({ document, url }: { document: readonly unknown[]; url: string }): number {
  return document.findIndex((entry) => isRecord(entry) && entry["url"] === url);
}

/**
 * Place a gated row in the document: appended, or swapped in for the row that already names its url.
 *
 * The edited document is then held to the render's own index gate (`projectOpenArtifacts`) — a document one
 * of whose OTHER rows cannot be read is refused rather than written, because the file that comes out of this
 * function is the one `briefing render` reads next, and a verb that wrote a file the render refuses would
 * have moved the failure one step later without removing it.
 *
 * @param document the parsed `open-pages.json`
 * @param row the row, exactly as it was given — every key passes through
 * @param url the row's url, as the gate read it
 * @param replace whether a row already naming the url is swapped in place rather than refused
 * @param nowIso the run's own instant, for the index projection's ranking
 * @returns the edited document and where the row landed, or the refusal
 */
export function placeOpenPageRow({
  document,
  row,
  url,
  replace,
  nowIso,
}: {
  document: unknown;
  row: unknown;
  url: string;
  replace: boolean;
  nowIso: string;
}): Result<OpenPageRowPlacement, OpenPageRowError> {
  if (!Array.isArray(document)) {
    return err(OpenPageRowErrors.documentNotAnArray());
  }
  const rows: readonly unknown[] = document;
  const existing = indexOfUrl({ document: rows, url });
  let placement: OpenPageRowPlacement;
  if (existing >= 0 && !replace) {
    return err(OpenPageRowErrors.duplicateUrl({ position: existing + 1, url }));
  } else if (existing >= 0) {
    placement = {
      action: "replaced",
      document: rows.map((entry, index) => (index === existing ? row : entry)),
      position: existing + 1,
    };
  } else {
    placement = { action: "appended", document: [...rows, row], position: rows.length + 1 };
  }
  // THE RESULT, never the delta. `../outbound/briefing/schema.ts`'s index is `z.array(…).max(cap)`, which
  // judges the document the render receives — so a `--replace` on a file ALREADY over the cap wrote a page
  // the render refuses whole, while the verb reported success (measured: 51 rows in, 51
  // rows out, exit 0). Adding a row to a document the render is already refusing moves the failure a sweep
  // later rather than removing it, which is what this whole-document check exists to prevent.
  if (placement.document.length > OPEN_ARTIFACTS_MAX_ITEMS) {
    return err(
      OpenPageRowErrors.overCap({
        already: existing >= 0,
        cap: OPEN_ARTIFACTS_MAX_ITEMS,
        rows: placement.document.length,
      }),
    );
  }
  const index = projectOpenArtifacts({ document: placement.document, ledgerText: "", nowIso });
  if (index.isErr()) {
    return err(OpenPageRowErrors.documentRefused({ defects: briefingErrorLines({ error: index.error }) }));
  }
  return ok(placement);
}

/**
 * What `--open-page-cards` would refuse in the OTHER rows of the edited document — reported beside a write,
 * never as a reason to refuse one. An old row's defect is not this write's, and a verb that held a new row
 * hostage to it would send the chair back to the hand edit this verb exists to end.
 *
 * @param document the edited document
 * @param url the row this write placed, which is left out of the reading
 * @param ledgerText the raw `lock-in.jsonl` contents, empty when the home has none
 * @param nowIso the run's own instant
 * @param pagesDirectory the home's `pages/` directory
 * @param readPage the seam onto a local page's newest frozen bytes
 * @returns one line per row the render would refuse, empty when every other row projects to a card
 */
export function otherRowRefusals({
  document,
  url,
  ledgerText,
  nowIso,
  pagesDirectory,
  readPage,
}: {
  document: readonly unknown[];
  url: string;
  ledgerText: string;
  nowIso: string;
  pagesDirectory: string;
  readPage: ReadPublishedPage;
}): readonly string[] {
  const others = document.filter((entry) => !(isRecord(entry) && entry["url"] === url));
  const ranked = projectOpenArtifacts({ document: others, ledgerText, nowIso });
  if (ranked.isErr()) {
    return briefingErrorLines({ error: ranked.error });
  }
  const cards = projectOpenPageCards({ document: others, pagesDirectory, ranked: ranked.value, readPage });
  return cards.isErr() ? briefingErrorLines({ error: cards.error }) : [];
}
