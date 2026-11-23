/**
 * Whether a Slack-anchored row's prose names the person who actually posted the message its anchor links.
 *
 * The failure it closes: a review card's link was right — it opened one person's own review ask — but the registering
 * session had read another person's name out of an older reference and a Linear unfurl's assignee in that message and
 * written that person as the asker, and nothing compared that name with who posted. So the link read as unrelated to
 * the card it sat on.
 *
 * So a text — the summary, or one example scene — that says some Slack person asked, tagged or posted must name the
 * anchored message's author somewhere. One naming ONLY other people is the failure; one naming the author in any
 * shape — "Kieran asked", "Kieran's PR", "@kieran.mendez" — beside someone else's separate act ("it supersedes the
 * fix Theo raised earlier") is not. A thread participant who did not post the anchored message does not stand in
 * for the author: the card's link must be the message its first line quotes, so the fix there is to anchor THEIR
 * message.
 *
 * Pure: texts and people in, mismatches out.
 */
import type { DerivedPerson } from "../silver/derivedRoster.js";
import type { PersonIdentity } from "../silver/identity.js";

/**
 * Verbs that attribute a post to whoever the one or two capitalised words before them name — `Theo asked`,
 * `Theo Marsh asked`, and `Yesterday Theo asked`, where only the second word is a person. The words sit on one line:
 * a name ending one line and a verb opening the next are two sentences.
 */
const ATTRIBUTION =
  /(?<![\p{L}\p{N}])(\p{Lu}\p{Ll}+)(?:[^\S\n]+(\p{Lu}\p{Ll}+))?[^\S\n]+(asked|tagged|pinged|posted|wrote|said|requested|raised|messaged|flagged|shared|mentioned)\b/gu;

/** A double-quoted span — words reported, not a claim of who posted. */
const QUOTED = /"[^"\n]*"|“[^”\n]*”/gu;

/**
 * One word of a text or a name, split the same way on both sides so a name always matches how a sentence spells it —
 * `Kieran's`, `@kieran.mendez`, `<@U0SYN000014>`, `Dr. Lauren Mac Arthur`, `Reynold(US)`, `@h2009210`.
 */
const WORD = /[\p{L}\p{N}]+/gu;

/** Whitespace inside a label: a display name with a space spells a person; one without is a login, handle or email. */
const SPACED = /\s/u;

/** An honorific a name or handle opens on — `Dr Martin Zell`, `dr.martin.zell` — whose given name is the word after it. */
const HONORIFIC: ReadonlySet<string> = new Set(["dr", "mr", "mrs", "ms", "miss", "prof"]);

/** The platform's own name, which the derived roster carries as a Slack user (`Slack`) and is nobody's given name. */
const PLATFORM = "slack";

/** Account kinds the derived roster gives a non-human, whose name before "posted" is never a claim about a person. */
const NOT_A_PERSON: ReadonlySet<string> = new Set(["bot", "integration"]);

/** One "<Name> <attributing verb>" claim in a row's prose. */
export interface AttributionClaim {
  /** The one or two capitalised words before the verb, as written. */
  readonly words: readonly string[];
  /** The attributing verb, as written. */
  readonly verb: string;
}

/** One claim of a row's prose attributing the anchored post to someone other than its author. */
export interface AttributionMismatch {
  /** The given name the prose attributes the post to, as written. */
  readonly name: string;
  /** The attributing verb, as written. */
  readonly verb: string;
}

/**
 * Every "<Name> <attributing verb>" claim in a text — `Theo asked`, `Kieran Mendez tagged`.
 *
 * @param text one sentence or paragraph of a row's prose
 * @returns each claim's capitalised words and verb, in the order they appear
 */
export function attributedNames({ text }: { text: string }): readonly AttributionClaim[] {
  return [...text.replace(QUOTED, " ").matchAll(ATTRIBUTION)].map((match) => {
    const words = [match[1]!];
    if (match[2] !== undefined) {
      words.push(match[2]);
    }
    return { verb: match[3]!, words };
  });
}

/**
 * The words of one display name or handle, lowercased, past every honorific and never the platform's name — split on
 * anything that is not a letter or digit, so `Dr. Lauren Mac Arthur`, `Anna-Marie`, `Reynold(US)` and `kieran.mendez`
 * each yield the words a sentence would spell them with.
 *
 * @param label a display name or a handle
 * @returns its words, in order
 */
