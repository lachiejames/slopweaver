/**
 * Where the two surfaces disagree — the corroboration output, which is a thing the atlas SHOWS rather than a
 * build-time check it discards.
 *
 * Pure: it takes the stored `method` entities and returns the three sets, so the whole judgement is
 * testable without a store.
 *
 * ## For Notion the expected answer is near-total disagreement, and that IS the finding
 *
 * The installed client addresses `api.notion.com/v1`; the web client addresses `www.notion.so/api/v3`. So
 * unlike Slack — where a handful of browser-only methods stood out against a mostly-agreeing set — this
 * atlas expects almost every row to sit on one channel only. A reader needs that stated as a shape rather
 * than discovered by scrolling a hundred `browser-only` rows, which is why {@link summariseDisagreement}
 * returns counts and a bounded sample instead of the whole list.
 *
 * ## A browser-only operation is a LEAD, never a capability
 *
 * Seeing the first-party client call something establishes that Notion HOLDS the data behind it. It says
 * nothing about whether an ordinary integration token may ask for it, and this module never implies
 * otherwise — the owner's own ruling is that an undocumented endpoint is usable where it works, which is a
 * thing somebody finds out by trying, not something a set difference proves.
 */
import type { NotionAtlasEntity } from "./model.js";

/** How many rows a summary names before it stops, so a report stays readable. */
export const NOTION_DISAGREEMENT_SAMPLE = 12;

/**
 * The three ways a `method` row can sit across the two channels.
 *
 * @internal
 */
export interface NotionDisagreement {
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
export function splitNotionChannels({ entities }: { entities: readonly NotionAtlasEntity[] }): NotionDisagreement {
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
  return {
    apiOnly: apiOnly.toSorted(),
    browserOnly: browserOnly.toSorted(),
    onBoth: onBoth.toSorted(),
  };
}

/**
 * The lines a human report prints for one disagreement.
 *
 * @param split the three sets
 * @returns the report lines, counts first and a bounded sample of the undocumented surface after
 */
export function summariseDisagreement({ split }: { split: NotionDisagreement }): readonly string[] {
  const total = split.onBoth.length + split.apiOnly.length + split.browserOnly.length;
  const lines = [
    `notion surface corroboration — ${String(total)} method row(s) held`,
    `  on both surfaces   ${String(split.onBoth.length)}`,
    `  declared only      ${String(split.apiOnly.length)}  (the installed client declares it; this walk never saw the web client call it)`,
    `  browser only       ${String(split.browserOnly.length)}  (the web client calls it; the installed client does not declare it)`,
  ];
  if (split.browserOnly.length === 0) {
    return lines;
  }
  const shown = split.browserOnly.slice(0, NOTION_DISAGREEMENT_SAMPLE);
  return [
    ...lines,
    `  the undocumented surface, first ${String(shown.length)} of ${String(split.browserOnly.length)}:`,
    ...shown.map((row) => `    ${row}`),
  ];
}
