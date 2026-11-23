/**
 * A `[n]` CITATION MARKER in a plain-text run — converting it into the chip that renders, refusing what is
 * left, and numbering the citations in the order a reader meets them.
 *
 * ## The defect class
 *
 * A form's `citations` array is INERT on its own. The renderer draws a `[n]` link only where a `citation`
 * RUN points at one (`../slack/render.ts`'s `citationLink`), so a form that declares citations and
 * references none of them renders no link anywhere — while `../slack/dryRun.ts`'s `no-citations` advisory
 * goes quiet, because the array is non-empty. Accept, silence the only warning, drop the substance.
 *
 * MEASURED on a card in the bot DM: the card declared its
 * citations, wrote its markers as literal `[1]`/`[2]` text, and posted with every marker as dead prose and
 * not one clickable source. Re-run the shape through
 * `slopweaver slack post --as bot --dry-run` before and after this file to see it.
 *
 * ## The shape of the fix — convert, then refuse, and never accept-and-drop
 *
 * Exactly `./typedRuns.ts`'s pair, for the same reason: the vocabulary to say this properly already exists
 * (`types.ts`'s `CitationRun`), so a marker an author typed as text is a form-fill bug with one honest reading.
 *
 * - **Convert** a `[n]` in a text run to the chip for the citation whose label is `[n]`. The visible text
 *   is unchanged — a chip costs its own label — so this moves no card by a character; it only makes the
 *   marker clickable.
 * - **Refuse** what conversion could not type: a marker resolving to no declared citation, and a marker in
 *   a plain-STRING field (a `tldr`, a `lead`) that holds no runs at all.
 * - **Refuse** a declared citation that, after conversion, still no run cites. That is the accept-and-drop
 *   itself, and it is the one refusal that cannot be satisfied by moving text around.
 *
 * **Both refusals are conditioned on the form declaring at least one citation**, and that is deliberate
 * rather than timid. On a citation-free card a bracketed number is ordinary prose — an array index, a
 * footnote in a quoted title — and refusing it would be the whole-artifact style gate this repo already
 * tore out once for blocking a quoted em-dash. A card that declares citations has told us the brackets
 * mean something, so there is no ambiguity left to be careful about.
 *
 * ## Numbering is DERIVED, not authored
 *
 * {@link citationsInReadingOrder} renumbers the array `[1]`, `[2]`, … in order of first appearance and
 * sorts it to match. The second half of the measured defect was a footer list in citation-ARRAY order
 * while the markers ran in reading order, which is what the reader actually follows; with the label
 * derived from first appearance the two cannot disagree again. A chip resolves by `id`, so renumbering
 * touches the citations array and nothing else — no run is rewritten.
 *
 * This is the shape `./alertSummary.ts` and `./digest.ts` already build by hand (`deriveCitations` walks
 * the ordered rows and numbers as it goes), so the rule is the one the working composers already keep.
 */
import { runSequencesOf } from "./runs.js";
import { convertibleRun } from "./typedRuns.js";
import type { Citation, DetailBlock, InlineRun, TextSpan } from "./types.js";

/**
 * A `[n]` marker in authored prose.
 *
 * GLOBAL and consumed with `matchAll` so no `lastIndex` state leaks between runs — the same discipline
 * `./typedRuns.ts` and `../slack/dryRun.ts` apply to their own patterns. A regex is the right tool and
 * there is no library alternative: this is a text-pattern job on our OWN authored prose, not a provider
 * data type.
 */
const CITATION_MARKER = /\[\d+\]/g;

/** Every `[n]` marker in a string, with the offset a refusal needs to be findable. */
function scanCitationMarkers({ text }: { text: string }): readonly { raw: string; start: number }[] {
  return [...text.matchAll(CITATION_MARKER)].map((hit) => ({ raw: hit[0], start: hit.index }));
}

