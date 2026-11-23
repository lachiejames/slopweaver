/**
 * A message as the owner that names a colleague in its prose without tagging them is HELD at record time, naming the
 * tag to use.
 *
 * A queue card draws one name as an identity chip and another as plain words, so a gate belongs on Slack messages
 * whose written name is no exact match for a person it could have chipped. A tag is the one spelling Slack and the
 * owner's queue card both resolve to a person, and the one that tells the person they were named.
 *
 * ## Which words are a colleague's name
 *
 * The spellings the queue card itself chips (`site/lib/personMentions.ts`' `nameSpellings`): a whole name of two
 * words or more when it is theirs alone (`nameUnique`), and a first name when no other current person goes by it
 * (`firstNameUnique`), both judged across the whole workspace by `../../corpus/members/slackPeople.ts`. A spelling two
 * people would share names neither. Bounded exactly as the card bounds a chip, so `acme-bot`, `@sophie` and
 * `jonah.smith` name nobody, while `rosa's` names Rosa.
 *
 * **Matched in any case, unlike the card.** The owner's voice is lowercase: MEASURED, every colleague the parked
 * drafts named untagged was written lowercase (`jonah`, `rosa`, `jasper`, `quinn`), `slopweaver slack draft list --all
 * --json | jq -r '.items[].draft.payload.text' | grep -oiE '\b(jonah|rosa|jasper|quinn)\b' | sort | uniq -c`. As
 * written, a gate on `Jonah` would pass all of them. The trade is stated rather than hidden: a unique first name that
 * is also a word (`ray`, `rob`, `ken`, `jay`, `amber`, `violet` on this install) is held too, and reworded.
 *
 * ## Who is never held
 *
 * A person the same message tags (naming them again beside the tag is resolved), the author, and the other member of
 * a 1:1 DM, whom the conversation itself already names.
 *
 * ## No hatch, and the refusal says so
 *
 * Tagging them, or not naming them, is always available, so an override would only ever let an unresolvable name
 * through — the thing the gate exists to stop.
 */

import type { SlackPerson } from "../../corpus/members/slackPeople.js";

/** One colleague named in prose without a tag. */
export interface UntaggedName {
  /** Where in the form the words sit, as the voice rules name a region (`messages[0].runs[1]`). */
  readonly path: string;
  /** The words exactly as written. */
  readonly written: string;
  /** Who they name. */
  readonly nativeId: string;
  readonly name: string;
}

/** A region of authored prose, as `voiceProseOf` yields one. */
interface ProseRegion {
  readonly path: string;
  readonly text: string;
}

/**
 * The spellings a person's name goes by in prose, lowercased — the card's own ({@link untaggedNameFindings}).
 *
 * @returns the whole name when theirs alone and two words or more, and the first name when theirs alone
 */
function spellingsOf({ person }: { person: SlackPerson }): readonly string[] {
  const name = person.name?.trim().toLowerCase();
  if (person.bot || name === undefined || name.length === 0) {
    return [];
  }
  const spellings: string[] = [];
  const first = name.split(/\s+/u).at(0);
  if (first !== name && person.nameUnique) {
    spellings.push(name);
  }
  if (person.firstNameUnique && first !== undefined) {
    spellings.push(first);
  }
  return spellings;
}

/** `text` with every regular-expression metacharacter escaped, so a name matches as written. */
function escaped({ text }: { text: string }): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Every spelling exactly one person goes by, mapped to them, and one pattern matching any of them longest first.
 *
 * @param people the workspace roster
 * @returns the pattern (absent when nobody has a spelling) and who each lowercased spelling names
 */
function namePattern({ people }: { people: readonly SlackPerson[] }): {
  readonly pattern: RegExp | undefined;
  readonly owners: ReadonlyMap<string, SlackPerson>;
} {
  const claims = new Map<string, SlackPerson[]>();
  for (const person of people) {
    for (const spelling of spellingsOf({ person })) {
      const claimants = claims.get(spelling);
      if (claimants === undefined) {
        claims.set(spelling, [person]);
      } else if (!claimants.some((claimant) => claimant.nativeId === person.nativeId)) {
        claimants.push(person);
      }
    }
  }
  const owners = new Map<string, SlackPerson>();
  for (const [spelling, claimants] of claims) {
    const [only] = claimants;
    if (claimants.length === 1 && only !== undefined) {
      owners.set(spelling, only);
    }
  }
  if (owners.size === 0) {
    return { owners, pattern: undefined };
  }
  const alternatives = [...owners.keys()]
    .toSorted((a, b) => b.length - a.length)
    .map((spelling) => escaped({ text: spelling }))
    .join("|");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}_@/.-])(?:${alternatives})(?![\\p{L}\\p{M}\\p{N}_@/-]|\\.[\\p{L}\\p{N}_])`,
    "giu",
  );
  return { owners, pattern };
}

/**
 * Every colleague the prose names without a tag, in the order written — one finding per place a name appears.
 *
 * @param prose the authored regions of the message, mentions and code already left out
 * @param people the workspace roster, each person's uniqueness judged across the whole workspace
 * @param tagged the member ids the same message tags
 * @param exempt the author, and a 1:1 DM's other member
 * @returns the findings, empty when every name the prose uses is tagged
 */
export function untaggedNameFindings({
  prose,
  people,
  tagged,
  exempt,
}: {
  prose: readonly ProseRegion[];
  people: readonly SlackPerson[];
  tagged: ReadonlySet<string>;
  exempt: ReadonlySet<string>;
}): readonly UntaggedName[] {
  const { owners, pattern } = namePattern({ people });
  if (pattern === undefined) {
    return [];
  }
  const findings: UntaggedName[] = [];
  for (const region of prose) {
    for (const match of region.text.matchAll(pattern)) {
      const person = owners.get(match[0].toLowerCase());
      if (person === undefined || tagged.has(person.nativeId) || exempt.has(person.nativeId)) {
        continue;
      }
      findings.push({ name: person.name!, nativeId: person.nativeId, path: region.path, written: match[0] });
    }
  }
  return findings;
}

/** A Slack wire mention, `<@U…>` or `<@U…|label>`. */
const WIRE_MENTION = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/gu;

/**
 * The member ids a rendered message tags, read off its wire text.
 *
 * @param text the message's `text` as it would be posted
 * @returns the ids, once each
 */
export function taggedIdsOf({ text }: { text: string }): ReadonlySet<string> {
  return new Set([...text.matchAll(WIRE_MENTION)].map((match) => match[1]!));
}

/**
 * The hold's lines for the findings — empty when there are none, so a caller asks unconditionally. The recorder adds
 * the line saying nothing was parked, as every one of its refusals does.
 *
 * @param findings what {@link untaggedNameFindings} found
 * @returns the refusal lines
 */
export function untaggedNameRefusal({ findings }: { findings: readonly UntaggedName[] }): readonly string[] {
  if (findings.length === 0) {
    return [];
  }
  return [
    "slack draft record: REFUSING to park a message as the owner that names a colleague without tagging them — Slack " +
      "and the owner's queue card can resolve only a tag to a person.",
    ...findings.map(
      ({ written, nativeId, name, path }) =>
        `  "${written}" at ${path} is ${name} (${nativeId}): put {"type":"mention","person":"${nativeId}"} where ` +
        "the name is, or reword so it names nobody the message does not tag.",
    ),
    "There is deliberately NO escape hatch: tagging them, or not naming them, is always available.",
  ];
}
