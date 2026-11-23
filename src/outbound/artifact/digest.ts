/**
 * The ALERT-DIGEST form, and the pure derivation that turns it into a card.
 *
 * ## Why this exists rather than a documented recipe
 *
 * An {@link UpdateArtifact} is a LAYOUT: it says "this line is above the fold, that table is below it". A
 * daily alert digest is DOMAIN DATA: four issues, each with a severity, a count and a ticket. Handing the
 * layout decision to whatever composes the digest — in practice a model, since the prose is model-authored —
 * means the correctness of the result depends on the composer getting `index` ordering, table columns and link
 * placement right every single time, unwatched, at the scheduled hour. That is the room for error this file
 * removes.
 *
 * So the boundary is drawn differently: the composer supplies FACTS and PROSE, and {@link digestToUpdate}
 * decides STRUCTURE. Which items go above the fold, in what order, what the table's columns are, which
 * severity gets which glyph, where a ticket link lands — all of it is computed here, from data. The same form
 * derives a byte-identical card every time, and no prompt participates in the layout.
 *
 * ## The safety net, and the hole that WAS in it
 *
 * The derived card is still validated by `updateArtifactSchema` at the send edge, and the goal is that "a valid
 * digest form cannot produce an invalid card" is a MECHANICAL claim rather than a careful-author claim.
 *
 * That claim used to be stated here as already true, and it was not. Per-field caps do not compose: a form
 * whose every field was inside its own limit could derive detail over the 1800 cap, because several fields feed
 * the same paragraphs. It was reachable from ordinary input — ten items with a maximal `owner.ask` measured
 * 2040 characters — and the tests that claimed to pin the guarantee never set `substance` or `owner`, so they
 * were blind to the only fields that breach it.
 *
 * {@link digestFormSchema}'s whole-form check is what makes the claim true now: it derives the card and validates
 * it with the layout schema ITSELF, so the refusal happens at FORM level with the contributing fields named. It
 * defers rather than enumerating caps, because the first version of it enumerated one — the detail total — and
 * an adversarial review immediately found the per-paragraph cap it had not mirrored. The send-edge validation
 * stays as a genuine backstop rather than as the thing that catches ordinary overage.
 *
 * ## Two cards from one form
 *
 * `kind: "digest"` is shared by the cycle-hygiene card, model-authored triage and the three scheduled Datadog
 * alert rows. Only the last are ALERTS, so only a form carrying the `alerts` block derives the alert-summary
 * card's shape, in `./digestAlerts.ts`. Without the block the triage card below is derived
 * exactly as before. The fields every module reads are `./digestFields.ts`, the pieces both cards share
 * `./digestParts.ts`.
 *
 * ## What is deliberately NOT here
 *
 * No prose scanning, no wording rules, no severity inference from a title. Severity arrives as data because
 * guessing it from words is exactly the class of cleverness that turns a quiet day into a red alert.
 */
import { z } from "zod";

import { alertsDigestToUpdate, rankItems } from "./digestAlerts.js";
import {
  DIGEST_ALERT_LEAD_VISIBLE_MAX,
  DIGEST_INDEXED_MAX,
  DIGEST_LEAD_VISIBLE_MAX,
  DIGEST_LINE_VISIBLE_MAX,
  type DigestDerivation,
  type DigestForm,
  type DigestItem,
  digestFormFields,
} from "./digestFields.js";
import { countSentence, decideOwners, deriveCitations, itemMetrics, itemParagraph, lineWidth } from "./digestParts.js";
import { HEADLINE_SEPARATOR } from "./headline.js";
import { withRecommendations } from "./recommendations.js";
import { updateArtifactSchema } from "./schema.js";
import { SEVERITIES, SEVERITY_GLYPH } from "./severity.js";
import type { DetailBlock, InlineRun, UpdateArtifact } from "./types.js";

