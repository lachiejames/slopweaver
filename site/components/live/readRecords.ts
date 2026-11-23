/**
 * The records a card may name by a bare printed id — a Datadog monitor, a Vanta control, a Vanta risk — as the board
 * publishes them in `referenceContext.records` (`src/cli/recordReferenceFacts.ts`), read into the two lookups a
 * card's sentence resolves against.
 *
 * A card once named "monitor 50001" with no link, and another `TTX-2` and `HRS-29`,
 * and the owner had to go and formulate the URL by hand. The CLI resolves each id to its address through the code that
 * owns it; this only reads the table.
 *
 * LENIENT where the board's other fields are strict, on purpose: a citation table is a nicety on every card, and a
 * board refused because one entry will not read would cost the owner the Queue to save a chip. So an absent field, or one
 * that is not a list, reads as no records; an entry that will not read, names a kind this page does not know (a
 * newer CLI), or links anything but `https://`, is dropped alone; and an id two entries give different addresses is
 * dropped too — a guess between two records is worse than words. Pure.
 */

import { type Bag, isBag, str } from "../../lib/bag";

/** One record a chip can open, and what its hover card calls it. */
export interface CitedRecord {
  readonly url: string;
  /** A monitor's name, a control's, a risk's scenario — absent when none is known. */
  readonly title: string | undefined;
}

/** What a card's bare ids resolve against, keyed as a sentence spells them. */
export interface RecordReferences {
  /** A Datadog monitor's numeric id, `50001`, to the monitor. */
  readonly monitors: ReadonlyMap<string, CitedRecord>;
  /** A printed Vanta control or risk id, upper-cased — `HRS-29`, `TTX-2` — to its record. */
  readonly printed: ReadonlyMap<string, CitedRecord>;
}

/** A board that publishes none. */
export const NO_RECORD_REFERENCES: RecordReferences = { monitors: new Map(), printed: new Map() };

/** The kinds this page knows, each to the lookup it fills. */
const LOOKUP_OF: Readonly<Record<string, keyof RecordReferences>> = {
  "datadog-monitor": "monitors",
  "vanta-control": "printed",
  "vanta-risk": "printed",
};

/**
 * One published entry, read, or `undefined` when it will not read or is not one this page knows.
 *
 * @returns which lookup it belongs in, its key and its record
 */
function entryOf({
  entry,
}: {
  entry: Bag;
}): { lookup: keyof RecordReferences; key: string; record: CitedRecord } | undefined {
  const id = str({ bag: entry, key: "id" });
  const kind = str({ bag: entry, key: "kind" });
  const url = str({ bag: entry, key: "url" });
  if (id === undefined || id === "" || kind === undefined || url === undefined || !url.startsWith("https://")) {
    return undefined;
  }
  if (!Object.hasOwn(LOOKUP_OF, kind)) {
    return undefined;
  }
  const titleMalformed = entry["title"] !== undefined && str({ bag: entry, key: "title" }) === undefined;
  if (titleMalformed) {
    return undefined;
  }
  return { key: id.toUpperCase(), lookup: LOOKUP_OF[kind], record: { title: str({ bag: entry, key: "title" }), url } };
}

/**
 * The board's records, read into the lookups a card resolves a bare id against.
 *
 * @param payload the board's raw bag
 * @returns the lookups — empty when the board publishes none or the field will not read as a list
 */
export function recordReferencesOf({ payload }: { payload: Bag }): RecordReferences {
  const context = payload["referenceContext"];
  if (!isBag(context) || !Array.isArray(context["records"])) {
    return NO_RECORD_REFERENCES;
  }
  const seen = { monitors: new Map<string, CitedRecord>(), printed: new Map<string, CitedRecord>() };
  const disputed = { monitors: new Set<string>(), printed: new Set<string>() };
  for (const entry of context["records"] as readonly unknown[]) {
    const read = isBag(entry) ? entryOf({ entry }) : undefined;
    if (read === undefined) {
      continue;
    }
    const { lookup, key, record } = read;
    const earlier = seen[lookup].get(key);
    if (earlier !== undefined && earlier.url !== record.url) {
      disputed[lookup].add(key);
    }
    seen[lookup].set(key, record);
  }
  for (const lookup of ["monitors", "printed"] as const) {
    for (const key of disputed[lookup]) {
      seen[lookup].delete(key);
    }
  }
  return seen;
}
