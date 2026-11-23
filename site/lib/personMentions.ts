/**
 * The people a card's sentences name, drawn as identity chips rather than Slack member ids (a card's What section
 * once printed five `<@U…>` ids), because a name helps the owner remember more than a user id does. The chip's hover card shows the person's profile picture, name and
 * position at the company, and the workstreams they relate to for the owner.
 *
 * Every field is derived. The name, handle, picture, role and first-name uniqueness are member bronze's, read by the
 * verb that printed the roster (`slack draft list --json`); the workstreams are the board's own `workstream=` tags on
 * the open rows whose words name the person. An id no roster names is never given a name: it stays as written, and a
 * bare `<@U…>` is reported as a mention with no target, the drawer's citation finding. A name the roster holds
 * uniquely is that person's chip too, by the same spellings the workstream match reads.
 *
 * Pure: a sentence, a roster and a board in; pieces out.
 */
import type { BoardRow } from "../components/live/read";
import type { InlineSegment } from "./inlineCitationsReferences";
import { mentionKey, type UnlinkedMention } from "./referenceSpellings";
import type { SlackPeople, SlackPersonName } from "./slackPeople";
import { isOpen } from "./workstreams";

/** One of the owner's workstreams a person's open rows sit in, with the rows that name them — each a board slug. */
export interface PersonWorkstream {
  readonly name: string;
  readonly rows: readonly string[];
}

/** One person a card can chip: the roster's facts, and the owner's workstreams whose open rows name them. */
export interface CardPerson extends SlackPersonName {
  readonly id: string;
  readonly workstreams: readonly PersonWorkstream[];
  /**
   * Whether this is the owner. A card names the owner "you" and never chips them, since anything put in front of
   * the owner implicitly involves them.
   */
  readonly self: boolean;
}

/** Every person a card can chip, by Slack member id. */
export type CardPeople = ReadonlyMap<string, CardPerson>;

/** No people — what a card outside the queue, or before the drafts read, resolves against. */
export const NO_CARD_PEOPLE: CardPeople = new Map();

/** One piece of a sentence after the people in it are found: words, or a person by id and the name drawn. */
export type PersonPiece =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "person"; readonly id: string; readonly label: string };

/**
 * A Slack mention, `<@U…>` or `<@U…|label>`, or a bare member id standing as its own word. A bare id must carry a
 * digit, so `UNKNOWN` or `WORKFLOW` stays a word; it becomes a chip only when the roster names it.
 */
const MENTION =
  /<@(?<id>[UW][A-Z0-9]{2,})(?:\|(?<label>[^>]*))?>|(?<![\p{L}\p{N}_@/.:-])(?<bare>[UW](?=[A-Z0-9]*\d)[A-Z0-9]{7,})(?![\p{L}\p{N}_-])/gu;

/**
 * The name the roster holds for `id`, trimmed, when it holds one.
 *
 * @returns the name, or nothing
 */
function nameFor({ id, people }: { id: string; people: CardPeople }): string | undefined {
  const name = people.get(id)?.name?.trim();
  if (name === undefined || name.length === 0) {
    return undefined;
  }
  return name;
}

/**
 * Split a sentence at every person it names: a mention or bare id the roster knows is a person piece drawn by name;
 * a labelled mention it does not know reads as its own `@label`; an unlabelled one stays as written and is reported,
 * because a `<@U…>` is always a person — it just names nobody this card can say.
 *
 * @param text the card's own sentence
 * @param people who the card can name
 * @returns the pieces in order, and each mention that names nobody the roster holds
 */