/**
 * The whole-form check that makes the guarantee TRUE rather than merely claimed.
 *
 * ## The hole this closes, measured
 *
 * Every per-field cap can be satisfied while their SUM is not, because the detail is assembled from several
 * fields at once. Two measured cases, both from forms whose every field was inside its own limit:
 *
 * - ten items each carrying a 120-character `owner.ask` derive **2040** characters of detail;
 * - three items at 600 characters of `substance` plus 40-character `ticket.id`s derive **1923**.
 *
 * The cap is 1800, so both were refused — but only AFTER derivation, by `updateArtifactSchema`, which reports
 * card-shaped paths the composer never wrote. The file used to claim this was impossible and that the unit
 * tests pinned it; the tests maximised titles, states, tickets and trends, which cost nothing against the
 * detail cap, and never set `substance` or `owner` at all. So the guarantee was false and its test was blind
 * in precisely the dimension that breaks it.
 *
 * ## Why it derives rather than re-adding the fields up
 *
 * It calls the real {@link digestToUpdate} and measures the real detail. Re-implementing "what the paragraphs
 * will cost" here would be a second copy of the composition rule, and a copy that drifts is how the original
 * claim came to be wrong in the first place.
 *
 * ## The guarantee is ONE-DIRECTIONAL, and that is the trade-off rather than an oversight
 *
 * `isKnownPerson` is the PESSIMISTIC `() => false`. An unresolved owner renders as `name (unresolved)` where a
 * resolved one renders as a mention costing `person.length + 1`, so the pessimistic paragraph is exactly **12
 * characters longer** per owner-bearing item. Bounding against the longer rendering buys the property that
 * matters: **no form this schema accepts can fail at the send edge**, whatever the roster does between now and
 * the scheduled hour.
 *
 * The price is a false REJECTION in a 12-character band per owner. An adversarial review found it: 40-character
 * ticket id + 597 characters of substance + a 1-character `person` measures 662 pessimistically and is refused,
 * while the resolved rendering is exactly 650 and would have sent. That form is genuinely turned away.
 *
 * That asymmetry is chosen, not tolerated. A false rejection is LOUD, immediate, and fixed by shortening a
 * field by twelve characters — the refusal even says which fields feed it. A false acceptance is a card that
 * validated in review and then failed unattended, at the hour nobody is watching, which is the entire failure
 * class this file exists to remove. So the check is deliberately biased toward refusing, and the guarantee is
 * stated one way only: accepted implies sendable, never the converse.
 */
export const digestFormSchema = digestFormFields.superRefine((form, ctx) => {
  // Two refusals the field caps cannot express, because each depends on whether the form opted into `alerts`.
  // An `impact` with no `alerts` block is a declared field the triage rendering never reads — strict parsing
  // cannot catch it once the key exists, so it is refused here rather than dropped. And an alerts TL;DR spends
  // the room a triage lead may use, so its lead has the narrower cap `DIGEST_ALERT_LEAD_VISIBLE_MAX` explains.
  if (form.alerts === undefined) {
    form.items.forEach((item, position) => {
      if (item.impact !== undefined) {
        ctx.addIssue({
          code: "custom",
          message:
            "`impact` is read only by an ALERTS digest, which ranks by it — add the `alerts` block, or drop the " +
            "field: a triage digest orders by severity alone and would silently ignore it",
          path: ["items", position, "impact"],
        });
      }
    });
  }
  if (form.alerts !== undefined && form.lead !== undefined && form.lead.length > DIGEST_ALERT_LEAD_VISIBLE_MAX) {
    ctx.addIssue({
      code: "custom",
      message:
        `an alerts digest's lead is capped at ${String(DIGEST_ALERT_LEAD_VISIBLE_MAX)} characters, not ` +
        `${String(DIGEST_LEAD_VISIBLE_MAX)}: its TL;DR also carries the priority and the trend clause`,
      path: ["lead"],
    });
    return;
  }
  const { artifact } = digestToUpdate({ form, isKnownPerson: () => false });
  // The WHOLE derived card, not one chosen cap. A first version of this check measured only the detail TOTAL
  // against DETAIL_PROSE_VISIBLE_MAX, and an adversarial review refuted it in the obvious place: one item with
  // 600 characters of `substance` and a 40-character `owner.person` derives a single 663-character paragraph,
  // which is comfortably under the 1800 total and over the 650 PER-PARAGRAPH cap. Verified through the real
  // verb at 663. Enumerating caps here is how that happens, so the check defers to the layout schema entirely
  // and holds for every cap it has, including ones added later.
  const derived = updateArtifactSchema.safeParse(artifact);
  if (derived.success) {
    return;
  }
  ctx.addIssue({
    code: "custom",
    message:
      "these items each sit inside their own limits, but the card they derive does not. What COMBINES is the " +
      "problem: one below-fold paragraph is built from an item's `substance`, its `ticket.id` (which costs its " +
      "full length as a link label) and its `owner` clause (`person` plus `ask` — and an unresolved owner " +
      "renders LONGER than a resolved one, which this check assumes), plus every `recommendations` line, which " +
      "costs its full width. `title` and `state` cost nothing here: " +
      "they go in the table, which is bounded by rows rather than characters. Shorten a `substance`, drop an " +
      `\`owner.ask\`, drop a recommendation, or remove an item. What the layout refused: ${z.prettifyError(derived.error)}`,
    path: ["items"],
  });
});

