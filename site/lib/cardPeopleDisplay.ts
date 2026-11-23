/**
 * How a Queue card names a person, in its sentences and in its properties. A citation chip on every person inline
 * is visually overwhelming, so identity chips live in ONE place, the properties, as who this message tags and who is
 * in the thread; everywhere else a person is a first name with no chip, the full name only where two people share
 * one. And the owner is never a chip or a name at all: anything put in front of them implicitly involves them, so
 * the card says you.
 *
 * The rule asks for the whole name where two people ON THE CARD share a first name. Whether one is shared is judged
 * here across the whole workspace by member bronze (`firstNameUnique`), which covers every such card — two people a
 * card names who share a first name share it in the workspace too — and draws a whole name on some cards that would
 * not need one. Counting per card needs every name a card's sentences match before any is drawn, which no one
 * place holds today.
 *
 * Pure: a roster entry in, words out.
 */
import type { InlineSegment } from "./inlineCitationsReferences";
import type { CardPeople, CardPerson } from "./personMentions";

/**
 * What a sentence on a card calls one person: "you" for the owner, their first name when no other colleague shares it,
 * else their whole name; `fallback` when the roster does not hold them.
 *
 * @param person the roster's entry, when it holds one
 * @param fallback what the sentence already called them — a mention's own label, or the id
 * @returns the words drawn
 */
export function inlinePersonName({ person, fallback }: { person: CardPerson | undefined; fallback: string }): string {
  if (person === undefined) {
    return fallback;
  }
  if (person.self) {
    return "you";
  }
  const name = person.name?.trim();
  if (name === undefined || name.length === 0) {
    return fallback;
  }
  // The name is trimmed, so everything before its first space is its first word — a string under either tsconfig.
  const first = name.replace(/\s.*$/su, "");
  if (person.firstNameUnique === true) {
    return first;
  }
  return name;
}

/** A verb that follows a name and agrees with it, and the form it takes after "you". */
const AGREES: Readonly<Record<string, string>> = { does: "do", has: "have", is: "are", was: "were" };

/** What follows the owner's name: a possessive `'s`, or one of {@link AGREES}' verbs, as its own word. */
const AFTER_PERSON = /^(?:(?<possessive>['’]s)(?![\p{L}\p{N}])|(?<space>\s+)(?<verb>is|was|has|does)(?![\p{L}\p{N}]))/u;

/** Where a sentence starts: nothing before it, or the end of the one before it. */
const SENTENCE_END = /(?:^|[.!?]\s+)$/u;

/**
 * A sentence's pieces with every person drawn as words rather than a chip — {@link inlinePersonName} — and the owner as
 * "you": "the owner's" reads "your", "the owner is" reads "you are", and either opening a sentence is capitalised. Adjacent
 * words are joined into one piece, so folding a chip back changes nothing a reader can select.
 *
 * @param segments a sentence's pieces, as `inlineSegments` split it
 * @param people the roster the card resolves against
 * @returns the pieces, with no person piece left
 */
export function personWords({
  segments,
  people,
}: {
  segments: readonly InlineSegment[];
  people: CardPeople;
}): readonly InlineSegment[] {
  const out: InlineSegment[] = [];
  const append = (text: string): void => {
    const last = out.at(-1);
    if (last?.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + text };
    } else if (text.length > 0) {
      out.push({ kind: "text", text });
    }
  };
  let carry = "";
  for (const [at, segment] of segments.entries()) {
    if (segment.kind === "text") {
      append(segment.text.slice(carry.length));
      carry = "";
      continue;
    }
    if (segment.kind !== "person") {
      out.push(segment);
      continue;
    }
    const person = people.get(segment.id);
    if (person?.self !== true) {
      append(inlinePersonName({ fallback: segment.label, person }));
      continue;
    }
    const before = out.at(-1);
    const opens = before === undefined || (before.kind === "text" && SENTENCE_END.test(before.text));
    const next = segments.at(at + 1);
    const after = next?.kind === "text" ? AFTER_PERSON.exec(next.text) : null;
    let words = "you";
    if (after?.groups?.["possessive"] !== undefined) {
      words = "your";
      carry = after[0];
    } else if (after?.groups?.["verb"] !== undefined) {
      words = `you${after.groups["space"]}${AGREES[after.groups["verb"]]}`;
      carry = after[0];
    }
    if (opens) {
      words = words.charAt(0).toUpperCase() + words.slice(1);
    }
    append(words);
  }
  return out;
}

/** The people one property names, each once, the owner left out, and the ids the roster could not name. */
export interface PropertyPeople {
  readonly people: readonly CardPerson[];
  readonly unresolved: readonly string[];
}

/**
 * The people a property lists — who a message tags, who is in its thread — in the order given, each once, and never
 * the owner. An id the roster does not hold is returned as unresolved rather than drawn under a guessed name.
 *
 * @param ids Slack member ids, in the order the record gives them
 * @param people the roster the card resolves against
 * @returns the people to chip, and the ids no roster entry names
 */
export function propertyPeople({ ids, people }: { ids: readonly string[]; people: CardPeople }): PropertyPeople {
  const found: CardPerson[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const person = people.get(id);
    if (person === undefined) {
      unresolved.push(id);
    } else if (!person.self) {
      found.push(person);
    }
  }
  return { people: found, unresolved };
}