export function personPieces({ text, people }: { text: string; people: CardPeople }): {
  readonly pieces: readonly PersonPiece[];
  readonly unlinked: readonly UnlinkedMention[];
} {
  const pieces: PersonPiece[] = [];
  const unlinked: UnlinkedMention[] = [];
  let at = 0;
  for (const match of text.matchAll(MENTION)) {
    const groups: Readonly<Record<string, string | undefined>> = { ...match.groups };
    const id = groups["id"] ?? groups["bare"];
    if (id === undefined) {
      continue;
    }
    const name = nameFor({ id, people });
    let piece: PersonPiece | undefined;
    if (name !== undefined) {
      piece = { id, kind: "person", label: name };
    } else if (groups["label"] !== undefined && groups["label"].trim().length > 0) {
      piece = { kind: "text", text: `@${groups["label"].trim().replace(/^@/u, "")}` };
    } else if (groups["id"] !== undefined && !unlinked.some((seen) => seen.label === id)) {
      unlinked.push({ kind: "slack", label: id });
    }
    if (piece === undefined) {
      continue;
    }
    if (match.index > at) {
      pieces.push({ kind: "text", text: text.slice(at, match.index) });
    }
    pieces.push(piece);
    at = match.index + match[0].length;
  }
  if (at < text.length) {
    pieces.push({ kind: "text", text: text.slice(at) });
  }
  return { pieces, unlinked };
}

/** What resolving a stretch of words answers: its pieces, and each reference in it that cites nothing. */
interface Resolution {
  readonly segments: readonly InlineSegment[];
  readonly unlinked: readonly UnlinkedMention[];
}

/**
 * A sentence's people drawn as person segments, and every stretch of words between them handed to `resolve` for the
 * records it cites. Adjacent words are merged and a finding reported twice is kept once. A sentence naming nobody the
 * roster knows is resolved as one stretch — joined from its pieces, so an unknown mention still reads as its own
 * `@label`.
 *
 * @param people who the card can name
 * @param resolve the address resolver, over one stretch of words
 * @returns the segments in order, and every unresolved spelling, the people's first
 */
export function resolveAroundPeople({
  text,
  people,
  resolve,
}: {
  text: string;
  people: CardPeople;
  resolve: (stretch: { words: string }) => Resolution;
}): Resolution {
  const resolution = resolveMentions({ people, resolve, text });
  return { segments: withNames({ people, segments: resolution.segments }), unlinked: resolution.unlinked };
}

/**
 * {@link resolveAroundPeople} before the names: every mention or bare id as a person, and the records each stretch
 * between them cites.
 *
 * @returns the segments and every unresolved spelling
 */
function resolveMentions({
  text,
  people,
  resolve,
}: {
  text: string;
  people: CardPeople;
  resolve: (stretch: { words: string }) => Resolution;
}): Resolution {
  const found = personPieces({ people, text });
  const words = found.pieces.flatMap((piece) => (piece.kind === "text" ? [piece.text] : []));
  if (words.length === found.pieces.length) {
    const whole = resolve({ words: words.join("") });
    return { segments: whole.segments, unlinked: [...found.unlinked, ...whole.unlinked] };
  }
  const segments: InlineSegment[] = [];
  const unlinked: UnlinkedMention[] = [...found.unlinked];
  for (const piece of found.pieces) {
    let part: Resolution = { segments: [piece], unlinked: [] };
    if (piece.kind === "text") {
      part = resolve({ words: piece.text });
    }
    for (const segment of part.segments) {
      const last = segments.at(-1);
      if (segment.kind === "text" && last?.kind === "text") {
        segments[segments.length - 1] = { kind: "text", text: last.text + segment.text };
      } else {
        segments.push(segment);
      }
    }
    for (const mention of part.unlinked) {
      if (!unlinked.some((seen) => mentionKey({ mention: seen }) === mentionKey({ mention }))) {
        unlinked.push(mention);
      }
    }
  }
  return { segments, unlinked };
}

/** `text` with every regular-expression metacharacter escaped, so a name matches as written. */
function escaped({ text }: { text: string }): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * A pattern matching `word` whole: never inside a longer word, nor ahead of a `.word` — `@rosa` is not a spelling
 * of `@rosa.lindqvist`.
 */
