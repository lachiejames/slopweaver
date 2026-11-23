/**
 * The ALERTS digest card: the same matrix and trend `./alertSummary.ts` carries, on the
 * digest's own facts. `./priority.ts` decides every priority and `./trend.ts` every verdict; nothing here
 * re-derives either.
 *
 * Only a form carrying the `alerts` block reaches it, which `./digest.ts`'s `digestToUpdate` decides: items
 * ranked by the P0-P4 matrix, an ordered index reading `🔴 [1] P2 · title · ~0.3% · 24×`, a
 * `P | Issue | Impact | <window>` table, the worst priority and the trend clause in the TL;DR, and two
 * below-fold sentences naming the impact basis and the baseline. Those two SHED to fit, trend first, before any
 * existing line gives way.
 */
import { DETAIL_PROSE_VISIBLE_MAX } from "../assistant/contentLimits.js";
import {
  DIGEST_INDEXED_MAX,
  DIGEST_LINE_VISIBLE_MAX,
  type DigestDerivation,
  type DigestForm,
  type DigestItem,
} from "./digestFields.js";
import { countSentence, decideOwners, deriveCitations, itemMetrics, itemParagraph, lineWidth } from "./digestParts.js";
import { HEADLINE_SEPARATOR } from "./headline.js";
import { impactBasisSentence, impactCell, type RankedAlert, rankAlerts, topPriority } from "./priority.js";
import { withRecommendations } from "./recommendations.js";
import { SEVERITY_GLYPH, type Severity } from "./severity.js";
import { type AlertTrend, deriveTrend, trendClause, trendSentence } from "./trend.js";
import type { Citation, DetailBlock, InlineRun, UpdateArtifact } from "./types.js";
import { clippedToWidth, visibleLengthOfDetail } from "./visibleLength.js";

/** The alerts form's own block, narrowed. */
type DigestAlerts = NonNullable<DigestForm["alerts"]>;

/** One digest item as the matrix ranks it: the ranking reads `label`, and the renderer reads `item` back. */
interface RankableItem {
  readonly label: string;
  readonly count: number;
  readonly severity: Severity;
  readonly impact: DigestItem["impact"];
  readonly item: DigestItem;
}

/**
 * Rank every item by `./priority.ts`: priority, then the widest blast radius, then the loudest, then the title.
 *
 * @param items the form's items, in any order
 * @returns each item with its share, band and priority, most urgent first
 */
export function rankItems({ items }: { items: readonly DigestItem[] }): readonly RankedAlert<RankableItem>[] {
  return rankAlerts({
    alerts: items.map((item): RankableItem => ({
      count: item.count,
      impact: item.impact,
      item,
      label: item.title,
      severity: item.severity,
    })),
  });
}

/**
 * This window's total, as the trend compares it: the counts of every item that is NOT green.
 *
 * Green is excluded because a green count is not an alarm count: a probe on the good side of zero counts nothing
 * or, as a heartbeat, counts the activity that proves its job ran, and a green-declared probe (a benign skip) is
 * green at any count. Summing those would make a healthy heartbeat's busy day read as a window on fire. The verb
 * reads its baseline over the matching population — `../../datadog/alertProbe.ts`'s `probeCountsTowardTrend` —
 * so both sides of the ratio count the same thing.
 *
 * @param items the form's items
 * @returns the sum the TL;DR's ratio is taken over
 */
function alertsCurrentTotal({ items }: { items: readonly DigestItem[] }): number {
  return items.filter((item) => item.severity !== "green").reduce((total, item) => total + item.count, 0);
}

/**
 * The derived alerts TL;DR: the subject, the worst priority, the severity counts, the trend clause, the lead.
 *
 * Bounded by construction — see {@link DIGEST_ALERT_LEAD_VISIBLE_MAX}. A digest always carries at least one
 * item, so there is always a priority to lead with, a `P4` on an all-green window included: that is the token
 * that lets this card be scanned beside the alert-summary ones.
 */
