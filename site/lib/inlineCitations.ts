/**
 * How a pull request or a ticket a card's sentence names reads INSIDE that sentence: the reference is the link,
 * and nothing after it.
 *
 * A queue card names a pull request inline: the number in the what text is the hoverable link, a citation at
 * most, never a raw URL in brackets after it and never a chip row at the bottom of the card. The URL has to be IN
 * the recorded question (`handover ask` refuses `#N` without it, `src/handover/cardAlignment.ts`), so the text
 * keeps it and this is where it is folded back into the number it belongs to.
 *
 * Every PR number and ticket number on a card is a citation chip; measured, one card had a chip near the bottom and
 * many other numbers none. A heading can read `Open acme-admin 17564:` — a
 * repository and a number, no `#` — so every spelling a card actually uses is a reference here: `owner/repo#N`,
 * `acme-admin N`, `PR N`, a Linear issue address and its `ABC-123` key. A spelling that is ALSO ordinary
 * prose (`CI 93`, `UTC-5`) links only when an address the row carries names exactly that pull request or ticket;
 * otherwise it stays words.
 *
 * A card's ask can carry no address at all — `Decide 16406`, `its base 16400`, `QQQQ-134` — so there is nothing
 * to resolve against. A {@link CardReferences} supplies what the ROW knows without an address: the repository its
 * numbers belong to, how large that repository's numbers run, and the install's Linear workspace. A number or key
 * no carried address names resolves through those, cited or not.
 *
 * A module rather than logic inside `../components/console/InlineText.tsx` for the reason `./askLinks.ts`
 * gives: the unit lane does not transform `.tsx`. Imports only a type. Pure: a string in, segments out.
 */

import { personWords } from "./cardPeopleDisplay";
import { REFERENCE_SOURCE } from "./inlineCitationsPatterns";
import { type CardReferences, type InlineSegment, NO_CARD_REFERENCES } from "./inlineCitationsReferences";
import { addressesIn, markupApart, prBase, resolvable } from "./inlineCitationsResolve";
import { laterAlternative, resolved } from "./inlineCitationsResolved";
import { oneNumberNotation } from "./numberPhrase";
import { resolveAroundPeople } from "./personMentions";
import {
  mentionKey,
  spelledBeforeAddress,
  type UnlinkedMention,
  unlinkedOf,
  withoutLeadingZeros,
} from "./referenceSpellings";

export { citationTexts, drawnTexts } from "./inlineCitationsCard";
export { ADDRESS_TRAILING } from "./inlineCitationsPatterns";
export type { CardReferences, InlineSegment } from "./inlineCitationsReferences";
export { NO_CARD_REFERENCES } from "./inlineCitationsReferences";
export { addressesIn } from "./inlineCitationsResolve";

/**
 * A pull request spelled just before another one's address, read on its own: its chip and where it sits in the
 * text before that address, or `undefined` when alone it resolves to nothing — which is the unlinked finding.
 *
 * @param before the text between the last reference and the address
 * @param spelled the spelling {@link spelledBeforeAddress} found at its end, as written and as read
 * @param known the addresses the row carries beyond this text
 * @param references what the row knows beyond its addresses
 * @returns the chip and its offsets within `before`, or `undefined`
 */