/** The citation a marker names, matched on the exact label the schema already constrains to `[n]`. */
function citationForMarker({ raw, citations }: { raw: string; citations: readonly Citation[] }): Citation | undefined {
  return citations.find((citation) => citation.label === raw);
}

/**
 * One text run rewritten with its resolvable markers promoted to chips.
 *
 * An UNresolvable marker is left exactly where it is, as text, so {@link citationMarkerIssuesOfRuns} can
 * find it afterwards and refuse — the same convert-then-report split `typeRawMarkupInRun` uses for a
 * channel reference it cannot express.
 */
function typeMarkersInRun({ run, citations }: { run: TextSpan; citations: readonly Citation[] }): readonly InlineRun[] {
  const markers = scanCitationMarkers({ text: run.text });
  if (markers.length === 0) {
    return [run];
  }
  const out: InlineRun[] = [];
  let cursor = 0;
  const keepText = ({ end }: { end: number }): void => {
    const slice = run.text.slice(cursor, end);
    if (slice.length > 0) {
      out.push({ ...run, text: slice });
    }
  };
  for (const marker of markers) {
    const citation = citationForMarker({ citations, raw: marker.raw });
    if (citation === undefined) {
      continue;
    }
    keepText({ end: marker.start });
    out.push({ citationId: citation.id, type: "citation" });
    cursor = marker.start + marker.raw.length;
  }
  keepText({ end: run.text.length });
  return out;
}

/** Whether a sequence has a resolvable marker at all — the early exit that keeps a clean form byte-identical. */
function carriesResolvableMarker({
  runs,
  citations,
}: {
  runs: readonly InlineRun[];
  citations: readonly Citation[];
}): boolean {
  return runs.some(
    (run) =>
      convertibleRun(run) &&
      scanCitationMarkers({ text: run.text }).some(
        (marker) => citationForMarker({ citations, raw: marker.raw }) !== undefined,
      ),
  );
}

/**
 * A run sequence with every resolvable `[n]` marker promoted to the chip that renders it.
 *
 * Byte-identical to its input when there is nothing to promote, which is what lets this sit in a schema
 * transform on every outbound path without moving an existing card.
 *
 * @param runs the composed run sequence
 * @param citations the form's declared citations, matched by label
 * @returns the sequence with resolvable markers replaced by citation runs, in the same order
 */
export function typeCitationMarkersInRuns({
  runs,
  citations,
}: {
  runs: readonly InlineRun[];
  citations: readonly Citation[];
}): readonly InlineRun[] {
  if (!carriesResolvableMarker({ citations, runs })) {
    return runs;
  }
  return runs.flatMap<InlineRun>((run) => (convertibleRun(run) ? [...typeMarkersInRun({ citations, run })] : [run]));
}

/**
 * {@link typeCitationMarkersInRuns} over a list of run sequences — an index, a bullet list, a table row.
 *
 * @param items the run sequences
 * @param citations the form's declared citations
 * @returns the sequences, each converted, in order
 */
export function typeCitationMarkersInSequences({
  items,
  citations,
}: {
  items: readonly (readonly InlineRun[])[];
  citations: readonly Citation[];
}): readonly (readonly InlineRun[])[] {
  return items.map((runs) => typeCitationMarkersInRuns({ citations, runs }));
}

/** One sub-block, converted. A named function rather than an inline callback so the `switch` may be exhaustive. */
function typeBlockMarkers({ block, citations }: { block: DetailBlock; citations: readonly Citation[] }): DetailBlock {
  switch (block.type) {
    case "paragraph":
      return { ...block, runs: typeCitationMarkersInRuns({ citations, runs: block.runs }) };
    case "bullets":
    case "list":
      return { ...block, items: typeCitationMarkersInSequences({ citations, items: block.items }) };
    case "table":
      return { ...block, rows: block.rows.map((row) => typeCitationMarkersInSequences({ citations, items: row })) };
  }
}