function deriveAlertsTldr({
  form,
  ranked,
  trend,
}: {
  form: DigestForm;
  ranked: readonly RankedAlert<RankableItem>[];
  trend: AlertTrend | undefined;
}): string {
  const worst = topPriority({ ranked });
  const priority = worst === undefined ? "" : `${worst} ${HEADLINE_SEPARATOR} `;
  const counts = `${form.label} ${form.window} ${HEADLINE_SEPARATOR} ${priority}${countSentence({ items: form.items })}.`;
  const clause = trendClause({ trend });
  const withTrend = clause === undefined ? counts : `${counts}${clause}`;
  return form.lead === undefined ? withTrend : `${withTrend} ${form.lead}`;
}

/**
 * ONE alerts index line: `🔴 [1] P2 · TICKET title · ~0.3% · 24×, rising`.
 *
 * The alert-summary line's own order — colour, chip, priority, the name in bold, impact, count — so the two cards
 * read identically down a sidebar. The ticket, when there is one, stays a link in front of the title, and the
 * authored item `trend` rides the count as it does in the table.
 *
 * @param ranked the item and the cells it derived
 * @param citationId the citation this item resolved to, or undefined
 * @param withTrend whether the authored item trend rides the line — the first thing a fitted line gives up
 * @returns the line's runs
 */
function alertsIndexLine({
  ranked,
  citationId,
  withTrend,
}: {
  ranked: RankedAlert<RankableItem>;
  citationId: string | undefined;
  withTrend: boolean;
}): readonly InlineRun[] {
  const { item } = ranked.alert;
  const chip: readonly InlineRun[] =
    citationId === undefined
      ? []
      : [
          { citationId, type: "citation" },
          { text: " ", type: "text" },
        ];
  const ticket: readonly InlineRun[] =
    item.ticket === undefined
      ? []
      : [
          { label: item.ticket.id, type: "link", url: item.ticket.url },
          { text: " ", type: "text" },
        ];
  const trend = withTrend && item.trend !== undefined ? `, ${item.trend}` : "";
  return [
    { text: `${SEVERITY_GLYPH[item.severity]} `, type: "text" },
    ...chip,
    { text: `${ranked.priority} ${HEADLINE_SEPARATOR} `, type: "text" },
    ...ticket,
    { bold: true, text: item.title, type: "text" },
    {
      text: ` ${HEADLINE_SEPARATOR} ${impactCell({ share: ranked.share })} ${HEADLINE_SEPARATOR} ${String(item.count)}×${trend}`,
      type: "text",
    },
  ];
}

/**
 * An alerts index line, fitted to {@link DIGEST_LINE_VISIBLE_MAX} rather than allowed to fail the send.
 *
 * Two things give, in order. First the authored item `trend`, which the table below the fold still carries, so
 * nothing is lost from the card. Then the title, clipped on a whole character with a visible ellipsis. The
 * colour, chip, priority, ticket, impact and count never give: a matrix missing a column is not a matrix. With
 * the count bounded at a safe integer, those fixed cells leave a title at least one character and its ellipsis —
 * `digestAlerts.test.ts` pins that worst case rather than trusting this sentence.
 */
function fittedAlertsIndexLine({
  ranked,
  citationId,
  chipWidth,
}: {
  ranked: RankedAlert<RankableItem>;
  citationId: string | undefined;
  chipWidth: number;
}): readonly InlineRun[] {
  const full = alertsIndexLine({ citationId, ranked, withTrend: true });
  if (lineWidth({ chipWidth, runs: full }) <= DIGEST_LINE_VISIBLE_MAX) {
    return full;
  }
  const bare = alertsIndexLine({ citationId, ranked, withTrend: false });
  const overBy = lineWidth({ chipWidth, runs: bare }) - DIGEST_LINE_VISIBLE_MAX;
  if (overBy <= 0) {
    return bare;
  }
  const { item } = ranked.alert;
  const title = clippedToWidth({ room: Math.max(1, item.title.length - overBy), text: item.title });
  return alertsIndexLine({
    citationId,
    ranked: { ...ranked, alert: { ...ranked.alert, item: { ...item, title } } },
    withTrend: false,
  });
}

