/**
 * Which of the owner's guidance an Alignment act card names beside it, the way a Queue card's sidebar names its related
 * work. The guidance is `profile guidance --json` (`./alignmentGuidance.ts`); the panel `../components/console/RelatedGuidance.tsx`.
 *
 * Two relations, and they are kept apart because only one is exact:
 *
 * - **Settles** — a class steer whose kinds include the act's kind and whose scope, when it has one, admits the act's
 *   subject. That is the same membership `src/autonomy/classSteer.ts`'s `classAdmits` decides, so it never guesses.
 * - **Mentions** — any other entry whose text names the words of the act's kind. An act kind is a slug
 *   (`press-merge-when-ready`) and nothing else in the guidance carries one, so this is a word match: each kind word
 *   of four letters or more, glue words aside, matches an entry word it begins (`press` matches `presses`), and an entry
 *   is related when it matches two of them, or the one when the kind has only one. Each mention carries the words IT
 *   named, so the panel says what each entry matched rather than implying a link the owner recorded.
 *
 * A source that would not read, or read with a gap, is named as such: a card showing nothing related must not be read
 * as the owner having no guidance on it when part of the guidance was never looked in. Pure.
 */
import type { GuidanceLevel, GuidanceView } from "./alignmentGuidance";

/** One related entry, with the source it came from. */
export interface RelatedEntry {
  readonly source: string;
  readonly level: GuidanceLevel;
  readonly text: string;
  readonly citation: string;
}

/** One entry mentioning the act's kind, with the kind words it actually names. */
export interface RelatedMention extends RelatedEntry {
  readonly named: readonly string[];
}

/** What a card names beside its act. */
export interface RelatedGuidance {
  /** Class steers that settle this act, by exact kind and scope. */
  readonly settles: readonly RelatedEntry[];
  /** Entries naming the kind's words, the most words named first, then rank order, each with the words it names. */
  readonly mentions: readonly RelatedMention[];
  /** Each source that did not read, or read only in part. */
  readonly unread: readonly string[];
}

/** The shortest kind word matched on: shorter ones (`pr`, `for`, `own`) match too much of any paragraph. */
const MIN_WORD = 4;

/** Glue words a kind slug carries that say nothing about the act. */
const GLUE = new Set(["from", "into", "onto", "that", "them", "their", "this", "when", "with"]);

/**
 * The words of an act kind a mention is matched on.
 *
 * @param kind the act's kind slug
 * @returns its words of four letters or more, glue words left out, each once, in slug order
 */
export function kindWords({ kind }: { kind: string }): readonly string[] {
  const words = kind
    .toLowerCase()
    .split(/[-.]/u)
    .filter((word) => word.length >= MIN_WORD && !GLUE.has(word));
  return [...new Set(words)];
}

/** Which of the kind's words an entry's text names, each by an entry word it begins, in slug order. */
function wordsNamed({ words, body }: { words: readonly string[]; body: string }): readonly string[] {
  const said = body.toLowerCase().split(/[^a-z0-9]+/u);
  return words.filter((word) => said.some((one) => one.startsWith(word)));
}

/**
 * The guidance related to one act.
 *
 * @param view the guidance read
 * @param kind the act's kind
 * @param subject the act's subject, which a scoped class steer must admit
 * @returns what settles it, what mentions it with the words each names, and every source not wholly read
 */
export function relatedGuidance({
  view,
  kind,
  subject,
}: {
  view: GuidanceView;
  kind: string;
  subject: string;
}): RelatedGuidance {
  const words = kindWords({ kind });
  const needed = Math.min(2, words.length);
  const settles: RelatedEntry[] = [];
  const mentions: RelatedMention[] = [];
  const unread: string[] = [];
  for (const source of view.sources) {
    if (source.state.kind === "unreadable") {
      unread.push(source.label);
      continue;
    }
    if (source.state.gaps.length > 0) {
      unread.push(`${source.label} (in part)`);
    }
    for (const entry of source.state.entries) {
      const related = { citation: entry.citation, level: source.level, source: source.label, text: entry.text };
      const scoped = entry.subjectPrefix === null || subject.startsWith(entry.subjectPrefix);
      if (entry.kinds.includes(kind) && scoped) {
        settles.push(related);
        continue;
      }
      const named = wordsNamed({ body: entry.body, words });
      if (needed > 0 && named.length >= needed) {
        mentions.push({ ...related, named });
      }
    }
  }
  return { mentions: mentions.toSorted((a, b) => b.named.length - a.named.length), settles, unread };
}