/**
 * {@link typeCitationMarkersInRuns} over a whole detail sequence, sub-block by sub-block.
 *
 * A `switch` over the block union rather than a walk through `./runs.ts`'s `runSequencesOf`, for the reason
 * `typeRawMarkupInDetail` gives: that helper FLATTENS, which is right for reading and useless for
 * rebuilding — a table's rows have to come back as rows.
 *
 * @param detail the composed detail sub-blocks
 * @param citations the form's declared citations
 * @returns the sub-blocks with every run sequence converted
 */
export function typeCitationMarkersInDetail({
  detail,
  citations,
}: {
  detail: readonly DetailBlock[];
  citations: readonly Citation[];
}): readonly DetailBlock[] {
  return detail.map((block) => typeBlockMarkers({ block, citations }));
}

/**
 * One citation refusal, with the JSON path a form author needs to find it. Mirrors `RawMarkupIssue`.
 *
 * @internal
 */
export interface CitationIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/** The refusal for a marker that named no declared citation. */
function danglingMarkerRefusal({ raw }: { raw: string }): string {
  return (
    `${JSON.stringify(raw)} is a citation marker naming no declared citation, so it renders as DEAD ` +
    "TEXT — a reader sees the brackets and can click nothing. Add a citation whose `label` is " +
    `${JSON.stringify(raw)} with the url it points at, or rewrite the sentence without the marker.`
  );
}

/**
 * The marker issues for one run sequence, after conversion has already had its turn — every marker still
 * sitting in text is unresolvable by construction.
 *
 * @param runs the converted run sequence
 * @param citations the form's declared citations; an empty array reports nothing, because a bracketed
 *   number in a citation-free form is ordinary prose
 * @param path the JSON path of the sequence, for the issue
 * @returns one issue per surviving marker
 */
export function citationMarkerIssuesOfRuns({
  runs,
  citations,
  path,
}: {
  runs: readonly InlineRun[];
  citations: readonly Citation[];
  path: readonly (string | number)[];
}): readonly CitationIssue[] {
  if (citations.length === 0) {
    return [];
  }
  return runs.flatMap((run) =>
    convertibleRun(run)
      ? scanCitationMarkers({ text: run.text }).map((marker) => ({
          message: danglingMarkerRefusal({ raw: marker.raw }),
          path,
        }))
      : [],
  );
}

/**
 * The marker issues for a PLAIN STRING field — a `tldr`, a `lead`.
 *
 * Every marker there is residue by construction: the field holds no runs, so there is no conversion to try
 * first and nothing a chip could be put into. The refusal says where the marker can live instead.
 *
 * @param text the field's literal text
 * @param citations the form's declared citations; empty reports nothing
 * @param path the JSON path of the field, for the issue
 * @returns one issue per marker found
 */
export function citationMarkerIssuesOfText({
  text,
  citations,
  path,
}: {
  text: string;
  citations: readonly Citation[];
  path: readonly (string | number)[];
}): readonly CitationIssue[] {
  if (citations.length === 0) {
    return [];
  }
  return scanCitationMarkers({ text }).map((marker) => ({
    message:
      `${JSON.stringify(marker.raw)} sits in a plain-string field, which holds no typed runs and renders ` +
      "LITERALLY — the marker can never become a link here. Move the cited sentence into a run sequence " +
      "that can carry a `citation` chip, or drop the marker from this field.",
    path,
  }));
}

/**
 * The marker issues across a whole detail sequence.
 *
 * @param detail the converted detail sub-blocks
 * @param citations the form's declared citations
 * @param path the JSON path of the detail array itself (`detail` on a card, `body` on an answer)
 * @returns one issue per surviving marker, addressed to the sub-block it is in
 */