function nameWords({ label }: { label: string | undefined }): readonly string[] {
  if (label === undefined) {
    return [];
  }
  return [...label.matchAll(WORD)]
    .map((word) => word[0].toLowerCase())
    .filter((word) => !HONORIFIC.has(word) && word !== PLATFORM);
}

/**
 * The given names one person goes by across their identities: the first word of each display name and of each
 * handle, lowercased, past an honorific.
 *
 * @param identities the person's identities on every source
 * @returns the lowercased given names
 */
export function givenNamesOf({ identities }: { identities: readonly PersonIdentity[] }): ReadonlySet<string> {
  const names = new Set<string>();
  for (const identity of identities) {
    for (const label of [identity.name, identity.handle]) {
      const given = nameWords({ label })[0];
      if (given !== undefined) {
        names.add(given);
      }
    }
  }
  return names;
}

/**
 * Every word a text could name the poster by: each word of a display name with a space in it — a surname alone,
 * `Mendez`, names them as surely as a given name — the first word of any spaceless label, and each native id, so a
 * raw `<@U0SYN000014>` counts. A spaceless label is a handle, a login or an email, even in a name field
 * (`octocat`, `adrian.brooks@acme.com`), and past its first word it spells an org or a domain:
 * "acme", "com" and "au" name nobody.
 *
 * @param identities the poster's identities on every source
 * @returns the lowercased words
 */
export function posterWordsOf({ identities }: { identities: readonly PersonIdentity[] }): ReadonlySet<string> {
  const words = new Set<string>();
  for (const identity of identities) {
    for (const label of [identity.name, identity.handle]) {
      const all = nameWords({ label });
      const spaced = label !== undefined && SPACED.test(label.trim());
      for (const word of spaced ? all : all.slice(0, 1)) {
        words.add(word);
      }
    }
    words.add(identity.nativeId.toLowerCase());
  }
  return words;
}

/**
 * The roster people a Slack message could be attributed to: those with a Slack identity whose account kind is not a
 * bot's or an integration's. A Linear-only `Claude` or a GitHub `renovate` never posted in Slack, so a capitalised
 * "Claude flagged" beside the poster's name is not a claim about who posted.
 *
 * @param people every person on the derived roster
 * @returns the Slack humans among them
 */
export function slackHumans({ people }: { people: readonly DerivedPerson[] }): readonly DerivedPerson[] {
  return people.filter(
    (person) =>
      !(person.kind !== undefined && NOT_A_PERSON.has(person.kind)) &&
      person.identities.some((identity) => identity.source === "slack"),
  );
}

/**
 * The claims in a row's prose that attribute its anchored Slack message to someone other than the person who posted
 * it.
 *
 * Judged one text at a time: a text naming the author ANYWHERE, in any shape — "Kieran asked", "Kieran's PR",
 * "@kieran.mendez", "Mendez", "<@U0SYN000014>" — passes whole, since every claim beside it is someone else's separate act; a text that never
 * names the author returns every person claim in it. A capitalised word that is no Slack human's given name is not a
 * claim about a person — "Platform asked", "Helpbot said" — and is never a mismatch.
 *
 * @param texts the row's summary and its example scenes — never its options, which legitimately name other people
 * @param author every word the poster could be named by (`posterWordsOf`): name words, handle words, native ids
 * @param people the given names of every Slack human on the roster (`slackHumans`)
 * @returns each mismatching claim, in text order
 */
export function attributionMismatches({
  texts,
  author,
  people,
}: {
  texts: readonly string[];
  author: ReadonlySet<string>;
  people: ReadonlySet<string>;
}): readonly AttributionMismatch[] {
  return texts.flatMap((text) => {
    if ([...text.matchAll(WORD)].some((word) => author.has(word[0].toLowerCase()))) {
      return [];
    }
    return attributedNames({ text }).flatMap((claim) => {
      // The first of the words that is somebody's given name is who the claim is about: `Theo` in `Theo Marsh`,
      // `Theo` in `Yesterday Theo`. A claim naming nobody on the roster is not about a person at all.
      const person = claim.words.find((word) => people.has(word.toLowerCase()));
      if (person === undefined) {
        return [];
      }
      return [{ name: person, verb: claim.verb }];
    });
  });
}