function spelledChip({
  before,
  spelled,
  known,
  references,
}: {
  before: string;
  spelled: { written: string; read: string };
  known: readonly string[];
  references: CardReferences;
}): { segment: InlineSegment; start: number; end: number } | undefined {
  const end = before.search(/ ?\(?$/u);
  const start = end - spelled.written.length;
  const alone = resolveInline({ known, references, text: spelled.read }).segments;
  const cite = alone.at(-1);
  // `see PR N` reads `see` as prose before its `PR N`, never as a repository: the chip is that tail.
  const lead = alone.length === 2 && alone[0]?.kind === "text" ? alone[0].text : "";
  if (cite?.kind !== "cite" || alone.length > (lead === "" ? 1 : 2) || before.slice(start, end) !== spelled.written) {
    return undefined;
  }
  // A range's far end reads `#N` and is written `N`: the chip carries the words the sentence wrote.
  return {
    end,
    segment: { kind: "cite", label: spelled.written.slice(lead.length), url: cite.url },
    start: start + lead.length,
  };
}

export type { UnlinkedMention } from "./referenceSpellings";

/** A sentence split, and every reference in it that found no target. */
export interface InlineResolution {
  readonly segments: readonly InlineSegment[];
  readonly unlinked: readonly UnlinkedMention[];
}

/**
 * Split a sentence into its words and the records it cites, and name every reference in it that cites nothing.
 *
 * `#N (URL)` and `#N URL` become ONE reference when the URL's number is N, so the number is the link and the
 * URL is gone. A bare pull-request URL becomes its number, a Linear issue URL its key, any other address a chip
 * labelled by where it points, and `owner/repo#N` links as written. A bare `#N`, `acme-admin N`,
 * `acme-admin PR N` or `ABC-123` is a link only when an address with exactly that number, repository or key is
 * named in the same text or carried by the row — `option #1`, `CI 93` and `UTC-5` name nothing and stay words. A
 * board row's slug links only when the board holds that row. A match that does not resolve gives up only its first
 * character, so a reference inside it (`ABC-12 5`'s key) is still found — except one of the row's repositories then a
 * number it has no pull request for, which is kept exactly as written. A number beside a different pull request's
 * address is never folded into it: the address is its own chip, and the number is read alone.
 *
 * @param text the card's own sentence
 * @param known the addresses the row carries beyond this text (its pull requests, its step's place, its links),
 *   so a number or key the sentence names without its address still resolves
 * @param references what the row knows beyond its addresses — its repository, that repository's scale, the
 *   install's Linear workspace, the board's slugs — so a number, key or slug no address names resolves too
 * @returns the segments, in order, adjacent words merged, none empty; and the unresolved spellings, first seen first
 */
export function resolveInline({
  text,
  known = [],
  references = NO_CARD_REFERENCES,
}: {
  text: string;
  known?: readonly string[];
  references?: CardReferences;
}): InlineResolution {
  // The people first (`./personMentions.ts`); a stretch between two of them still resolves a number its sentence
  // gives the address of elsewhere, so it carries every address the whole sentence names.
  const carried = [...known, ...addressesIn({ text })];
  const resolve = ({ words }: { words: string }): InlineResolution =>
    resolveAddresses({ known: words === text ? known : carried, references, text: words });
  return resolveAroundPeople({ people: references.people, resolve, text });
}

/**
 * {@link resolveInline} over a stretch of words naming no person: every record it cites, and every reference that
 * cites nothing.
 *
 * @returns the segments and the unresolved spellings
 */
function resolveAddresses({
  text,
  known,
  references,
}: Required<Parameters<typeof resolveInline>[0]>): InlineResolution {
  const lookups = resolvable({ known, references, text });
  // What a part of this sentence read on its own still resolves against: the row's addresses and this sentence's.
  const carried = [...known, ...addressesIn({ text })];
  const reference = new RegExp(REFERENCE_SOURCE, "gu");
  const out: InlineSegment[] = [];
  const unlinked: UnlinkedMention[] = [];
  // Where each finding was first reported, so a spelling that later resolves beside an address takes its own back.
  const reportedAt = new Map<UnlinkedMention, number>();
  const add = ({ mention, index }: { mention: UnlinkedMention | undefined; index?: number }): void => {
    if (mention !== undefined && !unlinked.some((seen) => mentionKey({ mention: seen }) === mentionKey({ mention }))) {
      unlinked.push(mention);
      if (index !== undefined) {
        reportedAt.set(mention, index);
      }
    }
  };
  // A reported spelling is one finding: the scan resuming inside it never reports a piece of it again, as
  // `pull request#N`'s `request#N`.
  let reportedUntil = 0;
  const note = ({ match, whole }: { match: RegExpExecArray; whole: boolean }): void => {
    const mention =
      match.index < reportedUntil
        ? undefined
        : unlinkedOf({ groups: { ...match.groups }, references, whole, written: match[0] });
    if (mention !== undefined) {
      const spelled = match[0].startsWith(mention.label) ? mention.label : match[0];
      reportedUntil = match.index + spelled.length;
    }
    add({ index: match.index, mention });
  };
  let words = "";
  const emit = ({ segment }: { segment: InlineSegment }): void => {
    if (segment.kind === "text") {
      words += segment.text;
      return;
    }
    if (words.length > 0) {
      out.push({ kind: "text", text: words });
    }
    out.push(segment);
    words = "";
  };
  let at = 0;
  for (let match = reference.exec(text); match !== null; match = reference.exec(text)) {
    const first = resolved({ lookups, match });
    const apart = first === "words" ? markupApart({ groups: { ...match.groups }, references }) : undefined;
    if (apart !== undefined) {
      // A Slack or Markdown link whose label names another target than its address: its
      // label reads as a sentence of its own, then its address as its own chip, so neither hides the other.
      emit({ segment: { kind: "text", text: text.slice(at, match.index) } });
      const label = resolveInline({ known: [...carried, apart.address.url], references, text: apart.label });
      for (const mention of label.unlinked) {
        add({ mention });
      }
      for (const segment of label.segments) {
        emit({ segment });
      }
      emit({ segment: { kind: "text", text: " " } });
      emit({ segment: apart.address });
      at = match.index + match[0].length;
      reference.lastIndex = at;
      continue;
    }
    if (first === "words") {
      // Kept whole, as written — the scan resumes after it.
      note({ match, whole: true });
      continue;
    }
    const found = first ?? laterAlternative({ at: match.index, groups: { ...match.groups }, lookups, text });
    if (found === undefined) {
      // Any other miss gives back all but its first character, so a reference starting inside it is still found.
      note({ match, whole: false });
      // Bar a glued `step#N`: one spelling whose repository is `step`, so its `#N` is never read again.
      const groups: Readonly<Record<string, string | undefined>> = { ...match.groups };
      const { pN, pRepo } = groups;
      const glued =
        pN !== undefined &&
        pRepo !== undefined &&
        match[0] === `${pRepo}#${pN}` &&
        withoutLeadingZeros({ spelled: pN }).length > 1;
      reference.lastIndex = glued ? match.index + match[0].length : match.index + 1;
      continue;
    }
    const before = text.slice(at, match.index);
    const spelled = spelledBeforeAddress({ before, groups: { ...match.groups }, preceding: text.slice(0, at) });
    const beside = found.segment.kind === "cite" ? [...carried, found.segment.url] : carried;
    const chip = spelled === undefined ? undefined : spelledChip({ before, known: beside, references, spelled });
    if (chip === undefined) {
      if (spelled !== undefined) {
        // Its own reading's findings, so `see PR N` is the `PR N` it spells; a far end's `#1` is still one.
        const alone = resolveInline({ known: beside, references, text: spelled.read }).unlinked;
        for (const mention of alone.length > 0 ? alone : [{ kind: "github" as const, label: spelled.read }]) {
          add({ mention });
        }
      }
      emit({ segment: { kind: "text", text: before } });
    } else {
      // Read alone it resolves: its own chip, beside the other pull request's — and no longer the finding its
      // first read reported, `PR 1 owner/repo#1`.
      const from = at + chip.start;
      const taken = unlinked.findIndex((seen) => {
        const index = reportedAt.get(seen);
        return index !== undefined && index >= from && index < at + chip.end;
      });
      if (taken !== -1) {
        unlinked.splice(taken, 1);
      }
      emit({ segment: { kind: "text", text: before.slice(0, chip.start) } });
      emit({ segment: chip.segment });
      emit({ segment: { kind: "text", text: before.slice(chip.end) } });
    }
    emit({ segment: found.segment });
    at = match.index + found.length;
    reference.lastIndex = at;
  }
  words += text.slice(at);
  if (words.length > 0) {
    out.push({ kind: "text", text: words });
  }
  return { segments: out, unlinked };
}

/**
 * Split a sentence into its words and the records it cites — {@link resolveInline}'s segments.
 *
 * @param text the card's own sentence
 * @param known the addresses the row carries beyond this text
 * @param references what the row knows beyond its addresses
 * @returns the segments, in order, adjacent words merged, none empty
 */
export function inlineSegments({
  text,
  known = [],
  references = NO_CARD_REFERENCES,
}: {
  text: string;
  known?: readonly string[];
  references?: CardReferences;
}): readonly InlineSegment[] {
  return resolveInline({ known, references, text }).segments;
}

/**
 * Every reference across a card's sentences that cites nothing, once each, first seen first — the drawer's lint
 * finding: a mention with no resolvable target is a lint finding.
 *
 * @param texts every sentence the card draws
 * @param known the addresses the row carries beyond these texts
 * @param references what the row knows beyond its addresses
 * @returns the unresolved spellings
 */
export function unlinkedMentions({
  texts,
  known = [],
  references = NO_CARD_REFERENCES,
}: {
  texts: readonly string[];
  known?: readonly string[];
  references?: CardReferences;
}): readonly UnlinkedMention[] {
  const out: UnlinkedMention[] = [];
  for (const text of texts) {
    for (const mention of resolveInline({ known, references, text }).unlinked) {
      if (!out.some((seen) => mentionKey({ mention: seen }) === mentionKey({ mention }))) {
        out.push(mention);
      }
    }
  }
  return out;
}

/**
 * The same sentence with every reference folded to its label and no link, for a place that is itself a link
 * already — a queue row, the dialog's accessible name — where a second link cannot sit. A person reads as the
 * drawn card names them, a first name and the owner "you", and its numbers in one notation, so the row and the card agree.
 *
 * @param text the card's own sentence
 * @param known the addresses the row carries beyond this text
 * @param references what the row knows beyond its addresses
 * @returns the sentence as it reads on the card
 */
export function inlinePlain({
  text,
  known = [],
  references = NO_CARD_REFERENCES,
}: {
  text: string;
  known?: readonly string[];
  references?: CardReferences;
}): string {
  const segments = inlineSegments({ known, references, text: oneNumberNotation({ text }) });
  return personWords({ people: references.people, segments })
    .map((segment) => {
      if (segment.kind === "text") {
        return segment.text;
      }
      return segment.label;
    })
    .join("");
}

/**
 * The published pull requests the card's sentences never link — the ones the card would otherwise lose, because
 * a row's `prUrls` is scraped from its whole doc while the card prints only its question.
 *
 * @param texts the sentences drawn on the card
 * @param prUrls every pull request the row publishes, in its own order
 * @returns the ones no sentence links, in that order
 */
export function notInline({
  texts,
  prUrls,
}: {
  texts: readonly string[];
  prUrls: readonly string[];
}): readonly string[] {
  const linked = new Set<string | undefined>();
  for (const text of texts) {
    for (const segment of inlineSegments({ known: prUrls, text })) {
      if (segment.kind === "cite") {
        linked.add(prBase({ url: segment.url }));
      }
    }
  }
  return prUrls.filter((url) => !linked.has(prBase({ url })));
}
