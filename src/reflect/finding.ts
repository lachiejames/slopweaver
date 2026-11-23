/**
 * What the reflection loop's miner FINDS, and the two derivations that make a finding comparable across
 * days: its stable identity, and its score.
 *
 * ## Why identity is a hash of three fields and not of the whole row
 *
 * The loop's whole value is recurrence — "this happened again today" is a stronger finding than anything
 * that happened once, because it means the knowledge is not reaching the point of use. That reading is only
 * available if the same friction produces the same id on two different days. A count moves every run, a
 * timestamp moves every run, and a summary that interpolates either one moves with it, so the id is derived
 * from {@link FrictionFinding.source}, {@link FrictionFinding.classKey} and {@link FrictionFinding.locus}
 * and from nothing else. The design says this in one line — keyed on a content hash of only the STABLE
 * signal fields, a moving count must not mint a fresh id every run — and it is a ship condition rather than
 * a nicety, because a loop that re-mints ids re-proposes what the owner already dropped.
 *
 * ## Why the class key is mechanical rather than clever
 *
 * No model runs in this program (AGENTS.md rule 2), so "are these two frictions the same kind of thing" has
 * to be answered by pure code. {@link classKeyOf} answers it the cheapest falsifiable way: normalise, drop
 * the tokens that are identifiers rather than words, keep a bounded sorted set of what is left. It
 * over-merges at the edges and it is supposed to — a class that is slightly too broad surfaces one finding
 * naming several instances, while a class that is too narrow surfaces the same friction five times and
 * spends the whole five-a-run cap on it.
 *
 * Pure: no filesystem, no clock, no network. Every input is passed in.
 */
import { createHash } from "node:crypto";

/**
 * Which substrate a finding came from. The unit the per-source share of the cap and the grade distribution
 * are both computed over, so a collector the owner keeps dropping becomes visibly a bad collector.
 *
 * `door-holds` is deliberately narrow: it reads `door_event`'s `attributed` rows for `hold` and `overridden`
 * alone. Most of the door ledger's history is test-suite writes into the operator's home, which the
 * `provenance` column separates (`../store/fleet/doorEvent.ts`), and a pass/warn count would still describe
 * the suite as much as the operator.
 */
export type ReflectSource =
  | "asked-for-missing"
  | "dev-gate"
  | "door-holds"
  | "feedback-drafts"
  | "pain-points"
  | "pr-proof"
  | "review-claims"
  | "run-journal";

/** Every source, in the order a brief prints them. The one list; collectors and the fold both read it. */
export const REFLECT_SOURCES = [
  "run-journal",
  "review-claims",
  "dev-gate",
  "pain-points",
  "feedback-drafts",
  "pr-proof",
  "door-holds",
  "asked-for-missing",
] as const satisfies readonly ReflectSource[];

/**
 * The highest any of the three scoring dials goes. A dial is 1..5; nothing is worth a zero or a six.
 *
 * @internal
 */
export const DIAL_MAX = 5;

/**
 * The lowest any of the dials goes. `cost` divides, so a zero would be an infinite score.
 *
 * @internal
 */
export const DIAL_MIN = 1;

/**
 * One piece of friction, as pure code found it.
 *
 * `occurrences`, `firstSeenIso` and `lastSeenIso` describe THIS window and are deliberately not part of the
 * identity — see the module header.
 */
export interface FrictionFinding {
  /** Which substrate produced it. */
  readonly source: ReflectSource;
  /** What KIND of friction this is, stable across runs. Half of the identity. */
  readonly classKey: string;
  /** Where it was seen, as something a reader can go and look at — a check name, a verb, a path. */
  readonly locus: string;
  /** What happened, in the collector's own terms. Below the consequence; may interpolate a count. */
  readonly summary: string;
  /**
   * What this friction MEASURABLY cost the owner or the fleet, in plain words — the line a finding opens on —
   * or `undefined` when nothing the collector read measures one.
   *
   * A finding that leads with a locus and a score asks the owner to translate it into impact themselves, so
   * they cannot grade it; it has to lead with the impact. So a finding with no measured consequence is never
   * surfaced for a grade (`./rank.ts`) — it is held and counted instead. Required rather than optional so every collector makes that call explicitly.
   * Never part of the identity: it interpolates measurements that move every run.
   */
  readonly consequence: string | undefined;
  /** How many times the window saw it. Never part of the identity. */
  readonly occurrences: number;
  /** The earliest instant in this window. */
  readonly firstSeenIso: string;
  /** The latest instant in this window. */
  readonly lastSeenIso: string;
  /** Evidence lines, collapsed below the fold by rule 7. Bounded by the collector, never by the renderer. */
  readonly evidence: readonly string[];
  /** How much it costs to keep having this problem, 1..5. */
  readonly impact: number;
  /** How safely a fix could be made — high when the fix is mechanically checkable, 1..5. */
  readonly safety: number;
  /** How much the fix costs, 1..5. Divides, so it is never zero. */
  readonly cost: number;
  /**
   * Board docs that already cover this, from the Tier 2 cross-reference. Never a reason to drop a finding —
   * a graded hand-run ranked a boarded finding SECOND — but it is why one is demoted below an equivalent
   * finding nobody has planned yet. Empty until `crossReference` has run.
   */
  readonly coveredBy: readonly string[];
  /**
   * Memories that already record this. A friction recurring DESPITE an existing memory is a STRONGER
   * finding, not a duplicate: it means the knowledge is not reaching the point of use.
   */
  readonly knownBy: readonly string[];
  /**
   * Classes the recurring-failure register records as REFUTED — examined once, with the reason written
   * down. Demotes like {@link FrictionFinding.coveredBy} and for the same reason it never removes: a
   * refutation can go stale (one that says "no seam exists" outlives the code it was true of), so the
   * finding still reaches the owner carrying what killed it last time.
   */
  readonly refutedBy: readonly string[];
}

