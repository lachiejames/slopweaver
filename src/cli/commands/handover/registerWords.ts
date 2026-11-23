/**
 * The one line `handover register` prints when a session registers an ask by hand with nothing tying it to words of
 * the owner: how to find the turn it came from and attach it, so its Queue card leads with the owner's quote
 * instead of a line saying nothing records whose words are behind it.
 *
 * Printed only where it can be acted on. An automation registering a row (a landing, a meeting-notes sweep, a spend
 * finding) has no turn of the owner's behind it, so the line would be noise there. A Slack-anchored row keeps its
 * Slack provenance — the card already names where it came from — and a finding or a dispatch is the fleet's own,
 * not the owner's.
 */

/** Who is registering: a session typing the verb, or a verb registering a row of its own. */
export type RegisterOrigin = "command" | "automation";

/**
 * The hint line for a freshly registered row, or `undefined` when the row needs none.
 *
 * @param origin whether a session typed `handover register` or another verb registered through it
 * @param anchor the row's `--anchor`, if any
 * @param finding whether the row is a fleet finding
 * @param dispatch whether the row is a dispatch
 * @returns the line, indented as the register receipt's other lines are
 */
export function registerWordsHint({
  origin,
  slug,
  anchor,
  finding,
  dispatch,
}: {
  origin: RegisterOrigin;
  slug: string;
  anchor: string | undefined;
  finding: boolean;
  dispatch: boolean;
}): string | undefined {
  if (origin !== "command" || anchor !== undefined || finding || dispatch) {
    return undefined;
  }
  return (
    `  no anchor, so its card names no words of the owner's — if they said this: ` +
    `slopweaver profile words --phrase "<a few of the owner's words>" --since 1d, then ` +
    `slopweaver handover quote ${slug} --anchor <anchor> --apply`
  );
}
