/**
 * What `supervisor tick open` prints of its digest: the lines that CHANGED since the previous tick first, then the
 * standing obligations that are still there, then ONE fold line for every reading that said the same thing as last
 * tick, pointing at the file holding the whole digest. The owner's ask: the chair re-read every line every pass,
 * most of them repeating the last one.
 *
 * MEASURED over one chair's three ticks (each digest recomputed from its `capture.json`): 68 lines on tick 2, 27
 * not verbatim in tick 1; 72 on tick 3, 39 not verbatim in tick 2. Most of that residue was a numeral moving on an
 * unchanged fact — a watch age, a plan's percentage, the load triple — so a line is compared by a KEY that blanks
 * those, one generated shape at a time and never by a regex over arbitrary text: a percentage inside a card's
 * question is that card's identity, and `gauge: CHAIR — … 85%` reaching `100%` is the chair hitting its wall.
 *
 * Pure — lines in, lines out. The edge that reads the previous tick's digest and writes this one is
 * `../cli/commands/supervisor/tickDigestEdge.ts`.
 */
import { cappedInline } from "./digestRead.js";

/** The previous tick's digest, as the edge read it. */
export type PriorDigest =
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly tick: number; readonly why: string }
  | { readonly kind: "read"; readonly tick: number; readonly lines: readonly string[] };

/** Whether an unchanged line may fold, or is an obligation printed every tick it stands. */
export type DigestLinePolicy = "always" | "comparable";

/** This tick's digest set against the previous one. */
export type DigestDelta =
  | { readonly kind: "first" }
  | { readonly kind: "unreadable"; readonly priorTick: number; readonly why: string }
  | {
      readonly kind: "compared";
      readonly priorTick: number;
      /** The card stopping the owner's work, changed or not: printed FIRST, before any comparison (a P0 rule). */
      readonly lead: readonly string[];
      /** Lines the previous tick did not print, in the digest's own act-first order. */
      readonly changed: readonly string[];
      /** Unchanged lines that are obligations or unknowns, printed anyway, in digest order. */
      readonly repeatedAction: readonly string[];
      readonly unchangedCount: number;
      /** The folded lines' sections, first-seen order, each once. */
      readonly unchangedSections: readonly string[];
    };

/**
 * The digest's first lines by design, the card stopping the owner's work: a P0 rule is that the chair opens its
 * update to the owner on it, so it leads the print whether or not it changed.
 */
const LEAD_PREFIXES: readonly string[] = ["queue leader", "stopping the owner's work:"];

/**
 * Lines that are an obligation for as long as they stand: the card stopping the owner's work, the chair's own wall and a plan stopping spawns (`./tickDigest.ts`: "a dead chair
 * is a dead fleet"), an automation off on a failure, and a declared automation the store lacks.
 */
const ALWAYS_PREFIXES: readonly string[] = [
  "queue leader",
  "stopping the owner's work:",
  "gauge: CHAIR",
  "gauge: REACT NOW",
  "BROKEN ",
  "recipes absent:",
  "recipes superseded:",
];

/**
 * The verdict words an unread or unknown reading prints — an unknown repeated is still an unknown, never a quiet
 * line — and the two `recipes:` declaration verdicts `automation register-standing` answers.
 */
// Bounded by letters and digits, not `\b`: `\b` counts `_` as a word character, so `_UNKNOWN_` would slip past.
const ALWAYS_WORDS =
  /(?<![\p{L}\p{N}])(?:UNKNOWN|NOT READ|INCOMPLETE|unavailable|EMPTY|NO SUMMARY|ABSENT|SUPERSEDED)(?![\p{L}\p{N}])/u;

/** A window's reset clause on a `PLAN` line — never its `PAUSED since` instant, which is the pause itself. */
const RESETS = /resets \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gu;

/** An ISO instant as the readings print one. */
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gu;

/**
 * What a blanked clause becomes in a key. A key is built from the line with every backslash doubled first, so a lone
 * backslash never comes from the line's own text and no line, whatever it says, can spell this marker (a
 * literal `…` in an intake clause would otherwise key equal to a blanked instant).
 */
const BLANK = "\\#";

