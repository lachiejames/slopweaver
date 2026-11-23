/**
 * Why a `self` entry was not ingested — the typed discovery channel.
 *
 * This module exists because of a measured defect, and it is the same defect
 * {@link ../notion/skips} was written for, one source over. {@link ./scan.entryAction} collapsed three
 * unrelated situations into one bare `"skip"` string and the walker then discarded it, so
 * {@link ./scan.scanSelfCorpus} reported only the files it READ. Its own comment said so outright:
 * *"Anything else under a root is skipped without comment."*
 *
 * Measured, six files in one root: two were read, a NUL-byte file was skipped AND named, and
 * `.org`, `.rst` and `.markdown` vanished — not counted, not named, not warned. Across the real roots,
 * roughly 4,890 files are ingested and roughly 1,999 declined without ever being mentioned.
 *
 * The same root now reports `saw 6 entr(ies): read 6 file(s)`, and every one of those six is retrievable.
 *
 * ## Why the existing conservation law could not catch it
 *
 * {@link ../../retrieval/coverage} asserts `ingested = indexed + Σ skipped` and it held perfectly the
 * whole time, because **`ingested` counts rows that were READ**. A file never read contributes to neither
 * side. The law is not wrong; it is scoped to everything AFTER discovery, and discovery is where this loss
 * happens. So the fix is not a wider law — it is a count of what the walk SAW, against what it took.
 *
 * ## Policy, guardrail and fault are three different facts
 *
 * A `readonly string[]` of warnings cannot express the difference, and the difference is what a reader
 * needs:
 *
 *  - **policy** — `unsupported-extension`, `symlink`, `inside-home`, `excluded-directory`. Deliberate and
 *    permanent. A run full of these is healthy, and a completeness check must treat them as ACCOUNTED FOR
 *    rather than lost. They are still counted, because "we decline 1,999 files" is a fact the owner is
 *    entitled to see before agreeing with it.
 *  - **guardrail** — `too-large`. Our own bound, not the filesystem's, and therefore the one class with an
 *    escape hatch: it names the environment variable that lifts it, per the house pattern of blocking by
 *    default and always offering a documented way through.
 *  - **fault** — `binary-content`, `unreadable`. Something was wrong with the entry or the disk. These are
 *    the ones a completeness check must refuse to call accounted for.
 *
 * Pure module — no I/O. The classifier is handed facts the walk already established.
 */

/** Why one `self` entry was not ingested. */
export type SelfSkipReason =
  | "excluded-path"
  | "unsupported-extension"
  | "symlink"
  | "inside-home"
  | "excluded-directory"
  | "too-large"
  | "binary-content"
  | "unreadable";

/** What KIND of fact a skip reason is — the distinction a completeness check branches on. */
export type SelfSkipClass = "policy" | "guardrail" | "fault";

/** One entry the walk saw and did not ingest, with the reason it did not. */
export interface SelfSkip {
  readonly reason: SelfSkipReason;
  /**
   * The entry's path RELATIVE to its root, POSIX-separated. Never absolute: a skip line is the kind of
   * output that gets pasted into a pull request, and an absolute path carries the owner's home directory.
   */
  readonly relPath: string;
  /** Extra fact worth carrying, e.g. the byte size that blew the ceiling. Empty when there is nothing to add. */
  readonly detail: string;
}

/** Which class each reason belongs to. Beside the type, so a new reason cannot go unclassified. */
const REASON_CLASS: Readonly<Record<SelfSkipReason, SelfSkipClass>> = {
  "binary-content": "fault",
  "excluded-directory": "policy",
  "excluded-path": "policy",
  "inside-home": "policy",
  symlink: "policy",
  "too-large": "guardrail",
  unreadable: "fault",
  "unsupported-extension": "policy",
};

/**
 * The order reasons are REPORTED in — faults first, then the guardrail, then the expected policy classes.
 *
 * Explicit rather than alphabetical, and for the same reason {@link ../notion/skips} declares its own:
 * `unsupported-extension` will usually be the largest count by an order of magnitude, so leading with it
 * buries the two lines that mean something went wrong. A declared order also makes two runs diffable, which
 * an alphabetical accident only does until a reason is renamed.
 */
const REASON_ORDER: readonly SelfSkipReason[] = [
  "unreadable",
  "binary-content",
  "too-large",
  "excluded-path",
  "unsupported-extension",
  "symlink",
  "inside-home",
  "excluded-directory",
];

/**
 * The environment variable that lifts the per-file size ceiling for one run. Set it to `1`.
 *
 * Declared HERE rather than beside the ceiling in {@link ./scan} so that {@link REASON_WORDING} can name it
 * without importing back from the module that already imports this one. That matters: a guardrail whose
 * message does not tell you how to get past it is a hard block wearing an escape hatch's clothes, which is
 * exactly what dogfooding caught — the variable was carried on the skip's `detail`, a field the summary
 * never rendered, so the operator was told a file was too large and nothing else.
 */