/**
 * One alerts table row: `P | Issue | Impact | <window>`.
 *
 * Four columns because the layout allows four (`TABLE_MAX_COLUMNS`), so the matrix's two cells take the places
 * the triage table spends on a bare glyph and on `state`. `state` is not dropped: it rides the issue cell after
 * the title, visibly, because a declared field the card ignores is the failure `../strictForm.ts` exists to stop.
 */
function alertsTableRow({ ranked }: { ranked: RankedAlert<RankableItem> }): readonly (readonly InlineRun[])[] {
  const { item } = ranked.alert;
  const issue = item.state === undefined ? item.title : `${item.title} ${HEADLINE_SEPARATOR} ${item.state}`;
  return [
    [{ text: `${SEVERITY_GLYPH[item.severity]} ${ranked.priority}`, type: "text" }],
    [{ text: issue, type: "text" }],
    [{ text: impactCell({ share: ranked.share }), type: "text" }],
    [{ text: itemMetrics({ item }), type: "text" }],
  ];
}

/**
 * The paragraph for an item ranked past the index, which has no index line to carry its citation or ticket.
 *
 * It leads with both, then reads as {@link itemParagraph} does; with neither substance nor owner, the title
 * stands in, so the reference always has something to point at. An item with no reference at all is left to
 * {@link itemParagraph} unchanged.
 *
 * @param citationId the item's own citation, when it carries one
 * @param isKnownPerson whether a person key resolves to a real Slack identity (exact match only)
 * @returns the paragraph, or undefined when the item has nothing to say and nothing to link
 */
function unindexedParagraph({
  item,
  citationId,
  isKnownPerson,
}: {
  item: DigestItem;
  citationId: string | undefined;
  isKnownPerson: (person: string) => boolean;
}): DetailBlock | undefined {
  const paragraph = itemParagraph({ isKnownPerson, item });
  if (citationId === undefined && item.ticket === undefined) {
    return paragraph;
  }
  const chip: readonly InlineRun[] =
    citationId === undefined
      ? []
      : [
          { citationId, type: "citation" },
          { text: " ", type: "text" },
        ];
  if (paragraph?.type !== "paragraph") {
    const ticket: readonly InlineRun[] =
      item.ticket === undefined
        ? []
        : [
            { label: item.ticket.id, type: "link", url: item.ticket.url },
            { text: " ", type: "text" },
          ];
    return { runs: [...chip, ...ticket, { text: item.title, type: "text" }], type: "paragraph" };
  }
  return { runs: [...chip, ...paragraph.runs], type: "paragraph" };
}

/**
 * The citations, the below-fold item paragraphs and the owner decision, in the one rank order the card reads.
 *
 * @param ranked every item, in matrix order
 * @param indexed the head of that order the index has room for
 * @param isKnownPerson whether a person key resolves to a real Slack identity (exact match only)
 * @returns the citations and their ids by position, the widest indexed chip, the paragraphs, and the owners
 *   that degraded to plain text
 */
