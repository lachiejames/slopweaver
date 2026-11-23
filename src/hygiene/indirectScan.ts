/**
 * The indirect-references scan — pure. Where `./referenceScan.ts` counts the installation's own names and never
 * prints one, this layer looks for what could tie the tree back to the organisation WITHOUT its name: a control
 * id, an incident number, an internal system, a person, a locale, a vendor set. Its output is a CANDIDATE list
 * for a person to judge, so unlike the direct proof every place carries the matched term and its line. The
 * report it feeds is written under the home only, because a matched term is what the scan exists to find.
 *
 * Two sources feed one place shape:
 *
 * - `map:` — the candidate map (`./indirectMap.ts`), read from `$SLOPWEAVER_HOME`: patterns a reviewer wrote,
 *   each carrying a disposition and the replacement to propose.
 * - `harvest:` — computed, not listed: a capitalised word the system dictionary holds no lowercase entry for, or
 *   one its proper-names list holds, that appears in few files. It is the half that finds a name nobody thought to
 *   put in a map, and it names nothing in code: the dictionary is the operating system's.
 */
import type { IndirectDisposition, IndirectMapRow } from "./indirectMap.js";

/** One candidate: a file, a 1-based line, its class, what matched, the line it sits on and what to do with it. */
export interface IndirectPlace {
  readonly path: string;
  readonly line: number;
  readonly className: string;
  readonly term: string;
  readonly excerpt: string;
  readonly disposition: IndirectDisposition;
  readonly replacement: string;
}

/** The harvest's replacement, the same for every word it finds: it cannot know what the word is. */
const HARVEST_REPLACEMENT = "a synthetic name if it is a person or system; none if it is a library or product word";

/** The longest excerpt a place carries, so a minified line cannot fill the report. */
const EXCERPT_MAX = 200;

/**
 * A capitalised word standing alone: not inside an identifier, a path, a URL, a flag or a dotted name. The shape
 * a person's or a system's name takes in prose and in a string literal.
 */
const TITLE_WORD = /(?<![\p{L}\p{N}_$.#/@\\-])[A-Z][a-z]{2,19}(?![\p{L}\p{N}_])/gu;

/**
 * Pure: every line start in a text, for offset-to-line lookups.
 *
 * @param text the text
 * @returns each line's starting offset, ascending, beginning with 0
 */
function lineStarts({ text }: { text: string }): readonly number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    starts.push(at + 1);
  }
  return starts;
}

/**
 * Pure: the 0-based index of the line holding an offset, by binary search.
 *
 * @param offset a character offset into the text
 * @param starts every line's starting offset, ascending, beginning with 0
 * @returns the line's index into `starts`
 */
function lineIndexAt({ offset, starts }: { offset: number; starts: readonly number[] }): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/**
 * Pure: the excerpt of one line around a column, at most {@link EXCERPT_MAX} characters.
 *
 * @param text the file's text
 * @param starts its line starts
 * @param offset where the match begins
 * @returns the 1-based line and the excerpt
 */
function lineAround({ text, starts, offset }: { text: string; starts: readonly number[]; offset: number }): {
  readonly line: number;
  readonly excerpt: string;
} {
  const index = lineIndexAt({ offset, starts });
  const begin = starts[index]!;
  const nextStart = starts[index + 1];
  let end = text.length;
  if (nextStart !== undefined) {
    end = nextStart - 1;
  }
  const lineText = text.slice(begin, end);
  const column = offset - begin;
  const from = Math.max(0, Math.min(column - EXCERPT_MAX / 2, lineText.length - EXCERPT_MAX));
  return { excerpt: lineText.slice(from, from + EXCERPT_MAX).trim(), line: index + 1 };
}

/**
 * Pure: every place one file's text, and its path at line 0, match a candidate-map row.
 *
 * @param path the tree-relative path
 * @param text the file's text
 * @param map the candidate map's rows
 * @returns each match, in map order then text order
 */