/** Tokens that carry no class information, so two frictions differing only in these are the same class. */
const STOPWORDS = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "had",
  "has",
  "have",
  "into",
  "its",
  "not",
  "over",
  "that",
  "the",
  "then",
  "this",
  "was",
  "were",
  "when",
  "which",
  "with",
]);

/**
 * How many tokens a class key keeps. Enough to separate real classes, few enough to merge re-wordings.
 *
 * @internal
 */
export const CLASS_KEY_TOKENS = 6;

/** The shortest token worth keeping. Two-letter fragments merge unrelated classes rather than separating. */
const MIN_TOKEN_LENGTH = 3;

/** A token that is an identifier rather than a word: a run id, a sha, a hex digest, a bare number. */
function isIdentifier({ token }: { token: string }): boolean {
  return /^[0-9]+$/.test(token) || (token.length >= 7 && /^[0-9a-f]+$/.test(token));
}

/**
 * Reduce free prose to the stable class it belongs to.
 *
 * Deterministic and total: any string produces a key, and a string with nothing classifiable in it produces
 * the empty key, which callers pair with their own discriminator so an unclassifiable line still lands
 * somewhere findable rather than colliding with every other unclassifiable line.
 *
 * @param text the prose to classify — a gate summary, an amendment reason, a reviewed claim
 * @param limit how many tokens survive into the key
 * @returns the class key, lowercase and dash-joined, or the empty string when nothing survived
 */
export function classKeyOf({ text, limit = CLASS_KEY_TOKENS }: { text: string; limit?: number }): string {
  const tokens = text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token) && !isIdentifier({ token }));
  return [...new Set(tokens)]
    .toSorted((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, limit)
    .toSorted((a, b) => a.localeCompare(b))
    .join("-");
}

/**
 * The friction classes this pass can NAME, over this repository's own vocabulary. First match wins, so the
 * most specific entry comes first.
 *
 * ## Why a table exists at all, and why it is small
 *
 * {@link classKeyOf} alone cannot merge two amendments that describe the same defect in different prose:
 * measured over 43 amendments in one 24h window, its longest-token key produced a
 * near-unique class per amendment, so the day's dominant defect read as one occurrence of forty-three
 * classes. Reproduce the measurement with:
 *
 * ```
 * cat ~/.slopweaver/runs/*.jsonl | jq -r 'select(.kind=="amended") | .why' | tr 'A-Z ' 'a-z\n' | sort | uniq -c | sort -rn | head -40
 * ```
 *
 * That run showed `donewhen` in 18 of 43 and `probe` in 15 — one real, recurring class, which is exactly
 * the finding the owner ranked FIRST on a graded hand-run. `scope`/`scoped`/`scopes`/`rescoped`/`descoped`
 * and `correction`/`corrections`/`corrected` were added the same way: 67 of 600 amendments in the runs
 * directory carried each, measured with the same `jq`-and-`sort` shape above swapped to `grep -c`.
 * So the table names the classes the data already shows, and nothing else. It is not a taxonomy and it must
 * not grow into one: an entry earns its place by a measurement.
 *
 * A text matching nothing here falls back differently depending on the caller: {@link namedClassOf} falls
 * back to the general {@link classKeyOf} key, which makes a miss a class that is too NARROW rather than one
 * that is wrong — right for a substrate whose recurring phrasing is close to verbatim. {@link
 * namedClassOrOther} falls back to a caller-stated `other` instead, for the one substrate (a run-journal
 * amendment's freely-worded `why`) where that general key mints a near-unique class per event; see its own
 * doc comment for the measurement.
 *
 * @internal
 */