/** Severity order, then original position — a total order, so the derivation is deterministic. */
function bySeverity({ items }: { items: readonly DigestItem[] }): readonly DigestItem[] {
  return items
    .map((item, position) => ({ item, position }))
    .toSorted((left, right) => {
      const bucket = SEVERITIES.indexOf(left.item.severity) - SEVERITIES.indexOf(right.item.severity);
      return bucket === 0 ? left.position - right.position : bucket;
    })
    .map((entry) => entry.item);
}

/**
 * The derived TL;DR. Bounded by construction — see {@link DIGEST_LEAD_VISIBLE_MAX}.
 *
 * The separator comes from `./headline.ts` rather than being typed here. It was a literal until the
 * `authored-separator` gate found it: this lane and `./alertSummary.ts` were joining their TL;DRs with the
 * same character by coincidence rather than by construction, which is one rename away from two cards that
 * look different for no reason anyone could name.
 */
function deriveTldr({ form }: { form: DigestForm }): string {
  const counts = `${form.label} ${form.window} ${HEADLINE_SEPARATOR} ${countSentence({ items: form.items })}.`;
  return form.lead === undefined ? counts : `${counts} ${form.lead}`;
}

/**
 * ONE index line: glyph, ticket link, title, metrics, and the `[n]` chip when the item is backed by a query.
 *
 * The ticket is a `link` RUN rather than text, which is the whole point of the digest being independently
 * clickable — and a link costs only its label against the cap, so the URL is free. An item with no ticket
 * still gets a line; it simply is not clickable, which is honest rather than a fabricated link.
 *
 * The citation chip is emitted as a `citation` RUN, not merely declared in `citations`. An unreferenced
 * citation renders NOTHING — the renderer only draws a chip where a run points at one — so deriving the array
 * without also placing the runs would have produced a card that silenced the "no citations" advisory while
 * showing the reader no way to verify anything.
 */
function indexLine({ item, citationId }: { item: DigestItem; citationId: string | undefined }): readonly InlineRun[] {
  const glyph: InlineRun = { text: `${SEVERITY_GLYPH[item.severity]} `, type: "text" };
  const chip: readonly InlineRun[] =
    citationId === undefined
      ? []
      : [
          { text: " ", type: "text" },
          { citationId, type: "citation" },
        ];
  if (item.ticket === undefined) {
    return [glyph, { text: `${item.title} · ${itemMetrics({ item })}`, type: "text" }, ...chip];
  }
  return [
    glyph,
    { label: item.ticket.id, type: "link", url: item.ticket.url },
    { text: ` ${item.title} · ${itemMetrics({ item })}`, type: "text" },
    ...chip,
  ];
}

/**
 * An index line, TRIMMED to fit rather than allowed to fail the send.
 *
 * A digest is UNATTENDED. Refusing to post because an authored title ran four characters long would turn a
 * cosmetic problem into no digest at all, at the exact hour nobody is watching — so the one thing that gives is
 * the title. The glyph, the ticket link, the numbers and the chip are all load-bearing and are never cut, and
 * the ellipsis makes the trim visible rather than silent.
 */
function fittedIndexLine({
  item,
  citationId,
  chipWidth,
}: {
  item: DigestItem;
  citationId: string | undefined;
  chipWidth: number;
}): readonly InlineRun[] {
  const line = indexLine({ citationId, item });
  const overBy = lineWidth({ chipWidth, runs: line }) - DIGEST_LINE_VISIBLE_MAX;
  if (overBy <= 0) {
    return line;
  }
  const keep = Math.max(1, item.title.length - overBy - 1);
  return indexLine({ citationId, item: { ...item, title: `${item.title.slice(0, keep)}…` } });
}

/**
 * What one item's `State` cell says. `state` is optional on the form — an item whose standing the composer did
 * not write — and that cell reads as an em dash, so the column stays aligned rather than collapsing.
 */
function stateCell({ item }: { item: DigestItem }): string {
  const { state } = item;
  if (state === undefined) {
    return "—";
  }
  return state;
}

/** The table row for one item: severity glyph, title, count, state. Column count matches the header exactly. */
function tableRow({ item }: { item: DigestItem }): readonly (readonly InlineRun[])[] {
  return [
    [{ text: SEVERITY_GLYPH[item.severity], type: "text" }],
    [{ text: item.title, type: "text" }],
    [{ text: itemMetrics({ item }), type: "text" }],
    [{ text: stateCell({ item }), type: "text" }],
  ];
}