/** Each generated shape whose numerals move on an unchanged fact, and the one clause of it that is blanked. */
const VOLATILE: readonly { readonly shape: RegExp; readonly key: (line: string) => string }[] = [
  // `capacityLines`: the load triple only — HOLD/clear, the hold line, the culprit and the boots all survive.
  // Anchored to the verdict's own clause, so a load-shaped value in the culprit's text is never blanked.
  {
    key: (line) => line.replace(/^(machine: (?:HOLD|clear) — load )\d+\.\d\/\d+\.\d\/\d+\.\d/u, `$1${BLANK}`),
    shape: /^machine: (?:HOLD|clear) — load \d+\.\d\/\d+\.\d\/\d+\.\d/u,
  },
  // `watchLines`: a seat's age; its signal and slug survive.
  { key: (line) => line.replace(/^(watch: \S+) \d+m — /u, `$1 ${BLANK}m — `), shape: /^watch: \S+ \d+m — /u },
  { key: () => `watch: ${BLANK} suppressed`, shape: /^watch: \d+ suppressed$/u },
  // `gaugeLines`' plan inventory: the CHAIR and REACT NOW lines are obligations and never reach here.
  { key: (line) => line.replace(/\d+%/gu, `${BLANK}%`).replace(RESETS, `resets ${BLANK}`), shape: /^gauge: PLAN /u },
  // A reading's generated clock clauses.
  { key: (line) => line.replace(ISO, BLANK), shape: /^[^:]+: not due — next /u },
  { key: (line) => line.replace(ISO, BLANK), shape: /^intake: /u },
  // `snapshotLines`, its clean form only: past the ceiling it carries the render's refusal, which changes the key.
  {
    key: (line) => line.replace(/\d+ min old$/u, `${BLANK} min old`),
    shape: /^(?:open pages|owner's list): \d+ min old$/u,
  },
];

/**
 * Whether an unchanged line folds, or is printed every tick it stands.
 *
 * @param line one digest line
 * @returns `always` for an obligation or an unknown, else `comparable`
 */
export function digestLinePolicy({ line }: { line: string }): DigestLinePolicy {
  if (ALWAYS_PREFIXES.some((prefix) => line.startsWith(prefix)) || ALWAYS_WORDS.test(line)) {
    return "always";
  }
  return "comparable";
}

/**
 * The key two ticks' lines are compared by: the line with its backslashes doubled, and only its generated shape's
 * moving numerals blanked to {@link BLANK} — so the one way two lines share a key is a blanked clause.
 *
 * @param line one digest line
 * @returns the comparison key
 */
export function digestLineKey({ line }: { line: string }): string {
  const escaped = line.replaceAll("\\", "\\\\");
  const volatile = VOLATILE.find((one) => one.shape.test(line));
  if (volatile === undefined) {
    return escaped;
  }
  return volatile.key(escaped);
}

/**
 * The section a line reads, as its prefix before the first colon.
 *
 * @returns the section name
 */
function sectionOf({ line }: { line: string }): string {
  const colon = line.indexOf(":");
  if (colon === -1) {
    return line;
  }
  return line.slice(0, colon);
}

/**
 * How many lines of a digest carry each comparison key.
 *
 * @returns each key's count
 */
function keyCounts({ lines }: { lines: readonly string[] }): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = digestLineKey({ line });
    const seen = counts.get(key);
    counts.set(key, seen === undefined ? 1 : seen + 1);
  }
  return counts;
}

/**
 * This tick's digest against the previous tick's, as a multiset: each current line consumes one prior line with the
 * same key, so a second copy of a line printed once before is a change.
 *
 * @param lines this tick's digest, in its own order
 * @param prior the previous tick's digest, or why there is none
 * @returns the delta
 */
export function digestDelta({ lines, prior }: { lines: readonly string[]; prior: PriorDigest }): DigestDelta {
  if (prior.kind === "none") {
    return { kind: "first" };
  }
  if (prior.kind === "unreadable") {
    return { kind: "unreadable", priorTick: prior.tick, why: prior.why };
  }
  const remaining = keyCounts({ lines: prior.lines });
  const lead: string[] = [];
  const changed: string[] = [];
  const repeatedAction: string[] = [];
  const folded: string[] = [];
  for (const line of lines) {
    if (LEAD_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      lead.push(line);
      continue;
    }
    const key = digestLineKey({ line });
    const left = remaining.get(key);
    if (left === undefined || left === 0) {
      changed.push(line);
      continue;
    }
    remaining.set(key, left - 1);
    if (digestLinePolicy({ line }) === "always") {
      repeatedAction.push(line);
    } else {
      folded.push(line);
    }
  }
  return {
    changed,
    kind: "compared",
    lead,
    priorTick: prior.tick,
    repeatedAction,
    unchangedCount: folded.length,
    unchangedSections: [...new Set(folded.map((line) => sectionOf({ line })))],
  };
}

/**
 * What `tick open` prints of its digest: on a first or unreadable comparison every line under a line saying why;
 * otherwise the card stopping the owner's work, then the changed lines, the standing obligations, and one fold line naming the file every line is in.
 *
 * @param delta the comparison
 * @param digestPath where this tick's whole digest was written
 * @param lines this tick's whole digest
 * @returns the lines to print
 */
export function deltaLines({
  delta,
  digestPath,
  lines,
}: {
  delta: DigestDelta;
  digestPath: string;
  lines: readonly string[];
}): readonly string[] {
  if (delta.kind === "first") {
    return ["no earlier tick in this seat — every reading follows:", ...lines];
  }
  if (delta.kind === "unreadable") {
    return [
      `tick ${String(delta.priorTick)}'s digest is unreadable, so nothing is compared — every reading follows: ${delta.why}`,
      ...lines,
    ];
  }
  const since = `since tick ${String(delta.priorTick)}`;
  const standing =
    delta.repeatedAction.length === 0 ? [] : [`still standing ${since}, act on these too:`, ...delta.repeatedAction];
  const fold =
    delta.unchangedCount === 0
      ? []
      : [
          `unchanged ${since}: ${String(delta.unchangedCount)} line(s) (${cappedInline({ items: delta.unchangedSections })}) — every line: ${digestPath}`,
        ];
  const head =
    delta.changed.length === 0
      ? `nothing changed ${since} — 0 of ${String(lines.length)} line(s)`
      : `changed ${since} — ${String(delta.changed.length)} of ${String(lines.length)} line(s), act on these:`;
  return [...delta.lead, head, ...delta.changed, ...standing, ...fold];
}
