/**
 * The card sweep's failure table: one row per card and surface, from the card scenarios' results in a `desktop e2e`
 * run — what `card-fidelity.json` and `card-fidelity.html` beside `report.json` hold, and what the page the owner reads is
 * built from. Pure.
 *
 * A scenario that never got a judged call (it was blocked, or the surface never answered) is a row too, with the
 * scenario's own failure as its reason, so a card the sweep could not ask about is never read as a clean one. The
 * spoken and typed rows of one card are compared only when both read the same card text (`sourceDigest`): a card that
 * moved between the two asks is said to have moved rather than scored as a difference between surfaces.
 */
import type { CardFidelityObservation } from "./cardFidelity.js";
import type { CardFidelityFailure } from "./cardFidelityFailures.js";
import type { E2eCallStep } from "./e2eCallPlan.js";
import type { E2eStepResult } from "./e2eReport.js";

/** One card on one surface. */
interface CardFidelityRow {
  readonly cardKey: string;
  readonly surface: "spoken" | "typed";
  /** Whether the scenario's structural witness passed: read, answer, challenge, re-read, answer. */
  readonly witnessed: boolean;
  /** Why the scenario failed, when it did. */
  readonly scenarioDetail: string | undefined;
  /** The judged calls, usually one. */
  readonly calls: readonly CardFidelityObservation[];
  /** Every failure across those calls, each anchored. */
  readonly failures: readonly CardFidelityFailure[];
}

/** Whether one card's two surfaces read the same text. */
type SurfacePairing = "same-card" | "card-moved" | "one-surface";

/** The table, and per card whether its surfaces are comparable. */
export interface CardFidelityTable {
  readonly rows: readonly CardFidelityRow[];
  readonly pairings: Readonly<Record<string, SurfacePairing>>;
}

/**
 * Whether a step is a card scenario carrying its card.
 *
 * @returns whether it is
 */
function isCardStep(step: E2eStepResult["step"]): step is E2eCallStep & { readonly cardKey: string } {
  return (
    step.kind === "call" && (step.id === "card-read" || step.id === "card-read-typed") && step.cardKey !== undefined
  );
}

/**
 * The table from a run's results.
 *
 * @param results every step the run took, walk steps included
 * @returns one row per card scenario, in run order, and each card's pairing
 */
export function cardFidelityTable({ results }: { results: readonly E2eStepResult[] }): CardFidelityTable {
  const rows: CardFidelityRow[] = [];
  for (const result of results) {
    const { step } = result;
    if (!isCardStep(step)) {
      continue;
    }
    const calls = result.call === undefined ? [] : result.call.cardFidelity;
    rows.push({
      calls,
      cardKey: step.cardKey,
      failures: calls.flatMap((call) => call.failures),
      scenarioDetail: result.verdict.passed ? undefined : result.verdict.detail,
      surface: step.id === "card-read" ? "spoken" : "typed",
      witnessed: result.verdict.passed,
    });
  }
  const pairings: Record<string, SurfacePairing> = {};
  for (const key of new Set(rows.map((row) => row.cardKey))) {
    const digests = rows
      .filter((row) => row.cardKey === key)
      .map((row) => row.calls.find((call) => call.sourceDigest !== undefined)?.sourceDigest)
      .filter((digest) => digest !== undefined);
    pairings[key] = pairingOf({ digests });
  }
  return { pairings, rows };
}

/**
 * Whether the digests two surfaces read are one card text.
 *
 * @returns the pairing
 */
function pairingOf({ digests }: { digests: readonly string[] }): SurfacePairing {
  if (digests.length < 2) {
    return "one-surface";
  }
  return new Set(digests).size === 1 ? "same-card" : "card-moved";
}

/**
 * Escape text for HTML.
 *
 * @returns the escaped text
 */
function escaped({ text }: { text: string }): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * What one row says in its outcome cell: clean, the scenario's own failure, or each failure with its anchor.
 *
 * @returns the cell's HTML
 */
function outcomeCell({ row }: { row: CardFidelityRow }): string {
  const lines = row.failures.map(
    (failure) =>
      `<li><b>${escaped({ text: failure.code })}</b>${failure.detail === "" ? "" : ` — ${escaped({ text: failure.detail })}`} <code>${escaped({ text: failure.anchor })}</code></li>`,
  );
  if (row.scenarioDetail !== undefined) {
    lines.unshift(`<li><b>SCENARIO</b> — ${escaped({ text: row.scenarioDetail })}</li>`);
  }
  return lines.length === 0 ? "clean" : `<ul>${lines.join("")}</ul>`;
}

/**
 * The table as an HTML fragment: a row per card and surface, failures first, each failure anchored to its transcript
 * line. A body for `slopweaver page publish`, never a whole document.
 *
 * @returns the fragment
 */
export function cardFidelityHtml({ table }: { table: CardFidelityTable }): string {
  const ordered = table.rows.toSorted((a, b) => Number(isClean({ row: a })) - Number(isClean({ row: b })));
  const body = ordered.map((row) => {
    const read = row.calls.some((call) => call.cardRead) ? "yes" : "no";
    const briefing = row.calls.map((call) => call.briefing.state).join(", ");
    const challenge = row.calls.map((call) => call.challenge).join(", ");
    return (
      `<tr><td><code>${escaped({ text: row.cardKey })}</code></td><td>${row.surface}</td><td>${read}</td>` +
      `<td>${escaped({ text: briefing === "" ? "—" : briefing })}</td><td>${escaped({ text: challenge === "" ? "—" : challenge })}</td>` +
      `<td>${outcomeCell({ row })}</td></tr>`
    );
  });
  return (
    "<table><thead><tr><th>Card</th><th>Surface</th><th>Card read</th><th>Briefing</th><th>Challenge</th>" +
    `<th>Failures</th></tr></thead><tbody>${body.join("")}</tbody></table>`
  );
}

/**
 * Whether a row found nothing wrong.
 *
 * @returns whether it is clean
 */
function isClean({ row }: { row: CardFidelityRow }): boolean {
  return row.failures.length === 0 && row.scenarioDetail === undefined;
}
