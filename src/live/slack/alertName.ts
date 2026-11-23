/**
 * What counts as THE SAME alert: the closed lifecycle vocabulary that recognises a notification, and the stable name
 * one monitor is tallied under.
 *
 * Split out of {@link ./alertTally.js} (the file-size ratchet), which counts over these names.
 *
 * ## The lifecycle vocabulary and the tail rules are DELIBERATELY generic
 *
 * A notification is recognised by a leading lifecycle state word, and the stable name is what remains after the
 * per-occurrence tail is cut. Both lists below are ordinary alerting English — `Triggered`, `Recovered`, `Warn`,
 * `No Data` — rather than any one vendor's syntax, and each tail rule is a shape that fragments a monitor in
 * practice: a trailing bracketed group carrying a digit (an instance id, a host, a build number), an entity
 * reference introduced by `on @` or `for @`, and a trailing `#<n>`. Each is tested on its own.
 *
 * ## Severity is a SHAPE lookup, not the "inference from a title" `digest.ts` refuses to do
 *
 * `../../outbound/artifact/digest.ts` deliberately takes severity as authored DATA, because guessing it from an
 * arbitrary title's words is a genuine semantic judgement — is THIS particular sentence bad enough to be red?
 * That is not what happens here. `LIFECYCLE_SEVERITY` classifies the exact, closed lifecycle-word vocabulary
 * this module already depends on to recognise a notification AT ALL — the same fixed dozen words, not free
 * text. A message with no recognised word is not tallied, so nothing is ever classified by guessing at meaning;
 * a message WITH one already had its shape decided before severity is asked about it.
 */
import { type Severity } from "../../outbound/artifact/severity.js";

/**
 * The lifecycle words a notification title may lead with, lower-cased, LONGEST FIRST.
 *
 * Order is load-bearing rather than cosmetic: `re-triggered` has to be tried before `triggered`, or the longer
 * word is matched by its own suffix and the leading `re-` is left behind to become part of the stable name — which
 * would split one monitor into two rows, the exact fragmentation this module exists to prevent.
 */
const LIFECYCLE_WORDS: readonly string[] = [
  "auto-resolved",
  "re-triggered",
  "retriggered",
  "recovered",
  "triggered",
  "renotify",
  "resolved",
  "warning",
  "no data",
  "nodata",
  "firing",
  "warn",
  "ok",
];

/**
 * Every {@link LIFECYCLE_WORDS} entry classified into a severity — exhaustive by construction, since a word
 * absent here would read as `undefined` for every row it ever matched, silently. `no data` and `nodata` are
 * ORANGE rather than red: the monitor did not confirm a problem, it confirmed it could not tell.
 */
export const LIFECYCLE_SEVERITY: Readonly<Record<string, Severity>> = {
  "auto-resolved": "green",
  firing: "red",
  "no data": "orange",
  nodata: "orange",
  ok: "green",
  "re-triggered": "red",
  recovered: "green",
  renotify: "red",
  resolved: "green",
  retriggered: "red",
  triggered: "red",
  warn: "orange",
  warning: "orange",
};

/** The separators a lifecycle word may be followed by, and that a stable name may not end with. */
const SEPARATORS = new Set([":", "-", "–", "—", ",", " ", "\t"]);

/**
 * Where a title stops naming the monitor and starts naming what it fired ABOUT.
 *
 * What follows one of these is not automatically noise — see {@link withoutEntityTail}, which is the rule this
 * feature had to get right and got wrong first.
 */
const ENTITY_MARKERS: readonly string[] = [" on @", " for @", " on user ", " for user "];

/** The separator an entity value is folded back onto the name with, when it turns out to BE the name. */
export const ENTITY_JOIN = " · ";

/** A recognised lifecycle word, and the title with it and its separator stripped. */
interface LifecycleMatch {
  readonly word: string;
  readonly remainder: string;
}

/**
 * Match a leading lifecycle word, or find none.
 *
 * Returns `undefined` when there is no lifecycle word, which is how {@link ./alertTally.tallyAlerts} decides a message
 * is not a notification — so recognition, normalisation and severity all key off this ONE decision rather than three
 * that could disagree.
 *
 * @returns the matched lifecycle word and remainder, or undefined when the title does not begin with one
 */
export function matchLifecycleWord({ title }: { title: string }): LifecycleMatch | undefined {
  const folded = title.toLowerCase();
  const word = LIFECYCLE_WORDS.find((candidate) => folded.startsWith(candidate));
  if (word === undefined) {
    return undefined;
  }
  const after = title.slice(word.length);
  // A lifecycle word must be followed by a separator or end the title. Without this, `okra pipeline stalled`
  // matches `ok` and is tallied as `ra pipeline stalled` — a real word colliding with a state name.
  if (after.length > 0 && !SEPARATORS.has(after[0]!)) {
    return undefined;
  }
  return { remainder: after, word };
}