export const NAMED_FRICTION_CLASSES = [
  { all: ["donewhen", "filter"], name: "donewhen-probe-named-a-flag-that-does-not-exist" },
  { all: ["donewhen", "probed"], name: "donewhen-probes-covered-less-than-the-doc-promised" },
  { all: ["donewhen", "registered"], name: "donewhen-probes-registered-after-the-run-opened" },
  { all: ["donewhen"], name: "donewhen-probe-did-not-describe-the-work" },
  { all: ["owner", "ruling"], name: "owner-ruling-arrived-mid-run" },
  { all: ["correction"], name: "a-correction-was-recorded" },
  { all: ["corrections"], name: "a-correction-was-recorded" },
  { all: ["corrected"], name: "a-correction-was-recorded" },
  { all: ["scope"], name: "scope-changed-mid-run" },
  { all: ["scoped"], name: "scope-changed-mid-run" },
  { all: ["scopes"], name: "scope-changed-mid-run" },
  { all: ["rescoped"], name: "scope-changed-mid-run" },
  { all: ["descoped"], name: "scope-changed-mid-run" },
] as const satisfies readonly { readonly all: readonly string[]; readonly name: string }[];

/**
 * The {@link NAMED_FRICTION_CLASSES} entry a text matches, or `undefined` when none does. The shared core of
 * {@link namedClassOf} and {@link namedClassOrOther} — the two differ only in what they fall back to.
 *
 * @internal
 * @param text the prose to classify
 * @returns the matched class name, or `undefined`
 */
function matchedNamedClass({ text }: { text: string }): string | undefined {
  const tokens = new Set(
    text
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, " ")
      .split(" "),
  );
  return NAMED_FRICTION_CLASSES.find((entry) => entry.all.every((token) => tokens.has(token)))?.name;
}

/**
 * The named class a text belongs to, or the general token key when it belongs to none.
 *
 * This is what every collector calls; {@link classKeyOf} remains exported because it is the fallback and
 * because it is what a test asserts the fallback's behaviour on.
 *
 * @param text the prose to classify
 * @returns the named class, or the general key, or the empty string when neither found anything
 */
export function namedClassOf({ text }: { text: string }): string {
  const present = matchedNamedClass({ text });
  if (present === undefined) {
    return classKeyOf({ text });
  }
  return present;
}

/**
 * The named class a text belongs to, or one honest catch-all when it belongs to none — never a per-event mash
 * of the text's own words. {@link namedClassOf}'s fallback to {@link classKeyOf} is right for a substrate
 * whose recurring phrasing is genuinely close to verbatim (a dev-gate summary, a pain-point reason); a
 * run-journal amendment's `why` is free prose an agent writes fresh every time, so that same fallback mints a
 * near-unique key per event — MEASURED over one window: 30 of 64 candidate classes were `run-journal`
 * singletons that can never recur, because each one's key was built from its own one-off words. Pairing every
 * unmatched amendment with the same `other` key instead means they fold into one honest finding that carries
 * its examples as evidence, rather than each permanently occupying its own ranked-backlog slot.
 *
 * @param text the prose to classify
 * @param other the class to use when nothing in {@link NAMED_FRICTION_CLASSES} matches
 * @returns the named class, or `other`
 */
export function namedClassOrOther({ text, other }: { text: string; other: string }): string {
  const named = matchedNamedClass({ text });
  // No named class matched, so the amendment folds into the caller's one honest catch-all class.
  if (named === undefined) {
    return other;
  }
  return named;
}

/** How many hex characters of the identity digest are kept. Short enough to print in a brief. */
const ID_LENGTH = 12;

/**
 * The stable identity of a finding.
 *
 * Reads exactly three fields. Passing a whole {@link FrictionFinding} is the ordinary call; the narrow
 * parameter type is what makes it impossible for a caller to hash a count by accident.
 *
 * @param signal the three fields identity is derived from
 * @returns a short hex id, stable for as long as the friction is the same kind of thing in the same place
 */
export function findingId({
  signal,
}: {
  signal: { readonly source: ReflectSource; readonly classKey: string; readonly locus: string };
}): string {
  return createHash("sha256")
    .update(`${signal.source} ${signal.classKey} ${signal.locus}`)
    .digest("hex")
    .slice(0, ID_LENGTH);
}

/**
 * Clamp a dial into the closed range the score is defined over. Collectors compute dials arithmetically, so
 * this is the one place an off-by-one stops rather than becoming an infinite or a negative score.
 *
 * @param value the raw dial value
 * @returns the value rounded and clamped into 1..5
 */