function citedItems({
  ranked,
  indexed,
  isKnownPerson,
}: {
  ranked: readonly RankedAlert<RankableItem>[];
  indexed: readonly RankedAlert<RankableItem>[];
  isKnownPerson: (person: string) => boolean;
}): {
  readonly chipWidth: number;
  readonly citations: readonly Citation[];
  readonly idFor: ReadonlyMap<number, string>;
  readonly paragraphs: readonly DetailBlock[];
  readonly unresolvedOwners: readonly string[];
} {
  const ordered = ranked.map((entry) => entry.alert.item);
  // Every item is cited, in rank order, so the indexed ones keep [1]..[9] and one ranked past the index still
  // carries its evidence below the fold: ranking decides WHICH item is tenth, never whether it has a link.
  const { citations, idFor } = deriveCitations({ items: ordered });
  const indexedIds = new Set(
    indexed.map((_entry, position) => idFor.get(position)).filter((id): id is string => id !== undefined),
  );
  const chipWidth = citations
    .filter((citation) => indexedIds.has(citation.id))
    .reduce((widest, citation) => Math.max(widest, citation.label.length), 0);
  const decided = decideOwners({ isKnownPerson, items: ordered });
  const paragraphs = ordered
    .map((item, position) =>
      position < DIGEST_INDEXED_MAX
        ? itemParagraph({ isKnownPerson: decided, item })
        : unindexedParagraph({ citationId: idFor.get(position), isKnownPerson: decided, item }),
    )
    .filter((block): block is DetailBlock => block !== undefined);
  const unresolvedOwners = ordered
    .map((item) => item.owner?.person)
    .filter((person): person is string => person !== undefined && !decided(person));
  return { chipWidth, citations, idFor, paragraphs, unresolvedOwners };
}

/** A fitted alerts detail lane: the blocks, their citations, and a line for every sentence it shed. */
interface FittedAlertsLane {
  readonly citations: readonly Citation[];
  readonly detail: readonly DetailBlock[];
  readonly warnings: readonly string[];
}

/** One derived sentence as a detail paragraph. */
function sentenceBlock({ text }: { text: string }): DetailBlock {
  return { runs: [{ text, type: "text" }], type: "paragraph" };
}

/**
 * The detail with as many of the two basis sentences as the below-fold PROSE budget affords.
 *
 * They SHED rather than refuse, and in a fixed order: the trend sentence first, then the impact basis. Both
 * explain numbers the reader can already see (the tilde on every share marks it an estimate; the TL;DR clause
 * names its baseline), where an item's own paragraph and the recommendations lane say things nothing else on the
 * card does. So a digest that fitted before the alerts block still fits after it — the new prose gives way before anything
 * that was already there. The recommendations lane sheds only after both of these have: `buildAlertDigestForm`
 * measures the card this returns, which has already given them up.
 *
 * Every sentence left out becomes a warning line, so the drop is stated rather than silent.
 */
function fittedAlertsLane({
  base,
  citations,
  basis,
  trend,
  recommendations,
}: {
  base: readonly DetailBlock[];
  citations: readonly Citation[];
  basis: string | undefined;
  trend: string;
  recommendations: DigestForm["recommendations"];
}): FittedAlertsLane {
  const basisBlocks = basis === undefined ? [] : [sentenceBlock({ text: basis })];
  const variants: readonly { readonly blocks: readonly DetailBlock[]; readonly warnings: readonly string[] }[] = [
    { blocks: [...basisBlocks, sentenceBlock({ text: trend })], warnings: [] },
    { blocks: basisBlocks, warnings: [TREND_SENTENCE_SHED] },
    { blocks: [], warnings: basis === undefined ? [TREND_SENTENCE_SHED] : [TREND_SENTENCE_SHED, BASIS_SENTENCE_SHED] },
  ];
  let leanest: FittedAlertsLane | undefined;
  for (const variant of variants) {
    const lane = withRecommendations({ citations, detail: [...base, ...variant.blocks], recommendations });
    const fitted = { ...lane, warnings: variant.warnings };
    if (visibleLengthOfDetail({ citations: lane.citations, detail: lane.detail }) <= DETAIL_PROSE_VISIBLE_MAX) {
      return fitted;
    }
    leanest = fitted;
  }
  // Nothing fitted even with both sentences gone: the items and recommendations are over the budget on their own.
  // The leanest lane goes back and the layout schema refuses it by its own cap, naming the fields that feed it —
  // the same posture `./alertSummary.ts`'s `fittedLane` takes. The `!` is honest: the loop always runs. Its
  // warning says so rather than the per-sentence "so the rest fits", which would be false here.
  return { ...leanest!, warnings: [DETAIL_OVER_BUDGET] };
}

