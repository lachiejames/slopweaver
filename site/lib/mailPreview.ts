/**
 * The pure half of the mail preview: how much of a body a card shows, and which board row a preview
 * address names.
 *
 * Kept out of the component so a unit test reaches it without a DOM — the same split
 * `./slackMrkdwn.ts` makes for the Slack preview.
 */

/** What a card shows of a body, and how much it left for the whole-mail page. */
export interface MailBodyFold {
  readonly shown: string;
  readonly hiddenLines: number;
}

/**
 * The first `lines` lines of a body, and a count of the rest.
 *
 * A trailing run of blank lines is not counted as hidden: "3 more lines" over three empty ones would send
 * the owner to a page to read nothing.
 *
 * @param body the mail body exactly as recorded
 * @param lines how many lines to show; `Infinity` shows all of them
 * @returns the shown text and the count of meaningful lines left out
 */
export function mailBodyFold({ body, lines }: { body: string; lines: number }): MailBodyFold {
  const all = body.replace(/\s+$/u, "").split("\n");
  if (all.length <= lines) {
    return { hiddenLines: 0, shown: all.join("\n") };
  }
  return { hiddenLines: all.length - lines, shown: all.slice(0, lines).join("\n") };
}

/** A board row on the console's board read, reduced to what the preview page looks it up by. */
export interface MailPreviewRow {
  readonly slug: string;
  readonly digest: string | undefined;
}

/** What a preview address resolved to against the board as it stands. */
export type MailPreviewLookup =
  | { readonly kind: "current" }
  /** The row exists and offers a different mail now — the address is someone's old preview. */
  | { readonly kind: "superseded"; readonly currentDigest: string }
  /** The row offers no mail at all now: answered, re-asked, or never offered one. */
  | { readonly kind: "no-mail" }
  | { readonly kind: "no-row" };

/**
 * Which state one preview address is in against the board.
 *
 * A superseded address is SAID, never quietly redirected to the new mail: the owner may be about to press on the
 * strength of what they read, and the verb would refuse the old digest anyway. Showing the new mail under the
 * old address would make the page and the refusal disagree.
 *
 * @param rows every board row, with its published mail digest when it has one
 * @param slug the slug off the address
 * @param digest the digest off the address
 * @returns the lookup's state
 */
export function lookupMailPreview({
  rows,
  slug,
  digest,
}: {
  rows: readonly MailPreviewRow[];
  slug: string;
  digest: string;
}): MailPreviewLookup {
  const row = rows.find((one) => one.slug === slug);
  if (row === undefined) {
    return { kind: "no-row" };
  }
  if (row.digest === undefined) {
    return { kind: "no-mail" };
  }
  if (row.digest !== digest) {
    return { currentDigest: row.digest, kind: "superseded" };
  }
  return { kind: "current" };
}