export function scanCandidateMap({
  path,
  text,
  map,
}: {
  path: string;
  text: string;
  map: readonly IndirectMapRow[];
}): readonly IndirectPlace[] {
  const starts = lineStarts({ text });
  const places: IndirectPlace[] = [];
  for (const row of map) {
    const shared = {
      className: `map:${row.className}`,
      disposition: row.disposition,
      path,
      replacement: row.replacement,
    };
    for (const match of path.matchAll(row.re)) {
      places.push({ ...shared, excerpt: path, line: 0, term: match[0] });
    }
    for (const match of text.matchAll(row.re)) {
      places.push({ ...shared, ...lineAround({ offset: match.index, starts, text }), term: match[0] });
    }
  }
  return places;
}

/** The two sets the harvest asks of the system dictionary. */
export interface HarvestDictionary {
  /** Every lowercase entry: a common word. */
  readonly common: ReadonlySet<string>;
  /** Every proper name the proper-names list holds. */
  readonly proper: ReadonlySet<string>;
}

/**
 * Pure: the system dictionary read into the two sets the harvest asks of it.
 *
 * @param words the dictionary's lines, one word each (`/usr/share/dict/words`)
 * @param propernames the proper-names list's lines (`/usr/share/dict/propernames`)
 * @returns every lowercase entry, and every proper name
 */
export function readHarvestDictionary({
  words,
  propernames,
}: {
  words: readonly string[];
  propernames: readonly string[];
}): HarvestDictionary {
  const common = new Set<string>();
  for (const word of words) {
    const trimmed = word.trim();
    if (trimmed.length > 0 && trimmed === trimmed.toLowerCase()) {
      common.add(trimmed);
    }
  }
  const proper = new Set(propernames.map((name) => name.trim()).filter((name) => name.length > 0));
  return { common, proper };
}

/**
 * Pure: whether a capitalised word is a harvest candidate — a proper name, or no common word in any inflection
 * the dictionary would spell (`Rulesets` is `ruleset` plus `s`, never a name).
 *
 * @param word the capitalised word
 * @param dictionary the system dictionary's two sets
 * @returns whether it is a candidate
 */
export function isHarvestCandidate({ word, dictionary }: { word: string; dictionary: HarvestDictionary }): boolean {
  if (dictionary.proper.has(word)) {
    return true;
  }
  const lower = word.toLowerCase();
  const stems = [
    lower,
    lower.replace(/s$/, ""),
    lower.replace(/es$/, ""),
    lower.replace(/ed$/, ""),
    lower.replace(/ing$/, ""),
  ];
  return !stems.some((stem) => stem.length > 1 && dictionary.common.has(stem));
}

/**
 * Pure: every harvest candidate in one file's text.
 *
 * @param path the tree-relative path
 * @param text the file's text
 * @param dictionary the system dictionary's two sets
 * @returns each candidate place, class `harvest:proper-name` or `harvest:unknown-word`
 */
export function harvestPlaces({
  path,
  text,
  dictionary,
}: {
  path: string;
  text: string;
  dictionary: HarvestDictionary;
}): readonly IndirectPlace[] {
  const starts = lineStarts({ text });
  const places: IndirectPlace[] = [];
  for (const match of text.matchAll(TITLE_WORD)) {
    const word = match[0];
    if (isHarvestCandidate({ dictionary, word })) {
      let className = "harvest:unknown-word";
      if (dictionary.proper.has(word)) {
        className = "harvest:proper-name";
      }
      places.push({
        className,
        disposition: "review",
        path,
        replacement: HARVEST_REPLACEMENT,
        term: word,
        ...lineAround({ offset: match.index, starts, text }),
      });
    }
  }
  return places;
}

/** One matched term's totals inside a class. */
export interface IndirectTerm {
  readonly term: string;
  readonly hits: number;
  readonly files: number;
  readonly places: readonly IndirectPlace[];
}

/** One class's totals, its terms most-frequent first. */
export interface IndirectClass {
  readonly className: string;
  readonly disposition: IndirectDisposition;
  readonly hits: number;
  readonly files: number;
  readonly terms: readonly IndirectTerm[];
}

/**
 * Pure: the key one class-and-disposition pair folds under, so one class carrying both an obvious row and a
 * judgement row reports them apart.
 *
 * @param place the place
 * @returns the fold key
 */