function wholeWord({ word, flags }: { word: string; flags: string }): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_.])${escaped({ text: word })}(?![\\p{L}\\p{N}_]|\\.[\\p{L}\\p{N}_])`, flags);
}

/**
 * The words a person's name goes by in prose, longest first: the whole name when it is two words or more and
 * `nameUnique` ("Joseph O" is inside "Joseph O'Hara"), and the first name alone only when no other current member
 * goes by it. A one-word name is a first name: four Kyles, and "Kyle" is evidence of none of them. As written, so
 * "heap max" is not Max; a sentence opening on "Will" still is, and a hover says who it resolved to. A bot is
 * neither unique by construction (`src/corpus/members/slackPeople.ts` counts current humans), so it has none.
 *
 * @returns the spellings, the whole name first
 */
function nameSpellings({ person }: { person: SlackPersonName }): readonly string[] {
  const name = person.name?.trim();
  if (name === undefined || name.length === 0) {
    return [];
  }
  const spellings: string[] = [];
  const first = name.split(/\s+/u).at(0);
  if (first !== name && person.nameUnique === true) {
    spellings.push(name);
  }
  if (person.firstNameUnique === true && first !== undefined) {
    spellings.push(first);
  }
  return spellings;
}

/**
 * The spellings a row naming this person would use: their id and `@handle` in any case, and their name as a proper
 * noun ({@link nameSpellings}), the hover listing the row that matched.
 *
 * @returns word-bounded patterns
 */
function spellingsOf({ id, person }: { id: string; person: SlackPersonName }): readonly RegExp[] {
  const spellings = [wholeWord({ flags: "iu", word: id })];
  if (person.handle !== undefined && person.handle.length > 0) {
    spellings.push(wholeWord({ flags: "iu", word: `@${person.handle}` }));
  }
  for (const word of nameSpellings({ person })) {
    spellings.push(wholeWord({ flags: "u", word }));
  }
  return spellings;
}

/**
 * Every name spelling the people go by, as ONE pattern, longest first so "Tobias Wren" is one chip rather than
 * "Tobias" then words — or `undefined` when nobody has one. A spelling two people share names neither. Bounded
 * tighter than {@link wholeWord}, because a chip is drawn: never beside a hyphen, a slash or an `@`, so `the bot`
 * and `@Sophie` stay whole, while `Sophie's` chips "Sophie".
 */
const NAME_PATTERNS = new WeakMap<CardPeople, { pattern: RegExp | undefined; ids: ReadonlyMap<string, string> }>();

/**
 * {@link NAME_PATTERNS}' entry for these people, built once per roster.
 *
 * @returns the pattern, and the id each spelling names
 */
