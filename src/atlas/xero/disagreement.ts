/**
 * Where the two surfaces disagree — the corroboration output, which is a thing the atlas SHOWS rather than a
 * build-time check it discards.
 *
 * Pure: it takes the stored `method` entities and returns the three sets, so the whole judgement is testable
 * without a store.
 *
 * ## A browser-only operation is a LEAD, never a capability
 *
 * Seeing the first-party client call something establishes that Xero HOLDS the data behind it. It says
 * nothing about whether an OAuth connection may ask for it, and this module never implies otherwise — the
 * owner's own ruling is that an undocumented endpoint is usable where it works, which is a thing somebody
 * finds out by trying, not something a set difference proves.
 *
 * ## Two known causes of APPARENT disagreement, stated so a reader does not chase them
 *
 * **Path-parameter spelling.** `projection.ts` rewrites a declared `{InvoiceID}` to the `{id}` an observed
 * uuid reduces to, so most parameterised routes line up. A parameter whose value is not id-shaped does not:
 * `{FileName}` stays `{v}` on the API side while the browser reduction leaves a real file name as a readable
 * segment, so such a pair reads as two rows. That is a limit of shape-matching, not a finding about Xero.
 *
 * **Reach.** A declared operation the client never calls appears as `declared only`, and on this atlas that
 * set is large by construction: one walk of forty pages exercises a fraction of a 475-operation API. It says
 * the walk did not see it, never that the client cannot call it.
 */
import type { XeroAtlasEntity } from "./model.js";

/** How many rows a summary names before it stops, so a report stays readable. */
export const XERO_DISAGREEMENT_SAMPLE = 12;

/**
 * The three ways a `method` row can sit across the two channels.
 *
 * @internal
 */
export interface XeroDisagreement {
  /** Rows both channels saw: the SDK declares it and the web client was observed calling it. */
  readonly onBoth: readonly string[];
  /** Rows the SDK declares that this walk never saw the client call. */
  readonly apiOnly: readonly string[];
  /** Rows the client called that the SDK does not declare — the undocumented surface. */
  readonly browserOnly: readonly string[];
}

/**
 * Split the stored method rows by which channels have looked at each.
 *
 * @param entities every `method` entity the store holds
 * @returns the three sets, each sorted, holding provider ids
 */
export function splitXeroChannels({ entities }: { entities: readonly XeroAtlasEntity[] }): XeroDisagreement {
  const onBoth: string[] = [];
  const apiOnly: string[] = [];
  const browserOnly: string[] = [];
  for (const entity of entities) {
    const api = entity.channels.api !== null;
    const browser = entity.channels.browser !== null;
    if (api && browser) {
      onBoth.push(entity.providerId);
    } else if (api) {
      apiOnly.push(entity.providerId);
    } else if (browser) {
      browserOnly.push(entity.providerId);
    }
  }
  return { apiOnly: apiOnly.toSorted(), browserOnly: browserOnly.toSorted(), onBoth: onBoth.toSorted() };
}

/**
 * The lines a human report prints for one disagreement.
 *
 * @param split the three sets
 * @returns the report lines, counts first and a bounded sample of the undocumented surface after
 */
export function summariseDisagreement({ split }: { split: XeroDisagreement }): readonly string[] {
  const total = split.onBoth.length + split.apiOnly.length + split.browserOnly.length;
  const lines = [
    `xero surface corroboration — ${String(total)} method row(s) held`,
    `  on both surfaces   ${String(split.onBoth.length)}`,
    `  declared only      ${String(split.apiOnly.length)}  (the installed client declares it; this walk never saw the web client call it)`,
    `  browser only       ${String(split.browserOnly.length)}  (the web client calls it; the installed client does not declare it)`,
  ];
  if (split.browserOnly.length === 0) {
    return lines;
  }
  const shown = split.browserOnly.slice(0, XERO_DISAGREEMENT_SAMPLE);
  return [
    ...lines,
    `  the undocumented surface, first ${String(shown.length)} of ${String(split.browserOnly.length)}:`,
    ...shown.map((row) => `    ${row}`),
  ];
}