/**
 * Handle an entity reference — and the decision is NOT simply to cut it.
 *
 * ## The mistake this replaces, found by running the verb against the real channel
 *
 * The ported design cut everything from ` on @` onward, on the reasoning that the tail carries a per-issue id and
 * would fragment one monitor into many rows. Measured against a week of a real alerts channel, that rule collapsed
 * FIVE distinct violations into a single row reading `Integrity Audit — Invariant violation`, because the tail was
 * `@invariant:<name>` and the name after the colon was the only thing telling them apart. The owner's ask was
 * literally *"a breakdown of the invariants"*, so the rule deleted precisely the axis the owner wanted.
 *
 * ## The rule that replaces it: a DIGIT is what makes a tail per-occurrence
 *
 * A stable key — `order_missing_timestamp`, `validateInvoiceLinesRequireTotal` — is part of the
 * alert's identity and is folded back onto the name. A value carrying a digit — `node-7`, `4471`, a build number,
 * a request id — is one occurrence of it, and is cut. That is a shape test rather than a guess about meaning, and
 * every case is pinned in `alertTally.test.ts`.
 *
 * A name is not the value alone, because two monitors can key on the same field: the monitor's own words stay in
 * front so `guard · x` and `invariant · x` remain different rows.
 */
function withoutEntityTail({ title }: { title: string }): string {
  const folded = title.toLowerCase();
  const cuts = ENTITY_MARKERS.map((marker) => ({ at: folded.indexOf(marker), width: marker.length })).filter(
    (cut) => cut.at >= 0,
  );
  const first = cuts.toSorted((left, right) => left.at - right.at)[0];
  if (first === undefined) {
    return title;
  }
  const head = title.slice(0, first.at);
  const tail = title.slice(first.at + first.width);
  // The value is what follows the LAST `key:` in the reference. `@invariant:order_missing` → `order_missing`.
  const colon = tail.lastIndexOf(":");
  const value = colon < 0 ? tail : tail.slice(colon + 1);
  return /\d/.test(value) || value.trim().length === 0 ? head : `${head}${ENTITY_JOIN}${value.trim()}`;
}

/**
 * Drop a trailing bracketed group that carries a digit — `(id 4471)`, `[build 88]`, `(web-3)`.
 *
 * The digit is the test rather than the brackets, because a parenthesised WORD is usually part of the name a
 * person gave the monitor (`(staging)`, `(p99)`) while a parenthesised number is almost always the occurrence.
 * Applied once, not in a loop: one dynamic suffix is the observed shape, and repeating would eat a legitimate
 * `(staging)` sitting in front of an instance id.
 */
function withoutBracketedOccurrence({ title }: { title: string }): string {
  const closers = { "(": ")", "[": "]" } as const;
  const openers: readonly (keyof typeof closers)[] = ["(", "["];
  const last = title.trimEnd();
  const closer = last.slice(-1);
  const opener = openers.find((key) => closers[key] === closer);
  if (opener === undefined) {
    return title;
  }
  const at = last.lastIndexOf(opener);
  if (at < 0) {
    return title;
  }
  const inside = last.slice(at + 1, -1);
  return /\d/.test(inside) ? last.slice(0, at) : title;
}

/** Drop a trailing `#<n>`, which numbers the occurrence rather than naming the monitor. */
function withoutTrailingNumber({ title }: { title: string }): string {
  const trimmed = title.trimEnd();
  const at = trimmed.lastIndexOf("#");
  if (at < 0 || at === trimmed.length - 1) {
    return title;
  }
  const after = trimmed.slice(at + 1);
  return /^\d+$/.test(after) ? trimmed.slice(0, at) : title;
}

/**
 * Collapse every whitespace run to one space and drop separators dangling at EITHER end.
 *
 * Both ends, because the two cuts leave them in different places: stripping the lifecycle word leaves the colon
 * that followed it at the front (`Triggered: disk writes` → `: disk writes`), while cutting an entity tail leaves
 * the dash that introduced it at the back. Trimming only the tail was the first version of this, and it tallied a
 * whole channel under names beginning `: ` — which reads as a formatting slip and is actually a different row key.
 */
function tidy({ title }: { title: string }): string {
  const collapsed = title
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .join(" ");
  let start = 0;
  let end = collapsed.length;
  while (end > start && SEPARATORS.has(collapsed[end - 1]!)) {
    end -= 1;
  }
  while (start < end && SEPARATORS.has(collapsed[start]!)) {
    start += 1;
  }
  return collapsed.slice(start, end).trim();
}

/**
 * Normalise a raw notification title to the STABLE name one monitor is tallied under.
 *
 * Exported because it is the decision that determines what counts as "the same alert", which is the tally's most
 * consequential judgement and the one most worth pinning case by case. It returns the name UNBOUNDED: what counts
 * as the same alert is a question about identity, and the card's row-label width is not part of the answer.
 * {@link ./alertTally.tallyAlerts} condenses and then bounds.
 *
 * @param title the raw notification title
 * @returns the stable name, or undefined when the title carries no lifecycle word (so it is not a notification)
 */
export function normaliseAlertName({ title }: { title: string }): string | undefined {
  const match = matchLifecycleWord({ title: title.trim() });
  if (match === undefined) {
    return undefined;
  }
  const name = tidy({
    title: withoutTrailingNumber({
      title: withoutBracketedOccurrence({ title: withoutEntityTail({ title: match.remainder }) }),
    }),
  });
  // A title that was ONLY a lifecycle word normalises to nothing. It is not a row and it is not silently dropped
  // either — the caller counts it as skipped, because a bare `Recovered:` names no monitor to attribute it to.
  return name.length === 0 ? undefined : name;
}
