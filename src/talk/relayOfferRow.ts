/**
 * The section a relay's board row carries for the copy-tray offer the owner was reacting to — every byte of it, recoverable.
 *
 * The row's front-matter `summary` is the owner's words (`handover register`'s ask), a field `handover check` measures against
 * `MAX_SUMMARY_BYTES`, and an offer of 8192 characters can be several times that in UTF-8. So the offer adds no byte to
 * it: it goes in the body, in its own section between two markers naming the turn's anchor, and each
 * part sits in its own fenced block whose fence is longer than any run of backticks in that part, so no message text
 * can close it early. Reading a part back is the lines between its fences, exactly.
 *
 * The section says what it is: the voice's draft, not the owner's words. The owner's quoted words above it are the only authority on
 * whether they approved, rejected or amended it — nothing here, or anywhere in code, classifies that.
 *
 * Pure: the editor that writes it under the row lock is `src/cli/commands/talk/relayOfferAttach.ts`.
 */
import type { RelayOffer } from "./relayOffer.js";

/**
 * What opens every relay-offer section, before the anchor — what tells a row that carries one from one that does not.
 * Exported for the relay-words guard, which reads the section back off a row (`../admit/relayWordsProjection.ts`).
 */
export const RELAY_OFFER_START_PREFIX = "<!-- relay-offer:start ";

/** The heading the row's closing section carries, which the offer section is placed before. */
const HOW_THIS_ENDS = "\n## How this ends\n";

/** The shortest fence CommonMark allows. */
const MIN_FENCE = 3;

/**
 * A fence that no run of backticks in the content can close: one longer than the longest run, and never under three.
 *
 * @param content the text the fence will hold
 * @returns the fence, all backticks
 */
function fenceFor({ content }: { content: string }): string {
  let longest = 0;
  for (const run of content.matchAll(/`+/gu)) {
    longest = Math.max(longest, run[0].length);
  }
  return "`".repeat(Math.max(MIN_FENCE, longest + 1));
}

/**
 * One part of the offer as a fenced block, its name above it.
 *
 * @param name what the part is, as the row reads it
 * @param content the part, byte for byte
 * @returns the block's lines
 */
function fencedPart({ name, content }: { name: string; content: string }): string[] {
  const fence = fenceFor({ content });
  return [`${name}:`, "", `${fence}text`, content, fence, ""];
}

/**
 * The section's exact text, markers included, ending in a newline.
 *
 * @internal Reached from outside only by its test, which pins the rendering byte for byte.
 * @param anchor the row's `talk:<turnId>` anchor, named in both markers
 * @param offered the offer, every field of it
 * @returns the section
 */
export function relayOfferSection({ anchor, offered }: { anchor: string; offered: RelayOffer }): string {
  const lines = [
    `${RELAY_OFFER_START_PREFIX}${anchor} -->`,
    "## Running-list offer the owner reacted to",
    "",
    `The voice's draft it put on the owner's running list before they gave this steer, exactly as offered (\`${offered.id}\`). ` +
      "It is not the owner's words: their quoted words above say whether they approved, rejected or amended it.",
    "",
  ];
  if (offered.label !== undefined) {
    lines.push(...fencedPart({ content: offered.label, name: "Label" }));
  }
  lines.push(...fencedPart({ content: offered.text, name: "Shown at once" }));
  if (offered.belowFold !== undefined) {
    lines.push(...fencedPart({ content: offered.belowFold, name: "Below the fold" }));
  }
  lines.push(`<!-- relay-offer:end ${anchor} -->`);
  return `${lines.join("\n")}\n`;
}

/**
 * Whether a row carries this exact offer section, none, or another one: a section a retry would otherwise sit
 * beside, so it is a conflict rather than a second copy.
 *
 * @param row the row file's text
 * @param anchor the row's anchor
 * @param offered the offer this relay carries
 * @returns `matching` when the exact section is there, `conflicting` when a relay-offer section is there and is not
 *   this one, `absent` when none is
 */
export function relayOfferSectionState({
  row,
  anchor,
  offered,
}: {
  row: string;
  anchor: string;
  offered: RelayOffer;
}): "absent" | "matching" | "conflicting" {
  if (row.includes(`\n${relayOfferSection({ anchor, offered })}`)) {
    return "matching";
  }
  // A section is a marker LINE, never the marker's text: the owner's quoted words are one line opening with the row's words heading, so a
  // transcript that says `<!-- relay-offer:start` cannot read as a section and stall a crashed run's retry.
  if (row.split("\n").some((line) => line.startsWith(RELAY_OFFER_START_PREFIX) && line.endsWith(" -->"))) {
    return "conflicting";
  }
  return "absent";
}

/**
 * The row with the offer section placed before its closing `## How this ends`, or `undefined` when the row has none
 * to place it before — a row this verb did not write the way `handover register` does.
 *
 * @param row the row file's text, carrying no relay-offer section
 * @param anchor the row's anchor
 * @param offered the offer to carry
 * @returns the new row text, or `undefined`
 */
export function rowWithRelayOffer({
  row,
  anchor,
  offered,
}: {
  row: string;
  anchor: string;
  offered: RelayOffer;
}): string | undefined {
  const at = row.lastIndexOf(HOW_THIS_ENDS);
  if (at === -1) {
    return undefined;
  }
  // Its own blank line after it, so the closing heading stays a paragraph apart.
  return `${row.slice(0, at + 1)}${relayOfferSection({ anchor, offered })}\n${row.slice(at + 1)}`;
}