/** The warning an alerts digest whose items and recommendations overrun the detail budget on their own leaves. */
const DETAIL_OVER_BUDGET =
  "the card's detail is over the below-fold budget even with its optional sentences left off: the item " +
  "paragraphs and recommendations exceed it on their own, so the door refuses it until one is shortened, unless this session holds a truncated-send grant";

/** The warning an alerts digest whose firing total cannot be summed exactly leaves. */
const UNSAFE_CURRENT_TOTAL =
  "no trend: this window's firing total is past the largest safe integer, so it is not compared";

/** The warning a shed trend sentence leaves. */
const TREND_SENTENCE_SHED =
  "the trend-baseline sentence was left off the card's detail so the rest fits the below-fold budget";

/**
 * The warning a shed impact-basis sentence leaves.
 *
 * It once added that every share still carries its tilde, which a `<0.1%` share does not: a
 * warning says only what is true of every card it can be printed about.
 */
const BASIS_SENTENCE_SHED =
  "the impact-basis sentence was left off the card's detail so the rest fits the below-fold budget";

/**
 * Derive the ALERTS card: the same matrix and trend the alert-summary card carries, on the digest's own facts.
 *
 * - items are RANKED by `./priority.ts` — priority, blast radius, count, title — and that one order drives the
 *   index, the citation numbering, the table and the paragraphs, so no two sections disagree;
 * - the TL;DR leads with the worst priority and closes on the trend clause when a baseline was read;
 * - the index is a Slack-numbered `ordered` list whose every line carries colour, priority, impact and count;
 * - the table is `P | Issue | Impact | <window>`, every item, so nothing is dropped by not being urgent;
 * - after the item paragraphs, the impact basis and the trend baseline, shed to fit rather than refused.
 *
 * @param alerts the form's own alerts block
 * @param form the validated digest form
 * @param isKnownPerson whether a person key resolves to a real Slack identity (exact match only)
 * @returns the card, the owners that degraded to plain text, and a line for every sentence it shed
 */
export function alertsDigestToUpdate({
  alerts,
  form,
  isKnownPerson,
}: {
  alerts: DigestAlerts;
  form: DigestForm;
  isKnownPerson: (person: string) => boolean;
}): DigestDerivation {
  const ranked = rankItems({ items: form.items });
  const current = alertsCurrentTotal({ items: form.items });
  // Each count is capped at MAX_SAFE_INTEGER, their SUM is not, and a rounded sum would be printed as a total that
  // was never read. So an unsafe total declines the trend exactly as an unsafe baseline does in the verb, and says so.
  const currentIsExact = Number.isSafeInteger(current);
  const trend = currentIsExact ? deriveTrend({ current, reading: alerts.trend }) : undefined;
  const totalWarnings = currentIsExact ? [] : [UNSAFE_CURRENT_TOTAL];
  const indexed = ranked.slice(0, DIGEST_INDEXED_MAX);
  const { chipWidth, citations, idFor, paragraphs, unresolvedOwners } = citedItems({ indexed, isKnownPerson, ranked });
  const table: DetailBlock = {
    columns: ["P", "Issue", "Impact", form.window],
    rows: ranked.map((entry) => alertsTableRow({ ranked: entry })),
    type: "table",
  };
  const lane = fittedAlertsLane({
    base: [table, ...paragraphs],
    basis: impactBasisSentence({
      measured: ranked.filter((entry) => entry.share !== undefined).length,
      query: "probe",
      total: ranked.length,
    }),
    citations,
    recommendations: form.recommendations,
    trend: trendSentence({ counted: "counted", current, trend, window: form.window }),
  });
  const artifact: UpdateArtifact = {
    citations: lane.citations,
    detail: lane.detail,
    index: indexed.map((entry, position) =>
      fittedAlertsIndexLine({ chipWidth, citationId: idFor.get(position), ranked: entry }),
    ),
    indexStyle: "ordered",
    intro: form.intro,
    kind: "update",
    media: [],
    tldr: deriveAlertsTldr({ form, ranked, trend }),
  };
  return { artifact, unresolvedOwners, warnings: [...totalWarnings, ...lane.warnings] };
}
