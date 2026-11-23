/**
 * A parked draft's attachments, as `slopweaver slack draft list --json` prints them: each one's recorded
 * filename, byte count and SHA-256 — the three facts the owner's approval's digest binds.
 *
 * Kept beside `./readSlackDrafts.ts` rather than inside it: that reader is the message's own bytes, and this
 * is the one field a draft carrying a video adds. The same refusal rule holds — an entry that will not read
 * whole takes the whole reading down, because a card that drew a draft with an attachment missing would show
 * the owner something other than what the owner is approving. An ABSENT field is a text-only draft, which is every row a
 * CLI older than the field ever wrote.
 *
 * The panel names an attachment; it never plays one. The bytes sit in the owner-only draft-media store, and
 * nothing here reads or links a path.
 */

import { type Bag, bags, num, str } from "../../lib/bag";

/** One stored attachment a parked draft will post under its message. */
export interface DraftMedia {
  /** The filename Slack will show, as recorded — never a path. */
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** What a parked draft carries about its attachments; empty for a text-only draft. */
export interface DraftAttachments {
  readonly media: readonly DraftMedia[];
}

/** A lowercase-hex SHA-256, the only shape the register records. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Read a draft row's `media` field.
 *
 * @param draft the row's `draft` object
 * @returns each attachment in attach order, `[]` when the field is absent, or `undefined` when any entry is
 *   not a whole, well-formed one
 */
export function draftMediaOf({ draft }: { draft: Bag }): readonly DraftMedia[] | undefined {
  return mediaEntriesOf({ bag: draft, key: "media" });
}

/**
 * Read a list of stored attachments off any object — the draft's own `media`, or the `proof` an earlier-ask
 * declaration carries, which the register stores the same way.
 *
 * @param bag the object holding the list
 * @param key the field the list sits under
 * @returns each attachment in order, `[]` when the field is absent, or `undefined` when any entry is not a
 *   whole, well-formed one
 */
export function mediaEntriesOf({ bag, key }: { bag: Bag; key: string }): readonly DraftMedia[] | undefined {
  if (bag[key] === undefined) {
    return [];
  }
  const rows = bags({ bag, key });
  if (rows === undefined) {
    return undefined;
  }
  const media: DraftMedia[] = [];
  for (const row of rows) {
    const name = str({ bag: row, key: "name" });
    const bytes = num({ bag: row, key: "bytes" });
    const sha256 = str({ bag: row, key: "sha256" });
    const whole =
      name !== undefined &&
      name.trim() !== "" &&
      bytes !== undefined &&
      Number.isSafeInteger(bytes) &&
      bytes > 0 &&
      sha256 !== undefined &&
      SHA256_HEX.test(sha256);
    if (!whole) {
      return undefined;
    }
    media.push({ bytes, name, sha256 });
  }
  return media;
}
