/**
 * The human read of `handover currency`: by default a count line, each shared standing change once, and every card
 * with a cause of its own; every card behind `--full`. Pure — the document in, lines out; `./currencyRun.ts` prints.
 *
 * MEASURED on one install: the read printed one line per Queue card, 87 of them, 8,149 characters,
 * of which every one but nine said "facts confirmed; since 0 filed here, 0 unfiled" or the same with a not-confirmed
 * fact and nothing new. A reader looking for what changed had to scan all 87. Reproduce with
 * `slopweaver handover currency --full` against `slopweaver handover currency`.
 *
 * `--json` and `--record-reading` are untouched by this: both always carry the whole document.
 */
import type { CurrencyDocument, CurrencyRow } from "../../../handover/currency.js";

/**
 * Whether a card has something to act on: a word of the owner's filed nowhere yet, a change to the owner's standing guidance since
 * the card's floor (which fails its steers half, `../../../handover/currency.ts`), a source that could not be read, a
 * fact whose read failed, a reply found by its done-check, or a done-check that could not run. A card
 * whose facts are merely not re-confirmed, or whose ask is simply still waiting, has not changed and is counted.
 *
 * @returns true when the default read names the card
 */
export function currencyRowNeedsAction({ row }: { row: CurrencyRow }): boolean {
  if (row.since.words.some((word) => word.filed === "unfiled")) {
    return true;
  }
  if (row.since.standing.length > 0 || row.since.gaps.length > 0) {
    return true;
  }
  if (row.fact.kind === "not-confirmed" && row.fact.unread !== undefined) {
    return true;
  }
  return row.done?.kind === "replied" || row.done?.kind === "could-not-check";
}

/** One card's line, as the read has always printed it, plus a failed fact read's own reason when there is one. */
function rowLine({ row }: { row: CurrencyRow }): string {
  const unfiled = row.since.words.filter((word) => word.filed === "unfiled").length;
  const here = row.since.words.length - unfiled;
  const gaps = row.since.gaps.length === 0 ? "" : `; ${String(row.since.gaps.length)} gap(s)`;
  const done = row.done === undefined ? "" : `done ${row.done.kind}; `;
  const standing = `; ${String(row.since.standing.length)} standing change(s)`;
  const unread = row.fact.kind === "not-confirmed" && row.fact.unread !== undefined ? ` (${row.fact.unread})` : "";
  return `${row.key}: facts ${row.fact.kind}${unread}; ${done}since ${String(here)} filed here, ${String(unfiled)} unfiled${standing}${gaps}`;
}

/**
 * Whether a card has something to act on that is its OWN — anything {@link currencyRowNeedsAction} names except a
 * standing change that can bear on any card. Such a change is one subject however many cards post-date it, so the
 * default read names it once rather than once per card.
 */
function hasOwnCause({ row }: { row: CurrencyRow }): boolean {
  const withoutShared: CurrencyRow = {
    ...row,
    since: { ...row.since, standing: row.since.standing.filter((change) => change.filed === "here") },
  };
  return currencyRowNeedsAction({ row: withoutShared });
}

/**
 * One line per distinct shared standing change, each with how many DISTINCT cards it bears on, oldest first — a card
 * listing the same change twice is still one card.
 */
function sharedStandingLines({ rows }: { rows: readonly CurrencyRow[] }): readonly string[] {
  const bearing = new Map<string, { atIso: string; cards: Set<string> }>();
  for (const row of rows) {
    for (const change of row.since.standing.filter((each) => each.filed === "unfiled")) {
      const key = `${change.source} ${change.pointer} at ${change.atIso}`;
      const seen = bearing.get(key);
      if (seen === undefined) {
        bearing.set(key, { atIso: change.atIso, cards: new Set([row.key]) });
      } else {
        seen.cards.add(row.key);
      }
    }
  }
  return [...bearing.entries()]
    .toSorted(([, a], [, b]) => Date.parse(a.atIso) - Date.parse(b.atIso))
    .map(([line, change]) => `standing: ${line} — bears on ${String(change.cards.size)} card(s)`);
}

/**
 * The card lines the default read prints: the count, each shared standing change once, then every card with a cause
 * of its own, and a count of the cards whose only cause is a shared change. Nothing is capped: a card with a cause of
 * its own is always named, so no actionable key is ever folded into a bare count.
 */
function summaryRowLines({ rows }: { rows: readonly CurrencyRow[] }): readonly string[] {
  const actionable = rows.filter((row) => currencyRowNeedsAction({ row }));
  const own = actionable.filter((row) => hasOwnCause({ row }));
  const sharedOnly = actionable.length - own.length;
  const unchanged = rows.length - actionable.length;
  const count =
    `cards: ${String(rows.length)} — ${String(actionable.length)} with something to act on, ` +
    `${String(unchanged)} unchanged (--full lists every card)`;
  // The tail counts EVERY card the default leaves unnamed, by kind, so its number is exactly what --full adds.
  const kinds = [
    ...(unchanged > 0 ? [`${String(unchanged)} unchanged`] : []),
    ...(sharedOnly > 0 ? [`${String(sharedOnly)} whose only change is a standing one above`] : []),
  ];
  const hiddenTail =
    kinds.length > 0
      ? [`… and ${String(unchanged + sharedOnly)} card(s) not named here: ${kinds.join(", ")} (--full names them)`]
      : [];
  return [count, ...sharedStandingLines({ rows }), ...own.map((row) => rowLine({ row })), ...hiddenTail];
}

/**
 * Every line the human read prints, in order: when it was checked, what each source of the owner's words read, the cards,
 * then the pull-request body read and each proof verdict.
 *
 * @param document the reading the verb built
 * @param full whether to print every card's line rather than the count and the actionable ones
 * @returns the lines
 */
export function currencyHumanLines({
  document,
  full,
}: {
  document: CurrencyDocument;
  full: boolean;
}): readonly string[] {
  const cards = full ? document.rows.map((row) => rowLine({ row })) : summaryRowLines({ rows: document.rows });
  return [
    `checked ${document.checkedIso}, the owner's words read from ${document.readFromIso}`,
    `chair: ${document.sources.chair}; relays: ${document.sources.relays}; calls: ${document.sources.voice}`,
    `memories: ${document.sources.memory}; profile: ${document.sources.profile}; rulings: ${document.sources.rulings}`,
    ...cards,
    `github: ${document.sources.github}`,
    ...document.pullRequests.map((pr) => `${pr.identity}: proof ${pr.proof.kind}`),
  ];
}