function citationMarkerIssuesOfDetail({
  detail,
  citations,
  path,
}: {
  detail: readonly DetailBlock[];
  citations: readonly Citation[];
  path: readonly (string | number)[];
}): readonly CitationIssue[] {
  return detail.flatMap((block, index) =>
    runSequencesOf({ block }).flatMap((runs) =>
      citationMarkerIssuesOfRuns({ citations, path: [...path, index], runs }),
    ),
  );
}

/**
 * The marker issues across a list of run sequences — an `index`.
 *
 * @param items the converted run sequences
 * @param citations the form's declared citations
 * @param path the JSON path of the list itself
 * @returns one issue per surviving marker, addressed to the item it is in
 */
function citationMarkerIssuesOfSequences({
  items,
  citations,
  path,
}: {
  items: readonly (readonly InlineRun[])[];
  citations: readonly Citation[];
  path: readonly (string | number)[];
}): readonly CitationIssue[] {
  return items.flatMap((runs, index) => citationMarkerIssuesOfRuns({ citations, path: [...path, index], runs }));
}

/**
 * The citation ids a form actually cites, in the order a reader meets them: the above-the-fold `index`
 * first, then the folded detail.
 *
 * @param index the above-the-fold run sequences
 * @param detail the folded sub-blocks (`detail` on a card, `body` on an answer)
 * @returns each distinct cited id once, at its first appearance
 */
export function citedIdsInReadingOrder({
  index,
  detail,
}: {
  index: readonly (readonly InlineRun[])[];
  detail: readonly DetailBlock[];
}): readonly string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = ({ runs }: { runs: readonly InlineRun[] }): void => {
    for (const run of runs) {
      if (run.type !== "citation" || seen.has(run.citationId)) {
        continue;
      }
      seen.add(run.citationId);
      order.push(run.citationId);
    }
  };
  index.forEach((runs) => {
    visit({ runs });
  });
  detail.forEach((block) => {
    runSequencesOf({ block }).forEach((runs) => {
      visit({ runs });
    });
  });
  return order;
}

/**
 * The citations REFUSED for being declared and never cited — the accept-and-drop itself.
 *
 * @param citations the form's declared citations
 * @param index the converted above-the-fold run sequences
 * @param detail the converted folded sub-blocks
 * @param path the JSON path of the citations array itself
 * @returns one issue per uncited citation, addressed to its own array position
 */
export function uncitedCitationIssues({
  citations,
  index,
  detail,
  path,
}: {
  citations: readonly Citation[];
  index: readonly (readonly InlineRun[])[];
  detail: readonly DetailBlock[];
  path: readonly (string | number)[];
}): readonly CitationIssue[] {
  const cited = new Set(citedIdsInReadingOrder({ detail, index }));
  return citations.flatMap((citation, position) =>
    cited.has(citation.id)
      ? []
      : [
          {
            message:
              `citation ${JSON.stringify(citation.id)} (${citation.label}) is declared and cited by NOTHING, ` +
              "so it renders nowhere — a card can silence the `no-citations` advisory while showing the " +
              "reader no way to verify anything. Put its marker in the sentence it backs, or remove it.",
            path: [...path, position],
          },
        ],
  );
}

/**
 * The citations RENUMBERED `[1]`, `[2]`, … in order of first appearance, and sorted to match.
 *
 * A chip resolves by `id`, so this rewrites labels and array order and never touches a run. An UNCITED
 * citation keeps its relative order at the tail and is numbered after every cited one — it is about to be
 * refused by {@link uncitedCitationIssues}, and this pass exists to make the refusal's message name a
 * stable label rather than to rescue the citation.
 *
 * @param citations the form's declared citations, as authored
 * @param index the converted above-the-fold run sequences
 * @param detail the converted folded sub-blocks
 * @returns the citations in reading order with derived labels; the same array when nothing moved
 */