function foldKey({ place }: { place: IndirectPlace }): string {
  return `${place.className}\u0000${place.disposition}`;
}

/**
 * Pure: how many distinct files each harvest term was found in, keyed by its class, disposition and term.
 *
 * @param places every place found, map places included (they are skipped)
 * @returns the file count per harvest term
 */
function harvestSpans({ places }: { places: readonly IndirectPlace[] }): ReadonlyMap<string, number> {
  const files = new Map<string, Set<string>>();
  for (const place of places.filter((p) => p.className.startsWith("harvest:"))) {
    const key = `${foldKey({ place })}\u0000${place.term}`;
    const seen = files.get(key);
    if (seen === undefined) {
      files.set(key, new Set([place.path]));
    } else {
      seen.add(place.path);
    }
  }
  return new Map([...files].map(([key, paths]) => [key, paths.size]));
}

/**
 * Pure: fold places into classes and terms. A harvest term found in more than `harvestMaxFiles` files is dropped,
 * because a word that common in this tree is its own vocabulary, not somebody's name; a map term is never
 * dropped, because a reviewer wrote its row on purpose. A term whose word a map row already matched at the same
 * place is not harvested twice.
 *
 * @param places every place found
 * @param harvestMaxFiles the most files a harvest term may span and still be reported
 * @returns the classes: `remove` first, then `review`, then `aggregate`, then harvest; each by descending hits
 */
export function summariseIndirect({
  places,
  harvestMaxFiles,
}: {
  places: readonly IndirectPlace[];
  harvestMaxFiles: number;
}): readonly IndirectClass[] {
  const mapped = new Set(
    places.filter((p) => p.className.startsWith("map:")).map((p) => `${p.path}\u0000${String(p.line)}\u0000${p.term}`),
  );
  // A harvest term's span counts every file it was harvested in, BEFORE a map row claims any of its places: a
  // word too common to be a name stays too common even when one of its places is also a map match.
  const harvestSpan = harvestSpans({ places });
  const byClass = new Map<string, Map<string, IndirectPlace[]>>();
  for (const place of places) {
    if (
      place.className.startsWith("harvest:") &&
      mapped.has(`${place.path}\u0000${String(place.line)}\u0000${place.term}`)
    ) {
      continue;
    }
    const key = foldKey({ place });
    let terms = byClass.get(key);
    if (terms === undefined) {
      terms = new Map();
      byClass.set(key, terms);
    }
    const list = terms.get(place.term);
    if (list === undefined) {
      terms.set(place.term, [place]);
    } else {
      list.push(place);
    }
  }
  const classes: IndirectClass[] = [];
  for (const termMap of byClass.values()) {
    const first = [...termMap.values()][0]![0]!;
    const harvest = first.className.startsWith("harvest:");
    const terms = [...termMap]
      .map(([term, list]) => ({ files: new Set(list.map((p) => p.path)).size, hits: list.length, places: list, term }))
      .filter(
        (term) => !harvest || harvestSpan.get(`${foldKey({ place: first })}\u0000${term.term}`)! <= harvestMaxFiles,
      )
      .toSorted((a, b) => b.hits - a.hits || a.term.localeCompare(b.term));
    if (terms.length === 0) {
      continue;
    }
    const files = new Set(terms.flatMap((term) => term.places.map((p) => p.path))).size;
    const hits = terms.reduce((sum, term) => sum + term.hits, 0);
    classes.push({ className: first.className, disposition: first.disposition, files, hits, terms });
  }
  return classes.toSorted(
    (a, b) =>
      classRank({ entry: a }) - classRank({ entry: b }) || b.hits - a.hits || a.className.localeCompare(b.className),
  );
}

/**
 * Pure: where a class sorts — obvious removals first, the owner's judgement next, totals, then the harvest.
 *
 * @param entry the class
 * @returns its rank, lowest first
 */
function classRank({ entry }: { entry: IndirectClass }): number {
  if (entry.className.startsWith("harvest:")) {
    return 3;
  }
  return DISPOSITION_RANK[entry.disposition];
}

const DISPOSITION_RANK: Readonly<Record<IndirectDisposition, number>> = { aggregate: 2, remove: 0, review: 1 };