export function clampDial({ value }: { value: number }): number {
  return Math.min(DIAL_MAX, Math.max(DIAL_MIN, Math.round(value)));
}

/**
 * The rank, exactly as the design states it: impact times safety, divided by cost.
 *
 * Chosen because it is falsifiable and stable across runs, not because it is clever. Recurrence does not
 * appear here — it enters through {@link recurringImpact}, which raises `impact` before the score is taken,
 * so a brief can print "impact 3 up from 2, seen on 3 days" and a reader can check the arithmetic.
 *
 * @param finding the finding to score
 * @returns the score, higher first
 */
export function scoreOf({ finding }: { finding: FrictionFinding }): number {
  return (finding.impact * finding.safety) / finding.cost;
}

/** Occurrences within one window at which a finding is a pattern rather than an instance. */
const REPEAT_STEP = 3;

/** Occurrences within one window at which a finding is the window's dominant noise. */
const FLOOD_STEP = 10;

/** Distinct days at which a finding has survived a night, so somebody chose not to fix it. */
const RECURRENCE_STEP = 2;

/** Distinct days at which a finding is chronic — it has outlived a working week of chances to be fixed. */
const CHRONIC_STEP = 5;

/**
 * Raise a base impact by what the window saw and by what the seen-ledger remembers.
 *
 * The rule: ONE persisted per-finding counter, no second cadence, and the daily
 * pass must carry state across days rather than re-derive it. `daysSeen` is that counter, folded out of the
 * seen-ledger; `occurrences` is this window alone. Both lift impact, both are bounded, and the lift is
 * printed in the brief so it can be graded rather than trusted.
 *
 * @param base the collector's own reading of how much this class costs
 * @param occurrences how many times this window saw it
 * @param daysSeen distinct days the seen-ledger has surfaced it on, this run included
 * @returns the lifted impact, clamped into the dial range
 */
export function recurringImpact({
  base,
  occurrences,
  daysSeen,
}: {
  base: number;
  occurrences: number;
  daysSeen: number;
}): number {
  const repeat = (occurrences >= REPEAT_STEP ? 1 : 0) + (occurrences >= FLOOD_STEP ? 1 : 0);
  const chronic = (daysSeen >= RECURRENCE_STEP ? 1 : 0) + (daysSeen >= CHRONIC_STEP ? 1 : 0);
  return clampDial({ value: base + repeat + chronic });
}

/** Whether a finding is a one-off the owner can accept, or a pattern that keeps costing. */
export type FindingPattern = "one-off" | "systemic";

/**
 * One-off or systemic, by the same two thresholds {@link recurringImpact} lifts impact on, so the word a card
 * prints and the ranking it sits in can never disagree about what counts as recurring.
 *
 * The owner's test: a one-off is probably accepted; a systemic problem is where the waste is.
 *
 * @param occurrences how many times this window saw it
 * @param daysSeen distinct days the seen-ledger has it on, this run included
 * @returns `systemic` when it repeated inside the window or survived a night, else `one-off`
 */
export function findingPattern({ occurrences, daysSeen }: { occurrences: number; daysSeen: number }): FindingPattern {
  if (occurrences >= REPEAT_STEP || daysSeen >= RECURRENCE_STEP) {
    return "systemic";
  }
  return "one-off";
}

/** `once` for one, `N times` otherwise. */
function times({ count }: { count: number }): string {
  return count === 1 ? "once" : `${String(count)} times`;
}

/**
 * The one line under a card's consequence that answers "is this systemic or a one-off", with the counts it
 * was decided on: `SYSTEMIC — 4 times this window, seen on 3 different days in all`.
 *
 * `daysSeen` counts the days the miner ran and found it, not the days it happened, so it says "seen on".
 *
 * @param occurrences how many times this window saw it
 * @param daysSeen distinct days the seen-ledger has it on, this run included
 * @returns the line
 */
export function patternSentence({ occurrences, daysSeen }: { occurrences: number; daysSeen: number }): string {
  const word = findingPattern({ daysSeen, occurrences }) === "systemic" ? "SYSTEMIC" : "ONE-OFF";
  const days = daysSeen === 1 ? "seen on 1 day" : `seen on ${String(daysSeen)} different days in all`;
  return `${word} — ${times({ count: occurrences })} this window, ${days}`;
}

/**
 * Whether a finding states a measured consequence at all — the bar a finding clears before it is put in
 * front of the owner to grade. Blank prose is no consequence.
 *
 * @param finding the finding to test
 * @returns whether its consequence is present and non-blank
 */
export function hasConsequence({ finding }: { finding: Pick<FrictionFinding, "consequence"> }): boolean {
  return finding.consequence !== undefined && finding.consequence.trim() !== "";
}