export function citationsInReadingOrder({
  citations,
  index,
  detail,
}: {
  citations: readonly Citation[];
  index: readonly (readonly InlineRun[])[];
  detail: readonly DetailBlock[];
}): readonly Citation[] {
  const order = citedIdsInReadingOrder({ detail, index });
  const rank = new Map(order.map((id, position) => [id, position]));
  const sorted = citations.toSorted(
    (left, right) => (rank.get(left.id) ?? order.length) - (rank.get(right.id) ?? order.length),
  );
  const renumbered = sorted.map((citation, position) => ({ ...citation, label: `[${String(position + 1)}]` }));
  const unchanged = renumbered.every((citation, position) => {
    const original = citations[position];
    return original !== undefined && original.id === citation.id && original.label === citation.label;
  });
  return unchanged ? citations : renumbered;
}

/**
 * Every citation refusal for one card- or answer-shaped form, in one call: a marker in the plain-string
 * lead, a marker naming no declared citation anywhere in the runs, and a citation nothing cites.
 *
 * Composed here rather than at each schema so the two forms cannot drift apart on which of the three they
 * check — `../assistant/answerForm.ts` already had the uncited rule and neither of the marker rules, which
 * is exactly the divergence that let the measured card through one door and not the other.
 *
 * @param lead the plain-string field above the fold (`tldr` on a card, `lead` on an answer)
 * @param leadPath that field's own JSON path, which differs between the two forms
 * @param detail the converted folded sub-blocks
 * @param detailPath the folded array's JSON path (`detail` on a card, `body` on an answer)
 * @param index the converted above-the-fold run sequences
 * @param citations the form's declared citations, after conversion has had its turn
 * @param uncited whether to include the uncited-citation rule; the answer form already applies its own
 * @returns every issue, leads first, in a stable order
 */
export function citationIssuesOfForm({
  lead,
  leadPath,
  detail,
  detailPath,
  index,
  citations,
  uncited,
}: {
  lead: string;
  leadPath: readonly (string | number)[];
  detail: readonly DetailBlock[];
  detailPath: readonly (string | number)[];
  index: readonly (readonly InlineRun[])[];
  citations: readonly Citation[];
  uncited: boolean;
}): readonly CitationIssue[] {
  return [
    ...citationMarkerIssuesOfText({ citations, path: leadPath, text: lead }),
    ...citationMarkerIssuesOfDetail({ citations, detail, path: detailPath }),
    ...citationMarkerIssuesOfSequences({ citations, items: index, path: ["index"] }),
    ...(uncited ? uncitedCitationIssues({ citations, detail, index, path: ["citations"] }) : []),
  ];
}

/**
 * The citations a form keeps after a TRUNCATION pass, renumbered for what survived.
 *
 * Truncation can drop the only run that cited a citation — an index line carrying the chip, say — which
 * would otherwise make the uncited-citation refusal fire on content the author never got a chance to fix.
 * So a citation orphaned BY this pass is dropped with it. One that was already uncited beforehand is left
 * alone: that is a real authoring defect, and telling the two apart is exactly what `citedBefore` is for.
 *
 * @param citations the form's citations as they stood before truncation
 * @param citedBefore the ids cited before it ran, from {@link citedIdsInReadingOrder}
 * @param index the truncated above-the-fold run sequences
 * @param detail the truncated folded sub-blocks
 * @returns the surviving citations, numbered `[1]`, `[2]`, … in the truncated reading order
 */
export function citationsAfterTruncation({
  citations,
  citedBefore,
  index,
  detail,
}: {
  citations: readonly Citation[];
  citedBefore: readonly string[];
  index: readonly (readonly InlineRun[])[];
  detail: readonly DetailBlock[];
}): readonly Citation[] {
  const citedAfter = new Set(citedIdsInReadingOrder({ detail, index }));
  const orphaned = new Set(citedBefore.filter((id) => !citedAfter.has(id)));
  const surviving = orphaned.size === 0 ? citations : citations.filter((c) => !orphaned.has(c.id));
  return citationsInReadingOrder({ citations: surviving, detail, index });
}
