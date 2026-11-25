/**
 * The words a staleness mark's hover says: what could not be read, why, and how old the data still drawn is. Pure.
 *
 * A stand-in such as "not yet read", printed where data goes, looks broken. A read that failed is a mark, and these
 * words are what the mark says when the owner points at it — every subject on its own line, so a page with three
 * failed registers names all three rather than the first and a count.
 *
 * A raw, long error message is never the line. So each line says its reason in plain words (`./plainReason.ts`), and the raw message it was told
 * from is returned apart, for the fold the mark draws beneath — never inside the line.
 *
 * Imports only `./plainReason.ts`, which itself imports nothing, for the reason `./liveRetained.ts` gives.
 */
import { plainReasonOf } from "./plainReason";

/** One thing that could not be read, or a value the console holds back on purpose. */
export interface StalenessFact {
  /** What it is, in the page's own words. */
  readonly subject: string;
  /** The reason its read gave; `""` on a withheld value whose reason is all the console's own words. */
  readonly why: string;
  /** When the reading still drawn in its place was true; absent when nothing earlier is drawn. */
  readonly observedAtIso?: string;
  /**
   * Set when NOTHING failed: the console holds the value back, and this is why, in its own words — a count withheld
   * because its reading aged past the cadence, say. The line then reads "<Subject> is not shown: <withheld>." and never
   * "could not be read": an aged count drawn as "It failed with a technical
   * error" reads as broken and is false. A read reason it quotes (`why`) still follows in plain words, raw folded.
   */
  readonly withheld?: string;
  /**
   * What the console is doing about a failed read, in its own words off its runner's real state ("The console tries
   * again at <time>"), said last on the line. Absent where the page makes no such promise. An error copy says what the
   * actual problem is and what is being done about it.
   */
  readonly after?: string;
  /**
   * Two or three words drawn beside the glyph, such as "burn not read", so the mark says why without a hover. Never a
   * sentence: the full words stay on the hover. Absent keeps the mark a glyph alone; a page supplies it where a bare
   * triangle left the owner guessing.
   */
  readonly shortWords?: string;
}

/** A subject opened in capitals, so one named mid-sentence ("your hands") still opens a sentence. */
function subjectOf({ fact }: { fact: StalenessFact }): string {
  return `${fact.subject.charAt(0).toUpperCase()}${fact.subject.slice(1)}`;
}

/** A sentence closed by its own stop, or a full stop. */
function closed({ text }: { text: string }): string {
  if (/[.?!]$/u.test(text)) {
    return text;
  }
  return `${text}.`;
}

/** A withheld value's line: what is not shown and the console's own reason, then a quoted read reason plainly. */
function withheldLine({ fact, withheld }: { fact: StalenessFact; withheld: string }): string {
  const head = closed({ text: `${subjectOf({ fact })} is not shown: ${withheld}` });
  if (fact.why.trim() === "") {
    return head;
  }
  return `${head} ${plainReasonOf({ why: fact.why }).plain}`;
}

/**
 * The hover's words, one line per fact: what could not be read, why in plain words, and how old what is drawn is.
 * Never the raw message — {@link stalenessRaw} carries that for the fold.
 *
 * @param facts every subject that could not be read
 * @param age how long ago an instant was, in the page's own words
 * @returns the label
 */
export function stalenessLabel({
  facts,
  age,
}: {
  facts: readonly StalenessFact[];
  age: (iso: string) => string;
}): string {
  return facts
    .map((fact) => {
      if (fact.withheld !== undefined) {
        return withheldLine({ fact, withheld: fact.withheld });
      }
      const head = `${subjectOf({ fact })} could not be read. ${plainReasonOf({ why: fact.why }).plain}`;
      let line = `${head} Nothing earlier to show.`;
      if (fact.observedAtIso !== undefined) {
        line = `${head} Showing the reading from ${age(fact.observedAtIso)}.`;
      }
      if (fact.after === undefined) {
        return line;
      }
      return `${line} ${closed({ text: fact.after })}`;
    })
    .join("\n");
}

/**
 * The short words a mark draws beside its glyph: each fact's own, in order, each said once.
 *
 * @param facts every subject the mark stands for
 * @returns the words, empty when no fact supplied any
 */
export function stalenessShortWords({ facts }: { facts: readonly StalenessFact[] }): readonly string[] {
  const words = facts.flatMap((fact) => {
    if (fact.shortWords === undefined) {
      return [];
    }
    return [fact.shortWords];
  });
  return [...new Set(words)];
}

/**
 * The raw message behind each line whose plain words are not the message itself, subject first, for the fold under
 * the hover's words — empty when every reason already read as words.
 *
 * @param facts every subject that could not be read
 * @returns one entry per fact with a raw message, in the order the label names them
 */
export function stalenessRaw({ facts }: { facts: readonly StalenessFact[] }): readonly string[] {
  return facts.flatMap((fact) => {
    if (fact.withheld !== undefined && fact.why.trim() === "") {
      return [];
    }
    const { raw } = plainReasonOf({ why: fact.why });
    if (raw === undefined) {
      return [];
    }
    return [`${subjectOf({ fact })}: ${raw}`];
  });
}
