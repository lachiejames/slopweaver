/**
 * CHECK 6 — the adversarial arm, and the strictness bar that runs before it.
 *
 * Pure. No model, anywhere (AGENTS.md rule 2): "adversarial" here means a mechanical attempt to REFUTE a drop
 * before it is proposed, mirroring the register mining pass — `docs/recurring-failure-register.md` records
 * every failure class an adversarial pass examined and KILLED, with the reason, and `reflect/registerDoc.ts`
 * gives that a heading of its own.
 *
 * ## The order is the design: bar first, then arm
 *
 * The **bar** is a hard filter on ELIGIBILITY. It answers "may this memory be proposed for deletion at all",
 * from the owner's strictness ruling — identity, voice and hard rules STAY; techniques go to skills; project state
 * goes to the profile — anchored at the `memory-strictness-bar` memory. This build does
 * not re-derive that ruling and must not: it encodes it.
 *
 * The **arm** then attacks whatever survives, one rule at a time, and the FIRST rule that lands demotes the
 * proposal. Both are demotions and neither removes, because — `reflect/crossRef.ts`'s own words — a
 * refutation "can go stale, so it is printed rather than obeyed". The card shows what killed a drop, so a
 * refutation that has itself gone stale is visible rather than silently binding.
 *
 * ## Why a demotion and never a deletion of the proposal
 *
 * A refuted drop is still usually a real observation: two memories that overlap and must not be merged are
 * still worth consolidating, and a memory whose path moved still needs the new path. Demoting to `adjust`
 * keeps the observation and drops only the recommendation the arm disproved. Two rules demote all the way to
 * `keep`, and each is a case where the PREMISE was false rather than the remedy wrong.
 */
import type { MemoryLeaf, MemorySweepRow } from "../types.js";
import type { Enforcer } from "./enforcement.js";
import type { HygieneRecommendation, HygieneRefutation } from "./types.js";

/** A date a human wrote, as this repository writes owner rulings: day, month name, four-digit year. */
const RULING_DATE = /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d\d\b/;

