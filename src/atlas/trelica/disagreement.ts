/**
 * Where the three surfaces disagree — the corroboration output, which is a thing the atlas SHOWS rather
 * than a build-time check it discards.
 *
 * Pure: it takes the stored `method` entities and returns the sets, so the whole judgement is testable
 * without a store.
 *
 * ## Three channels, so the interesting question is not "both or one"
 *
 * The vendor's published API and the surface its own client calls share almost no vocabulary at all: one
 * addresses `/api/<area>/v1` and the other `/AppsApi/<area>/<Operation>`. So near-total disagreement is
 * expected and IS the finding, and a reader needs it as a shape rather than discovered by scrolling. What
 * is genuinely worth a row here is the third set: an operation this atlas CALLED and got an answer from,
 * which the published API does not declare — evidence that the undocumented surface is not merely visible
 * but usable, which is the owner's ruling made concrete.
 *
 * ## An observed operation is a LEAD, never a capability
 *
 * Seeing the client call something establishes that the platform HOLDS the data behind it. It says nothing
 * about whether an ordinary credential may ask for it. `calledDirectly` on the first-party detail is what
 * separates the two, and this module reports them apart rather than merging them into one "undocumented"
 * pile.
 */
import { isRecord } from "../../lib/parsers.js";

import type { TrelicaAtlasEntity } from "./model.js";

/**
 * How many rows a summary names before it stops, so a report stays readable.
 *
 * @internal
 */
export const TRELICA_DISAGREEMENT_SAMPLE = 12;

/**
 * How the stored method rows sit across the three channels.
 *
 * @internal
 */
export interface TrelicaDisagreement {
  /** Rows the vendor's published documents declare. */
  readonly publishedOnly: readonly string[];
  /** Rows this atlas CALLED and got an answer from, which no published document declares. */
  readonly calledUndocumented: readonly string[];
  /** Rows the walk saw the client call, which no published document declares and this atlas never called. */
  readonly observedUndocumented: readonly string[];
  /** Rows more than one channel holds — a genuine corroboration. */
  readonly corroborated: readonly string[];
}

/**
 * Whether a first-party channel record says this atlas made the call itself.
 *
 * A stored `detail` is `unknown` by schema, so this reads the one field it cares about through a guard
 * rather than asserting the whole shape — a generation written by an older build is then a `false` here
 * instead of a crash.
 */
function wasCalledDirectly({ detail }: { detail: unknown }): boolean {
  return isRecord(detail) && detail["calledDirectly"] === true;
}

/**
 * Split the stored method rows by which channels have looked at each.
 *
 * @param entities every `method` entity the store holds
 * @returns the four sets, each sorted, holding provider ids
 */
export function splitTrelicaChannels({ entities }: { entities: readonly TrelicaAtlasEntity[] }): TrelicaDisagreement {
  const publishedOnly: string[] = [];
  const calledUndocumented: string[] = [];
  const observedUndocumented: string[] = [];
  const corroborated: string[] = [];
  for (const entity of entities) {
    const published = entity.channels["published-api"] !== null;
    const firstParty = entity.channels["first-party-api"];
    const browser = entity.channels.browser !== null;
    const looked = [published, firstParty !== null, browser].filter(Boolean).length;
    if (looked > 1) {
      corroborated.push(entity.providerId);
      continue;
    }
    if (published) {
      publishedOnly.push(entity.providerId);
      continue;
    }
    if (firstParty !== null && wasCalledDirectly({ detail: firstParty.detail })) {
      calledUndocumented.push(entity.providerId);
      continue;
    }
    if (browser || firstParty !== null) {
      observedUndocumented.push(entity.providerId);
    }
  }
  return {
    calledUndocumented: calledUndocumented.toSorted(),
    corroborated: corroborated.toSorted(),
    observedUndocumented: observedUndocumented.toSorted(),
    publishedOnly: publishedOnly.toSorted(),
  };
}

/**
 * The lines a human report prints for one disagreement.
 *
 * @param split the sets
 * @returns the report lines, counts first and a bounded sample of the undocumented surface after
 */
export function summariseTrelicaDisagreement({ split }: { split: TrelicaDisagreement }): readonly string[] {
  const total =
    split.corroborated.length +
    split.publishedOnly.length +
    split.calledUndocumented.length +
    split.observedUndocumented.length;
  const lines = [
    `trelica surface corroboration — ${String(total)} method row(s) held`,
    `  corroborated          ${String(split.corroborated.length)}  (more than one channel has looked at it)`,
    `  published only        ${String(split.publishedOnly.length)}  (a vendor document declares it; nothing here has called or observed it)`,
    `  called, undocumented  ${String(split.calledUndocumented.length)}  (this atlas called it and got an answer; no vendor document declares it)`,
    `  observed only         ${String(split.observedUndocumented.length)}  (the web client calls it; this atlas has not, and no document declares it)`,
  ];
  const undocumented = [...split.calledUndocumented, ...split.observedUndocumented];
  if (undocumented.length === 0) {
    return lines;
  }
  const shown = undocumented.slice(0, TRELICA_DISAGREEMENT_SAMPLE);
  return [
    ...lines,
    `  the undocumented surface, first ${String(shown.length)} of ${String(undocumented.length)}:`,
    ...shown.map((row) => `    ${row}`),
  ];
}
