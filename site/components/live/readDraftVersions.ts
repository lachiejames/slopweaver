/**
 * A parked draft's voice edits, as `slack draft list --json` prints them (`src/cli/commands/slack/draftListDocument.ts`):
 * the words as the console voice edits them on a row it can revise (`editableText`), and every version once one was
 * revised, oldest first (`versions`). The voice edits the parked draft on the card
 * the owner has open, then shows v2 with v1 kept, and v1 comes back on the owner's word.
 */

import { type Bag, isBag, num, str, strings } from "../../lib/bag";

/** One version of a revised draft's words, as the card's history draws it. */
export interface DraftVersionView {
  readonly number: number;
  readonly atIso: string;
  /** The words as text, in the voice's editing shape. */
  readonly text: string;
  /** The owner's words the edit was made on, when it was. */
  readonly heard: string | undefined;
  /** The voice's reading of them, one checklist line each. */
  readonly reading: readonly string[] | undefined;
  /** The earlier version this one put back, on a restore. */
  readonly restoredFrom: number | undefined;
}

/** What a row carries about voice edits. */
export interface DraftRevisionView {
  readonly editableText: string | undefined;
  readonly versions: readonly DraftVersionView[] | undefined;
}

/** The keys a listed version may carry; any other refuses the row rather than vanishing. */
const VERSION_KEYS: ReadonlySet<string> = new Set([
  "anchor",
  "atIso",
  "digest",
  "heard",
  "number",
  "reading",
  "restoredFrom",
  "text",
]);

/** One listed version, or `undefined` when it is not one this reader can draw truthfully. */
function versionOf({ value, number }: { value: unknown; number: number }): DraftVersionView | undefined {
  if (!isBag(value) || !Object.keys(value).every((key) => VERSION_KEYS.has(key))) {
    return undefined;
  }
  const atIso = str({ bag: value, key: "atIso" });
  const text = str({ bag: value, key: "text" });
  const heard = str({ bag: value, key: "heard" });
  const reading = strings({ bag: value, key: "reading" });
  const restoredFrom = num({ bag: value, key: "restoredFrom" });
  const badOptional =
    (value["heard"] !== undefined && heard === undefined) ||
    (value["reading"] !== undefined && reading === undefined) ||
    (value["restoredFrom"] !== undefined &&
      (restoredFrom === undefined || !Number.isInteger(restoredFrom) || restoredFrom < 1 || restoredFrom >= number));
  if (num({ bag: value, key: "number" }) !== number || atIso === undefined || text === undefined || badOptional) {
    return undefined;
  }
  return { atIso, heard, number, reading, restoredFrom, text };
}

/**
 * One row's voice edits. A row the voice cannot revise carries no `editableText`; a row never revised carries no
 * `versions`. A history that is present and not numbered 1, 2, 3… from the oldest is `"malformed"`, which refuses the
 * row rather than drawing a card whose v1 is not the words the owner first saw.
 *
 * @param item the listed row
 * @returns the edits, or `"malformed"`
 */
export function draftRevisionOf({ item }: { item: Bag }): DraftRevisionView | "malformed" {
  const editableText = str({ bag: item, key: "editableText" });
  if (item["editableText"] !== undefined && editableText === undefined) {
    return "malformed";
  }
  const listed = item["versions"];
  if (listed === undefined) {
    return { editableText, versions: undefined };
  }
  if (!Array.isArray(listed) || listed.length < 2) {
    return "malformed";
  }
  const versions: DraftVersionView[] = [];
  for (const [index, value] of listed.entries()) {
    const version = versionOf({ number: index + 1, value });
    if (version === undefined) {
      return "malformed";
    }
    versions.push(version);
  }
  return { editableText, versions };
}

/**
 * The one line a revised card carries under its words: which version it reads as, and that the earlier ones are kept.
 *
 * @param versions the row's history, oldest first
 * @returns the line, such as `v2 · v1 kept`
 */
export function versionLine({ versions }: { versions: readonly DraftVersionView[] }): string {
  const current = versions.at(-1)!;
  const kept = versions.length === 2 ? "v1 kept" : `v1 to v${String(versions.length - 1)} kept`;
  const restored = current.restoredFrom === undefined ? "" : ` (v${String(current.restoredFrom)} put back)`;
  return `v${String(current.number)}${restored} · ${kept}`;
}
