/*
 * What the outbound artifact alertSummary test files share: the reference tally form, the trend sentence a form
 * with no baseline derives, and the run, index and paragraph readers the assertions are written against. They
 * moved here when `alertSummary.test.ts` was split by behaviour.
 */
import { z } from "zod";

import type { AlertSummaryForm } from "../../../../../outbound/artifact/alertSummary.js";
import type { DetailBlock, InlineRun, UpdateArtifact } from "../../../../../outbound/artifact/types.js";

/**
 * The trend paragraph a form with NO `trend` field derives.
 *
 * Every card carries a trend paragraph, and this is the one a form that read no baseline gets — see
 * `outbound/artifact/trend.ts` on why an absent baseline states its absence rather than rendering a verdict.
 * It is also the sixth block that used to be `Every alert this window fired is listed above.`, which is gone.
 */
export const NO_TREND_SENTENCE = "No comparison with the prior windows was made.";

/**
 * A tally with a clear noisiest row, one tie to break, and one row backed by a query.
 *
 * @returns the reference tally form
 */
export function tallyForm(): AlertSummaryForm {
  return {
    kind: "alert-summary",
    label: "Gateway",
    lead: "The top two are the same deploy.",
    rows: [
      { count: 12, label: "queue-drain stalled" },
      { citationUrl: "https://example.invalid/logs?q=timeout", count: 240, label: "upstream timeout" },
      { count: 12, label: "cache miss storm" },
      { count: 97, label: "token refresh 401" },
    ],
    skipped: 0,
    window: "7d",
  };
}

/**
 * The visible width of a run sequence, by the schema's own rule: a chip costs its `[n]`.
 *
 * @returns the visible width in characters
 */
export function widthOf({ runs, labels }: { runs: readonly InlineRun[]; labels: ReadonlyMap<string, string> }): number {
  return runs.reduce((total, run) => {
    if (run.type === "text") {
      return total + run.text.length;
    }
    if (run.type === "citation") {
      return total + labels.get(run.citationId)!.length;
    }
    return total;
  }, 0);
}

/**
 * The citation-id to `[n]` map an artifact's own citations imply.
 *
 * @returns the label of each citation, keyed by its id
 */
export function labelsOf({
  artifact,
}: {
  artifact: { citations: readonly { id: string; label: string }[] };
}): Map<string, string> {
  return new Map(artifact.citations.map((citation) => [citation.id, citation.label]));
}

/**
 * The text of every index line, which is what most ordering assertions are about.
 *
 * @returns each index line's flattened text
 */
export function indexText({ index }: { index: readonly (readonly InlineRun[])[] }): readonly string[] {
  return index.map((line) =>
    line
      .filter((run) => run.type === "text")
      // Moved verbatim from a test file, where this rule is off: the filter already narrows `run`, and the
      // re-check is what the move kept byte-identical.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      .map((run) => (run.type === "text" ? run.text : ""))
      .join(""),
  );
}

/**
 * Every paragraph's flattened text, in order.
 *
 * @returns each paragraph's flattened text
 */
export function paragraphTexts({ detail }: { detail: readonly DetailBlock[] }): readonly string[] {
  return detail
    .filter((block) => block.type === "paragraph")
    .map((block) =>
      // Moved verbatim from a test file, where this rule is off: the filter already narrows `block`, and the
      // re-check is what the move kept byte-identical.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      (block.type === "paragraph" ? block.runs : []).map((run) => (run.type === "text" ? run.text : "")).join(""),
    );
}

/**
 * The refusal text of a failed `safeParse`, without a conditional in the assertion.
 *
 * @returns the prettified refusal text
 */
export function messageOf({ parsed }: { parsed: { success: boolean; error?: z.ZodError } }): string {
  return z.prettifyError(parsed.error!);
}

/**
 * Every inline run anywhere in a card — index lines, paragraphs, bullets and table cells alike.
 *
 * @returns every inline run, index lines first
 */
export function everyRun({ artifact }: { artifact: UpdateArtifact }): readonly InlineRun[] {
  const fromDetail = artifact.detail.flatMap((block) => {
    if (block.type === "paragraph") {
      return [...block.runs];
    }
    if (block.type === "bullets" || block.type === "list") {
      return block.items.flat();
    }
    return block.rows.flat().flat();
  });
  return [...artifact.index.flat(), ...fromDetail];
}