/**
 * Derive the card from the digest form. PURE and total: every valid form yields a valid
 * {@link UpdateArtifact}, which the test suite asserts over the boundary cases.
 *
 * The structural decisions, all made here rather than by a composer:
 *
 * - items are ordered red → orange → green, stable within a severity;
 * - the first {@link DIGEST_INDEXED_MAX} go above the fold as clickable one-liners;
 * - EVERY item goes into the below-fold table, so nothing is dropped by not being severe enough;
 * - the table's count column is headed with the window, and its severity column has a BLANK header, because
 *   a glyph names itself;
 * - items carrying `substance` or an `owner` each get a paragraph, in the same severity order.
 *
 * `isKnownPerson` is injected rather than looked up, which keeps this pure and testable: it is the ONLY thing
 * the derivation needs from the roster, and it decides whether an owner becomes a real ping or visible plain
 * text. Defaulting it to "nobody is known" would silently strip every ping, so it has no default.
 *
 * A form carrying `alerts` takes a different branch — {@link alertsDigestToUpdate}, the priority matrix and the
 * trend — and a form without it renders exactly as it always did.
 *
 * @param form the validated digest form
 * @param isKnownPerson whether a person key resolves to a real Slack identity (exact match only)
 * @returns the card artifact, any owner keys that degraded to plain text, and every derived sentence the card
 *   left out to fit, for the caller to warn about
 */
export function digestToUpdate({
  form,
  isKnownPerson,
}: {
  form: DigestForm;
  isKnownPerson: (person: string) => boolean;
}): DigestDerivation {
  if (form.alerts !== undefined) {
    return alertsDigestToUpdate({ alerts: form.alerts, form, isKnownPerson });
  }
  return triageDigestToUpdate({ form, isKnownPerson });
}

/**
 * The items in the order the card shows them, for a caller that has to walk them in that same order.
 *
 * `../../live/automation/digestShots.ts` is that caller: its pictures ride the card in its own row order, and on an
 * alerts digest that order is the matrix's rather than the form's.
 *
 * @param form the validated digest form
 * @returns every item, most urgent first by whichever ordering this form's card uses
 */
export function digestItemsInCardOrder({ form }: { form: DigestForm }): readonly DigestItem[] {
  if (form.alerts === undefined) {
    return bySeverity({ items: form.items });
  }
  return rankItems({ items: form.items }).map((entry) => entry.alert.item);
}

/** The triage card: severity order, the four-column table, no matrix. The shape every digest had before the alerts block. */
function triageDigestToUpdate({
  form,
  isKnownPerson,
}: {
  form: DigestForm;
  isKnownPerson: (person: string) => boolean;
}): DigestDerivation {
  const ordered = bySeverity({ items: form.items });
  // ONLY the items that get an index line, because only an index line carries a chip: a citation the card
  // declares and cites nowhere renders as nothing at all, and `updateArtifactSchema` now refuses one. Before
  // that refusal existed this derived a citation per item and silently shipped `TABLE_MAX_ROWS - 5` of them
  // pointing at nothing. See `./citationMarkers.ts`.
  const { citations, idFor } = deriveCitations({ items: ordered.slice(0, DIGEST_INDEXED_MAX) });
  // Every chip renders as `[n]`, so its visible width is that label's length — taken from the widest derived
  // label rather than assumed to be 3, which would understate it past nine citations.
  const chipWidth = citations.reduce((widest, citation) => Math.max(widest, citation.label.length), 0);
  const table: DetailBlock = {
    columns: ["", "Issue", form.window, "State"],
    rows: ordered.map((item) => tableRow({ item })),
    type: "table",
  };
  // Decide each owner ONCE, and use that decision for both the rendering and the caller's warning list.
  const decided = decideOwners({ isKnownPerson, items: ordered });
  const paragraphs = ordered
    .map((item) => itemParagraph({ isKnownPerson: decided, item }))
    .filter((block): block is DetailBlock => block !== undefined);
  const unresolvedOwners = ordered
    .map((item) => item.owner?.person)
    .filter((person): person is string => person !== undefined && !decided(person));
  const withLane = withRecommendations({
    citations,
    detail: [table, ...paragraphs],
    recommendations: form.recommendations,
  });
  const artifact: UpdateArtifact = {
    citations: withLane.citations,
    detail: withLane.detail,
    index: ordered
      .slice(0, DIGEST_INDEXED_MAX)
      .map((item, position) => fittedIndexLine({ chipWidth, citationId: idFor.get(position), item })),
    intro: form.intro,
    kind: "update",
    media: [],
    tldr: deriveTldr({ form }),
  };
  return { artifact, unresolvedOwners, warnings: [] };
}
