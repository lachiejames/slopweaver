/**
 * Whether a channel name is one Slack will store UNCHANGED, and the canonical form when it is not. Pure.
 *
 * ## Why this refuses rather than normalises
 *
 * Slack does not reject a malformed channel name — it silently transforms it. `Design Review` becomes
 * `design-review`, a trailing period is dropped, and anything past 80 characters is cut. So a create verb
 * that simply forwarded what it was given would report a name the workspace does not have, and every
 * downstream reference an author then wrote — a doc line, a Slack message, a board row — would point at a
 * channel that is not there under that name.
 *
 * Minting a channel is also irreversible in the way that matters: Slack cannot delete one, only archive it
 * (see `../../corpus/slack/writeApiConversations.ts`'s own note). So the cost of guessing wrong is a
 * permanent artefact in a real workspace, which is exactly where this repo's rule is to refuse and NAME the
 * fix rather than proceed on a normalisation nobody saw.
 *
 * ## The rule, from Slack's own constraint rather than from taste
 *
 * A name Slack stores unchanged is: lowercase; only letters, digits, hyphen and underscore; 1 to 80
 * characters. Slack's documented set is broader than ASCII — non-Latin letters are accepted — so the test
 * here is built from Unicode properties rather than `[a-z0-9_-]`, which would refuse a legitimate name in
 * a workspace that does not write in English.
 */

/** A channel name Slack will store unchanged may be at most this long. Slack's own documented cap. */
export const SLACK_CHANNEL_NAME_MAX = 80;

/** Every character a stored-unchanged channel name may contain: a letter, a digit, a hyphen or an underscore. */
const ALLOWED_CHARACTER = /[\p{Letter}\p{Number}_-]/u;

/** What a proposed channel name is: already canonical, fixable, or nothing Slack could name at all. */
export type ChannelNameVerdict =
  | { readonly kind: "canonical"; readonly name: string }
  | { readonly kind: "not-canonical"; readonly canonical: string; readonly why: readonly string[] }
  | { readonly kind: "unusable"; readonly why: readonly string[] };

/**
 * The canonical form of a proposed name — lowercased, every disallowed run collapsed to one hyphen, and
 * trimmed of leading and trailing hyphens before the length cap is applied.
 *
 * Trimming happens BEFORE the cut and again after it, and both matter: `--x` would otherwise canonicalise
 * to a name opening with a hyphen, and an 81-character name cut at 80 can land the cut mid-hyphen-run and
 * leave a trailing one. Either would be a "canonical" answer this module's own test would then reject.
 *
 * @param proposed the name as the author wrote it
 * @returns the name Slack would store
 */
export function canonicalChannelName({ proposed }: { proposed: string }): string {
  let collapsed = "";
  for (const character of proposed.toLowerCase()) {
    if (ALLOWED_CHARACTER.test(character)) {
      collapsed += character;
    } else if (!collapsed.endsWith("-")) {
      collapsed += "-";
    }
  }
  return trimHyphens({ value: trimHyphens({ value: collapsed }).slice(0, SLACK_CHANNEL_NAME_MAX) });
}

/**
 * One value with every leading and trailing hyphen removed.
 *
 * @param value the value to trim
 * @returns the trimmed value, empty when it was nothing but hyphens
 */
function trimHyphens({ value }: { value: string }): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "-") {
    start += 1;
  }
  while (end > start && value[end - 1] === "-") {
    end -= 1;
  }
  return value.slice(start, end);
}

/**
 * Every way a proposed name differs from what Slack would store, named individually.
 *
 * Named individually rather than as one "invalid name" because the fixes are different — an author who
 * typed a capital wants to know that, and one who wrote 90 characters wants to know the other thing. A
 * single message covering both teaches neither.
 *
 * @param proposed the name as the author wrote it
 * @returns one line per difference, empty when there is none
 */
export function channelNameDifferences({ proposed }: { proposed: string }): readonly string[] {
  const why: string[] = [];
  if (proposed !== proposed.toLowerCase()) {
    why.push("Slack stores a channel name in lower case, and this one carries capitals");
  }
  const disallowed = [...new Set(Array.from(proposed).filter((character) => !ALLOWED_CHARACTER.test(character)))];
  if (disallowed.length > 0) {
    why.push(
      `a channel name holds only letters, digits, hyphens and underscores — Slack would replace ` +
        `${disallowed.map((character) => JSON.stringify(character)).join(", ")}`,
    );
  }
  // `Array.from` rather than `.length`, and rather than spreading: the count has to be CHARACTERS as a
  // reader sees them, so a name carrying an emoji is not reported as twice its apparent length. Spread
  // reads identically and is refused by `no-misused-spread`.
  const characters = Array.from(proposed).length;
  if (characters > SLACK_CHANNEL_NAME_MAX) {
    why.push(
      `Slack cuts a channel name at ${String(SLACK_CHANNEL_NAME_MAX)} characters, and this one is ` +
        `${String(characters)}`,
    );
  }
  return why;
}

/**
 * Judge one proposed channel name.
 *
 * `unusable` is a real third arm rather than a degenerate `not-canonical`: a name of nothing but spaces and
 * punctuation canonicalises to the EMPTY string, and answering "did you mean ``?" would be a refusal that
 * names no fix at all.
 *
 * @param proposed the name as the author wrote it
 * @returns whether Slack would store it unchanged, and the canonical form when it would not
 */
export function judgeChannelName({ proposed }: { proposed: string }): ChannelNameVerdict {
  const canonical = canonicalChannelName({ proposed });
  if (canonical.length === 0) {
    return {
      kind: "unusable",
      why: [
        `${JSON.stringify(proposed)} carries no letter, digit or underscore, so there is no channel name ` +
          "Slack could make of it",
      ],
    };
  }
  if (canonical === proposed) {
    return { kind: "canonical", name: canonical };
  }
  return { canonical, kind: "not-canonical", why: channelNameDifferences({ proposed }) };
}

/**
 * The refusal lines for a name Slack would not store unchanged, or empty when it would.
 *
 * @param verdict what {@link judgeChannelName} concluded
 * @returns the lines to print, ending in the exact name to re-run with; empty for a canonical verdict
 */
export function channelNameRefusals({ verdict }: { verdict: ChannelNameVerdict }): readonly string[] {
  if (verdict.kind === "canonical") {
    return [];
  }
  if (verdict.kind === "unusable") {
    return [`REFUSING to create a channel: ${verdict.why[0] ?? "that name is unusable"}. Nothing was created.`];
  }
  return [
    "REFUSING to create a channel under a name Slack would silently change, because a channel cannot be " +
      "deleted afterwards — only archived:",
    ...verdict.why.map((line) => `  - ${line}`),
    `  re-run with --name ${verdict.canonical}`,
  ];
}