/** A verbatim quotation — the owner's own words, which no gate carries. Both quote conventions in use here. */
const VERBATIM_QUOTE = /["“‘’”]/;

/** The house spelling for a memory that records WHY, per this install's memory-writing instructions. */
const WHY_LINE = /\*\*Why:\*\*/;

/** Why one memory may not be proposed for deletion at all. */
export interface BarExemption {
  /** A stable machine id for the bar rule, so two runs name it identically. */
  readonly rule: string;
  readonly detail: string;
}

/**
 * Whether the strictness bar makes this memory ineligible for a `drop` recommendation.
 *
 * Every rule here is a crossing of the owner's ruling or of a live mechanism, never a judgement about the memory's
 * content — which is the thing this pass is not allowed to make.
 *
 * @param leaf the parsed memory
 * @param row the same memory's sweep row, which is where inbound link counts live
 * @returns the first exemption that applies, or `null` when the memory may be proposed for deletion
 */
export function barExemption({ leaf, row }: { leaf: MemoryLeaf; row: MemorySweepRow }): BarExemption | null {
  if (leaf.declaredType === "user") {
    return {
      detail: "a `user` memory is identity, and the strictness bar says identity stays",
      rule: "bar-identity",
    };
  }
  if (leaf.ownerDirective === true) {
    return {
      detail:
        "it is a live owner directive, mirrored into the store's `owner_directive` table; the revocation path " +
        "is an explicit `ownerDirective: false` on the memory itself, never a deletion proposed by a tool",
      rule: "bar-owner-directive",
    };
  }
  if (leaf.correctionSubject !== null) {
    return {
      detail: "it corrects one named corpus record, and that record is still out there to be read",
      rule: "bar-correction",
    };
  }
  if (row.inboundLinks > 0) {
    return {
      detail: `${String(row.inboundLinks)} other memory(s) wikilink to it — dropping it mints dangling wikilinks`,
      rule: "bar-inbound-links",
    };
  }
  return null;
}

/**
 * Whether a memory carries something no enforcer does — a ruling date, a verbatim quotation, or a `**Why:**`.
 *
 * This is the arm's most important rule. A gate refuses a mistake; it does not record why the owner wanted it
 * refused, and the WHY is the part a session cannot re-derive. A memory holding one is not a restatement of
 * the gate at all, so the enforcement check's premise was false and the recommendation goes to `keep`.
 *
 * @param text the memory's full text
 * @returns the refutation, or `null` when the memory carries none of the three
 */
export function carriesIrreducibleWhy({ text }: { text: string }): HygieneRefutation | null {
  if (RULING_DATE.test(text)) {
    return {
      detail: "it dates an owner ruling, which no gate or always-on doc carries",
      rule: "carries-ruling-date",
    };
  }
  if (WHY_LINE.test(text)) {
    return { detail: "it records a `**Why:**`, which is the half an enforcer cannot hold", rule: "carries-why" };
  }
  if (VERBATIM_QUOTE.test(text)) {
    return { detail: "it quotes something verbatim, so it holds words rather than a rule", rule: "carries-quote" };
  }
  return null;
}

/** The arm's verdict on one drop candidate: what it should be recommended as, and everything against it. */
export interface RefutedRecommendation {
  readonly recommendation: HygieneRecommendation;
  readonly refutations: readonly HygieneRefutation[];
}

/**
 * Attack a drop candidate raised by the ENFORCEMENT check.
 *
 * @param text the memory's full text
 * @param enforcers the enforcers that matched it
 * @returns `drop` with no refutations when the arm found nothing, else the demoted recommendation
 */
export function refuteEnforcementDrop({
  text,
  enforcers,
}: {
  text: string;
  enforcers: readonly Enforcer[];
}): RefutedRecommendation {
  const scopedOnly = enforcers.every((enforcer) => enforcer.kind === "scoped-rule");
  if (scopedOnly) {
    return {
      recommendation: "keep",
      refutations: [
        {
          detail:
            "every match was a `paths:`-scoped rule, which only loads when a session touches matching files — " +
            "so the memory does change behaviour everywhere else and the premise was false",
          rule: "enforcer-is-scoped",
        },
      ],
    };
  }
  const why = carriesIrreducibleWhy({ text });
  if (why !== null) {
    return { recommendation: "keep", refutations: [why] };
  }
  return { recommendation: "drop", refutations: [] };
}

/**
 * Attack a drop candidate raised by the DUPLICATE scan.
 *
 * A duplicate pair is never proposed as a `drop` of one side by this pass — deciding which of two memories
 * survives is a judgement about content, and the whole design says that judgement is the owner's. What the arm
 * settles is whether the pair is a CONSOLIDATION (`adjust`) or is not a pair at all (`keep`).
 *
 * @param left the first memory's sweep row
 * @param right the second memory's sweep row
 * @returns `adjust` with no refutations when the pair stands, else `keep` with what broke it
 */
export function refuteDuplicatePair({
  left,
  right,
}: {
  left: MemorySweepRow;
  right: MemorySweepRow;
}): RefutedRecommendation {
  if (left.declaredType !== right.declaredType) {
    return {
      recommendation: "keep",
      refutations: [
        {
          detail:
            `they declare different types (${String(left.declaredType)} and ${String(right.declaredType)}), ` +
            "so they are two kinds of fact sharing a vocabulary rather than one fact written twice",
          rule: "pair-different-types",
        },
      ],
    };
  }
  const routesOverlap = left.routedBy.some((index) => right.routedBy.includes(index));
  if (left.routedBy.length > 0 && right.routedBy.length > 0 && !routesOverlap) {
    return {
      recommendation: "adjust",
      refutations: [
        {
          detail:
            `they are routed by different indexes (${left.routedBy.join(" + ")} and ${right.routedBy.join(" + ")}), ` +
            "so a merge has to keep both routes or one topic loses its entry",
          rule: "pair-different-routes",
        },
      ],
    };
  }
  return { recommendation: "adjust", refutations: [] };
}

/**
 * What a stale referent should be recommended as.
 *
 * A moved referent is always an `adjust` — the memory needs the new path and its claim may be perfectly true.
 * A vanished one is an `adjust` too, and deliberately not a `drop`: what is stale is one sentence, and the
 * memory may hold three other true facts. Only the ENFORCEMENT check ever proposes a `drop`, because it is
 * the only one whose finding is about the memory AS A WHOLE.
 *
 * @param verdict what the tree said about the referent
 * @returns the recommendation, with the moved case carrying its own note
 */
export function referentRecommendation({ verdict }: { verdict: "moved" | "gone" }): RefutedRecommendation {
  if (verdict === "moved") {
    return {
      recommendation: "adjust",
      refutations: [
        {
          detail:
            "a file of that name exists elsewhere in the tree — it MOVED, so the path is stale and the claim may not be",
          rule: "referent-moved-not-gone",
        },
      ],
    };
  }
  return { recommendation: "adjust", refutations: [] };
}