function namePattern({ people }: { people: CardPeople }): {
  pattern: RegExp | undefined;
  ids: ReadonlyMap<string, string>;
} {
  const cached = NAME_PATTERNS.get(people);
  if (cached !== undefined) {
    return cached;
  }
  const claims = new Map<string, Set<string>>();
  for (const [id, person] of people) {
    for (const spelling of nameSpellings({ person })) {
      const ids = claims.get(spelling);
      if (ids === undefined) {
        claims.set(spelling, new Set([id]));
      } else {
        ids.add(id);
      }
    }
  }
  const ids = new Map<string, string>();
  for (const [spelling, claimants] of claims) {
    if (claimants.size !== 1) {
      continue;
    }
    for (const only of claimants) {
      ids.set(spelling, only);
    }
  }
  const spellings = [...ids.keys()].toSorted((a, b) => b.length - a.length);
  let pattern: RegExp | undefined;
  if (spellings.length > 0) {
    const alternatives = spellings.map((spelling) => escaped({ text: spelling })).join("|");
    pattern = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}_@/.-])(?:${alternatives})(?![\\p{L}\\p{M}\\p{N}_@/-]|\\.[\\p{L}\\p{N}_])`,
      "gu",
    );
  }
  const entry = { ids, pattern };
  NAME_PATTERNS.set(people, entry);
  return entry;
}

/**
 * The segments with every name a person goes by, in the words left after the records were found, drawn as that
 * person's chip under the words as written — so an address, a Slack link's label or a slug is never cut, and folding
 * the chip back to its label gives the sentence back exactly (the fleet's cards name people, almost never by id, so names must be hoverable).
 *
 * @param segments a sentence's pieces, its records and id mentions already found
 * @param people who the card can name
 * @returns the pieces, each named person's words split out as their chip
 */
function withNames({
  segments,
  people,
}: {
  segments: readonly InlineSegment[];
  people: CardPeople;
}): readonly InlineSegment[] {
  const { pattern, ids } = namePattern({ people });
  if (pattern === undefined) {
    return segments;
  }
  const out: InlineSegment[] = [];
  for (const segment of segments) {
    if (segment.kind !== "text") {
      out.push(segment);
      continue;
    }
    let at = 0;
    for (const match of segment.text.matchAll(pattern)) {
      if (match.index > at) {
        out.push({ kind: "text", text: segment.text.slice(at, match.index) });
      }
      out.push({ id: ids.get(match[0])!, kind: "person", label: match[0] });
      at = match.index + match[0].length;
    }
    if (at < segment.text.length) {
      out.push({ kind: "text", text: segment.text.slice(at) });
    }
  }
  return out;
}

/** What a board row says in words — the fields a relayed ask names a person in. */
function rowWords({ row }: { row: BoardRow }): string {
  const fields = [row.reason, row.question, row.summary, row.problem, row.lean, row.pausedOn];
  return fields.filter((field): field is string => field !== undefined).join("\n");
}

/**
 * The owner's workstreams whose OPEN rows name this person, each with the rows that do, in board order — the hover card's
 * "your workstreams naming them". Membership is the row's own `workstream=` tag, never a list kept anywhere.
 *
 * @param id the person's Slack member id
 * @param person what the roster holds for them
 * @param board every board row
 * @returns the streams, each with its naming rows
 */
export function personWorkstreams({
  id,
  person,
  board,
}: {
  id: string;
  person: SlackPersonName;
  board: readonly BoardRow[];
}): readonly PersonWorkstream[] {
  const spellings = spellingsOf({ id, person });
  const streams = new Map<string, string[]>();
  for (const row of board) {
    if (!isOpen({ row })) {
      continue;
    }
    const words = rowWords({ row });
    if (!spellings.some((spelling) => spelling.test(words))) {
      continue;
    }
    for (const tag of row.tags) {
      if (tag.key !== "workstream") {
        continue;
      }
      const rows = streams.get(tag.value);
      if (rows === undefined) {
        streams.set(tag.value, [row.slug]);
      } else if (!rows.includes(row.slug)) {
        rows.push(row.slug);
      }
    }
  }
  return [...streams].map(([name, rows]) => ({ name, rows }));
}

/**
 * Every person the roster names, with the owner's workstreams that name them, and which of them is the owner. The owner's own workstreams
 * are left off their entry: they are on every one of their own rows, so they would list them all and say nothing.
 *
 * @param roster who each member id is, off the drafts reading
 * @param board every board row
 * @param owner the owner's own Slack member id, when a reading said it
 * @returns the people, by id
 */
export function cardPeople({
  roster,
  board,
  owner,
}: {
  roster: SlackPeople;
  board: readonly BoardRow[];
  owner: string | undefined;
}): CardPeople {
  const out = new Map<string, CardPerson>();
  for (const [id, person] of roster) {
    let workstreams: readonly PersonWorkstream[] = [];
    if (id !== owner) {
      workstreams = personWorkstreams({ board, id, person });
    }
    out.set(id, { ...person, id, self: id === owner, workstreams });
  }
  return out;
}