export const ALLOW_LARGE_FILES = "SLOPWEAVER_ALLOW_LARGE_FILES";

/** Human wording per reason, for the summary line. Beside the type so a new reason cannot go unworded. */
const REASON_WORDING: Readonly<Record<SelfSkipReason, string>> = {
  "binary-content": "control bytes are dense enough that this is a blob rather than prose",
  "excluded-directory": "inside a directory the walk never descends into (.git, node_modules, .cache, .venv)",
  "excluded-path": "under a path YOU excluded with --self-exclude",
  "inside-home": "inside the Slopweaver home, which is this engine's own output rather than your writing",
  symlink: "a symlink — never followed, so a link out of a root cannot widen the scan and one back in cannot loop",
  "too-large": `larger than the per-file ceiling — set ${ALLOW_LARGE_FILES}=1 to read it anyway`,
  unreadable: "could not be read at all",
  "unsupported-extension": "not one of the extensions the corpus is read from",
};

/** How many example paths a non-policy reason names, so the operator knows WHICH entry without a flood. */
const NAMED_EXAMPLES = 3;

/**
 * Which class a skip reason belongs to. Pure.
 *
 * @param reason the skip reason
 * @returns whether the skip is deliberate policy, our own guardrail, or a fault
 */
function selfSkipClass({ reason }: { reason: SelfSkipReason }): SelfSkipClass {
  return REASON_CLASS[reason];
}

/**
 * Whether a skip means something went WRONG, as opposed to something being deliberately declined. Pure.
 *
 * This is the predicate a completeness check branches on: a policy skip is accounted for, a fault is not.
 * The guardrail sits with policy rather than fault because it fired exactly as designed — but it is kept a
 * separate CLASS so a reader can see it and lift it, which is the whole point of an escape hatch.
 *
 * @param reason the skip reason
 * @returns true only for a fault
 */
export function selfSkipIsFault({ reason }: { reason: SelfSkipReason }): boolean {
  return selfSkipClass({ reason }) === "fault";
}

/**
 * Count skips per reason, in the fixed reason order so two runs are diffable. Pure.
 *
 * @param skips the collected skips
 * @returns one entry per reason that actually occurred, with its count and class
 */
export function countSelfSkips({ skips }: { skips: readonly SelfSkip[] }): readonly {
  reason: SelfSkipReason;
  count: number;
  skipClass: SelfSkipClass;
}[] {
  const counts = new Map<SelfSkipReason, number>();
  for (const skip of skips) {
    counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  }
  // The filter keeps only reasons the tally above holds, so each `get` below reads a present count.
  return REASON_ORDER.filter((reason) => counts.has(reason)).map((reason) => ({
    count: counts.get(reason)!,
    reason,
    skipClass: selfSkipClass({ reason }),
  }));
}

/**
 * The human summary of what the walk declined — ALWAYS at least one line, including for zero skips. Pure.
 *
 * A reported zero has to be a real zero, so the empty case gets an explicit line rather than silence: an
 * absent line is indistinguishable from a lane that never checked, which is the whole defect class this
 * module was written for.
 *
 * A non-policy reason also NAMES up to {@link NAMED_EXAMPLES} of the entries it declined. Policy reasons do
 * not, and the asymmetry is the point: `unsupported-extension` is routinely in the thousands and listing it
 * would bury everything, while a guardrail or a fault is something the operator may want to act on and
 * cannot act on without knowing which file it was.
 *
 * @param skips the collected skips
 * @returns the summary lines — a single "declined nothing" line when empty, else a total plus a per-reason
 *   breakdown naming what each reason means, which class it is, and — for a guardrail or fault — examples
 */
export function summariseSelfSkips({ skips }: { skips: readonly SelfSkip[] }): readonly string[] {
  if (skips.length === 0) {
    return ["declined: 0 entr(ies) — every entry the walk saw was read"];
  }
  const byReason = countSelfSkips({ skips });
  return [
    `declined: ${String(skips.length)} entr(ies) across ${String(byReason.length)} reason(s)`,
    ...byReason.flatMap(({ reason, count, skipClass }) => [
      `  ${reason} [${skipClass}]: ${String(count)} — ${REASON_WORDING[reason]}`,
      ...namedExamples({ reason, skipClass, skips }),
    ]),
  ];
}

/** Up to {@link NAMED_EXAMPLES} declined paths for a guardrail or fault reason; nothing for policy. */
function namedExamples({
  reason,
  skipClass,
  skips,
}: {
  reason: SelfSkipReason;
  skipClass: SelfSkipClass;
  skips: readonly SelfSkip[];
}): readonly string[] {
  if (skipClass === "policy") {
    return [];
  }
  return skips
    .filter((skip) => skip.reason === reason)
    .slice(0, NAMED_EXAMPLES)
    .map((skip) => `    ${skip.relPath}`);
}
