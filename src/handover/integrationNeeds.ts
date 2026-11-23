/**
 * A board row that NEEDS an integration this install is not connected to is held, never offered as ready work.
 *
 * A session with good judgment knows what is connected, and rows needing an unconnected integration (Fathom, Google
 * Calendar, Trelica) are fine to stay on the board. So the row stays where it is and keeps its rank; only
 * its `standing` changes, from `ready` to `blocked` (`./rowStanding.ts`), so no fill spends a seat on work whose
 * every read would fail on the first call. The day the credential is stored, the next reconciliation offers it.
 *
 * Two halves, each the reason the hold can be trusted:
 *
 * - **A row DECLARES what it needs**, with the `needs` tag (`./rowTags.ts`). The board never guesses it from a
 *   row's words — a row that merely MENTIONS Fathom may be a redaction fix any checkout can make.
 * - **Connected is read off the secrets store**, by file name only, never a value: an integration is connected
 *   when EVERY file of any ONE of its credential sets is stored — Datadog wants its API and app key together,
 *   Slack either token alone. That is the same fact `slopweaver secrets status` prints, and an expired grant
 *   still counts as connected — reconnecting it is a seat's work, which a hold would hide.
 * - **Only a complete tag fold is ever read.** A row whose journal holds a line this build cannot read — so its
 *   fold may lack a `needs` tag or the unset that cleared one — composes to `CONTRADICTION`, never `RUN NOW`
 *   (`./boardTypes.ts` `runDisposition`), and this hold reads `RUN NOW` alone.
 *
 * GitHub is deliberately absent: this install reaches it through the existing `gh` login, which stores nothing
 * here, so a `needs=github` hold would hold every GitHub row on a machine that can do them all.
 *
 * Pure — tags and stored file names in, holds out. `../cli/commands/handover/reconcileRows.ts` reads the store.
 */

import { type IntegrationNeedRow, integrationNeedRowsOf } from "../integrations/connections.js";
import { registeredIntegrations } from "../integrations/registry.js";
import type { BoardModel } from "./boardTypes.js";

/**
 * Every integration a row may declare it needs: each manifest carrying a `connection`, in its ordinal order. Adding
 * one is its manifest: the `needs` tag's values are read from this list, so the vocabulary and the check cannot
 * disagree.
 */
export const INTEGRATIONS: readonly IntegrationNeedRow[] = integrationNeedRowsOf({
  manifests: registeredIntegrations(),
});

/** Whether this install stores every file of at least one of the integration's credential sets. */
function isConnected({ spec, stored }: { spec: IntegrationNeedRow; stored: ReadonlySet<string> }): boolean {
  return spec.credentialSets.some((set) => set.every((name) => stored.has(name)));
}

/** The `needs=` values a row may declare, in table order. */
export const INTEGRATION_NAMES: readonly string[] = INTEGRATIONS.map((spec) => spec.integration);

/** The `needs` tag key a row declares an integration with. */
export const NEEDS_KEY = "needs";

/** One held row: its slug, for a reader, and every integration it needs that this install is not connected to. */
export interface DisconnectedRow {
  readonly slug: string;
  readonly needs: readonly string[];
}

/**
 * The integrations a row needs that this install stores no credential for, in table order.
 *
 * A `needs` value the table does not carry is not reached here: the tag fold keeps only values today's registry
 * accepts as `declared`, so an unrecognised one is shown on the row and never holds it.
 *
 * @param tags the row's tags, as the fold reads them
 * @param stored every credential file name the secrets store holds
 * @returns the disconnected integrations, empty when the row needs nothing or everything it needs is connected
 */
export function disconnectedNeedsOf({
  tags,
  stored,
}: {
  tags: readonly { readonly key: string; readonly value: string; readonly source: string }[];
  stored: ReadonlySet<string>;
}): readonly string[] {
  const needed = new Set(
    tags.filter((tag) => tag.key === NEEDS_KEY && tag.source === "declared").map((tag) => tag.value),
  );
  return INTEGRATIONS.filter((spec) => needed.has(spec.integration) && !isConnected({ spec, stored })).map(
    (spec) => spec.integration,
  );
}

/**
 * Every `RUN NOW` row needing an integration this install is not connected to, keyed by doc PATH — two docs may
 * share a slug, and only the one that declared the need is held.
 *
 * Only a row that RANKS as `RUN NOW` is read: an `IN FLIGHT` row already has its seat open, so whether a fill
 * should seat it is no longer the question, the same rule `./rowStanding.ts` applies to a repoless row. Which rows
 * rank there is the caller's ranking, not the composed section: a parked seat the owner's standing-session ruling keeps
 * composes `IN FLIGHT` and is LIFTED to `RUN NOW` to be seated again, and read off the composed section it
 * escaped this hold and read ready.
 *
 * @param models the composed board
 * @param stored every credential file name the secrets store holds
 * @param ranksRunNow whether a row ranks in `RUN NOW` — the section the fill seats from
 * @returns the held rows, by doc path
 */
export function disconnectedRowsOf({
  models,
  stored,
  ranksRunNow,
}: {
  models: readonly BoardModel[];
  stored: ReadonlySet<string>;
  ranksRunNow: (model: BoardModel) => boolean;
}): ReadonlyMap<string, DisconnectedRow> {
  const held = new Map<string, DisconnectedRow>();
  for (const model of models) {
    if (!ranksRunNow(model)) {
      continue;
    }
    const needs = disconnectedNeedsOf({ stored, tags: model.tags.tags });
    if (needs.length > 0) {
      held.set(model.doc.path, { needs, slug: model.doc.slug });
    }
  }
  return held;
}

/**
 * The lines that say what the disconnected-integration hold did, so it is never a silent drop in the ready count.
 *
 * @param held each held row, by doc path
 * @param unread why the secrets store could not be listed, when it could not — every row is then offered unchecked
 * @returns zero or more lines
 */
export function disconnectedLines({
  held,
  unread,
}: {
  held: ReadonlyMap<string, DisconnectedRow>;
  unread: string | undefined;
}): readonly string[] {
  if (unread !== undefined) {
    return [
      `(the secrets store could not be listed — ${unread} — so a row's \`needs\` tag held nothing; every ` +
        "such row is offered unchecked.)",
    ];
  }
  if (held.size === 0) {
    return [];
  }
  const rows = [...held.values()].toSorted((a, b) => a.slug.localeCompare(b.slug));
  const needed = new Set(rows.flatMap((row) => row.needs));
  const ways = INTEGRATIONS.filter((spec) => needed.has(spec.integration)).map(
    (spec) => `${spec.integration}: \`${spec.connectWith}\``,
  );
  return [
    `(${String(held.size)} RUN NOW row(s) need an integration this install is not connected to — held, not to ` +
      `pick up, and kept on the board. Connecting one frees its rows: ${ways.join("; ")}.)`,
    ...rows.map((row) => `  ${row.slug} — needs ${row.needs.join(", ")}`),
  ];
}
