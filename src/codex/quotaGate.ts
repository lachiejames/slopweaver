/**
 * The pure decision this whole feature exists to make: given whatever quota evidence is available, should
 * `cmux spawn --driver codex` refuse before booting anything?
 *
 * Two sources can supply evidence — the cached record `quotaCache.ts` last wrote, and a fresh read of
 * Codex's own rollout log via `quotaLog.ts` — and this module never prefers one over the other by SOURCE.
 * It prefers whichever is more RECENT (`mostRecentEvidence`).
 *
 * ## Self-healing is real now, and it was not before
 *
 * This header used to say a real refill self-heals a stale cache, "once some other Codex invocation anywhere
 * writes a healthier snapshot, that snapshot's timestamp beats the cache's". It could not. The rollout
 * reader returned exhaustion or nothing, so a healthy line produced `undefined`, `mostRecentEvidence` was
 * left with the cached cap as its only candidate, and the refusal stood until someone cleared it by hand.
 * The sentence was a description of an intention. {@link survivingEvidence} is the mechanism that makes it
 * true, and it needs a {@link ../codex/quotaTypes.CodexQuotaObservation} — a reading that reports HEALTHY as
 * a fact rather than as an absence.
 *
 * ## Recovery is SCOPED, because the two limit ids disagree constantly
 *
 * MEASURED: every one of this machine's 93 exhaustion events carries `"limit_id":"premium"` and
 * every one of its 80,841 ordinary readings carries `"limit_id":"codex"`. A `codex` reading is written by
 * the very next turn after a `premium` cap, so an unscoped "newest healthy wins" rule would lift every real
 * cap within seconds of it appearing. A healthy observation therefore clears only evidence in its OWN scope.
 *
 * The residue, stated rather than discovered: evidence carrying no `limitId` — a banner scrape, a transport
 * fault's wording, a rollout `task_complete` spend-cap event, a cache row written before the field existed —
 * is unscoped, so no healthy observation can clear it. Clearing it on a scope it was never about would be the
 * failure above in the other direction.
 *
 * ## The explicit clear is a WATERMARK, because rollout evidence cannot be deleted
 *
 * What lifts unscoped evidence is the recovery the refusal names: `slopweaver codex quota clear`. It used to
 * delete the cached record and nothing else, so an unscoped cap read out of Codex's own rollout log — a file
 * Slopweaver never writes — answered "had no cached record" and kept refusing, excluding that destination
 * from routing while its live read showed 0% weekly use. The clear now also records a per-destination
 * instant, and {@link evidenceAfterClear} drops every NON-LIVE candidate observed in an earlier
 * millisecond. A cap observed in or after the clear's own millisecond refuses as before; live evidence is never filtered, because it is dated at the read.
 */
import { absentAsNumber } from "#lib/absent.js";
import { parseIsoMs } from "../lib/date.js";
import type { CodexQuotaEvidence, CodexQuotaObservation } from "./quotaTypes.js";

/** The gate's answer: refuse with a reason naming which exhaustion and how to recover, or allow. */
export type CodexQuotaDecision =
  | { readonly refuse: true; readonly reason: string; readonly evidence: CodexQuotaEvidence }
  | { readonly refuse: false };

/** Shown on every refusal — recovery is never "delete a JSON file by hand". */
const RECOVERY_HINT = "bypass once with --force, or run `slopweaver codex quota clear` once it's confirmed fixed";

/**
 * Pick whichever candidate was observed most recently.
 *
 * @param candidates every evidence source available, some possibly absent
 * @returns the most recent evidence, or undefined when every candidate was absent
 */
export function mostRecentEvidence({
  candidates,
}: {
  candidates: readonly (CodexQuotaEvidence | undefined)[];
}): CodexQuotaEvidence | undefined {
  const present = candidates.filter((candidate): candidate is CodexQuotaEvidence => candidate !== undefined);
  return present.reduce<CodexQuotaEvidence | undefined>(
    (latest, candidate) =>
      latest === undefined || strictlyLater({ earlier: latest.observedAtIso, later: candidate.observedAtIso })
        ? candidate
        : latest,
    undefined,
  );
}

/**
 * Whether `later` is a strictly later INSTANT than `earlier` — parsed, never compared as text.
 *
 * A Codex rollout timestamp is ISO-8601 and need not be UTC. An instant written with a `+01:00` offset sorts ABOVE
 * one written in `Z` form half an hour later as a string while being the EARLIER instant, so a lexical
 * comparison would let a reading taken before a cap clear it. An instant that will not parse clears nothing: an unreadable
 * timestamp is not evidence of recovery.
 *
 * @param earlier the instant that must come first for this to be false
 * @param later the candidate later instant
 * @returns true only when both parse and `later` is strictly after `earlier`
 */
function strictlyLater({ earlier, later }: { earlier: string; later: string }): boolean {
  const from = Date.parse(earlier);
  const to = Date.parse(later);
  return Number.isFinite(from) && Number.isFinite(to) && to > from;
}

/**
 * An observation instant as epoch milliseconds, with an unparseable one sorting OLDEST.
 *
 * `-Infinity` rather than `0` for the unreadable case: a piece of evidence whose timestamp cannot be read
 * must never win a freshness contest, and the epoch is a real instant that a 1970-dated row could tie with.
 *
 * @param instant the ISO-8601 instant to order by
 * @returns ms since the epoch, or `-Infinity` when it will not parse
 */
function observedMs({ instant }: { instant: string }): number {
  return absentAsNumber({ value: parseIsoMs({ tsIso: instant }), whenAbsent: Number.NEGATIVE_INFINITY });
}

/**
 * Whether `instant` is at or before `limit`, both parsed as instants.
 *
 * Returns FALSE when either will not parse, which is the fail-closed direction for its one caller: an
 * unreadable reset time is not proof that a window reopened.
 *
 * @param instant the instant being tested
 * @param limit the instant it must not be after
 * @returns true only when both parse and `instant` is at or before `limit`
 */
function atOrBefore({ instant, limit }: { instant: string; limit: string }): boolean {
  const at = Date.parse(instant);
  const bound = Date.parse(limit);
  return Number.isFinite(at) && Number.isFinite(bound) && at <= bound;
}

/**
 * Whether a clear at `clearedAtIso` covers evidence observed at `observedAtIso`: true only when both parse and
 * the observation's MILLISECOND is strictly earlier than the clear's.
 *
 * Strict on purpose. `Date.parse` keeps whole milliseconds, so two instants sharing one cannot be ordered from
 * it, and every attempt to order them on the digits past it met a format `Date.parse` also accepts (a Codex
 * review's chase: `.0001Z`, then a lowercase `t`). Evidence in the clear's own millisecond therefore keeps
 * refusing — the fail-closed direction — and no later spelling can be read as covered.
 *
 * @param observedAtIso when the evidence was observed
 * @param clearedAtIso the destination's recorded clear instant
 * @returns whether the clear disregards that evidence
 */
function coveredByClear({ clearedAtIso, observedAtIso }: { clearedAtIso: string; observedAtIso: string }): boolean {
  const observed = Date.parse(observedAtIso);
  const cleared = Date.parse(clearedAtIso);
  return Number.isFinite(observed) && Number.isFinite(cleared) && observed < cleared;
}

/**
 * The candidates an explicit `codex quota clear` has not disregarded: every present one not observed in a
 * millisecond strictly before the destination's clear instant, or all of them when no clear was ever recorded.
 *
 * Applied to the cached record and the rollout log's evidence only, never to live evidence — which is why it
 * is its own step rather than a rule inside {@link survivingEvidence}, which receives live evidence too. Both
 * instants are parsed and the direction is fail-closed: an unparseable observation instant is KEPT, an
 * unparseable clear instant clears nothing, and a tie is kept ({@link coveredByClear}).
 *
 * @param candidates the non-live evidence, some possibly absent
 * @param clearedAtIso when the destination was last explicitly cleared, or undefined when it never was
 * @returns the present candidates the clear does not cover, in their given order
 */
export function evidenceAfterClear({
  candidates,
  clearedAtIso,
}: {
  candidates: readonly (CodexQuotaEvidence | undefined)[];
  clearedAtIso: string | undefined;
}): readonly CodexQuotaEvidence[] {
  return candidates.filter(
    (candidate): candidate is CodexQuotaEvidence =>
      candidate !== undefined &&
      (clearedAtIso === undefined || !coveredByClear({ clearedAtIso, observedAtIso: candidate.observedAtIso })),
  );
}

/**
 * EVERY piece of evidence still standing once each has been tested against a newer healthy reading of its own
 * scope, newest first — empty when everything has been cleared.
 *
 * "Its own scope" is `limitId`, and the comparison is strict: an observation clears a piece of evidence only
 * when it read HEALTHY, names the SAME `limitId`, and was observed STRICTLY LATER. Equal instants do not
 * clear — two events sharing a millisecond cannot establish which came second, and reading a tie as recovery
 * would resolve every ambiguity in favour of spending.
 *
 * **It returns a LIST, and that is a correction.** It returned only the freshest survivor, and a Codex review
 * of that version found the hole with two real-shaped rows: an unscoped `credits-out` observed on the 11th
 * and a `window-limit` observed on the 12th whose window had since reopened. No healthy observation cleared
 * either — an unscoped cap cannot be cleared at all — but the newer one WON the freshness contest, its reset
 * had passed, and the gate allowed the spawn while a cap that nothing had lifted was still in force. Keeping
 * every survivor is what lets {@link resolveCodexQuotaDecisionAcross} refuse on any of them; collapsing to
 * one made a cap disappear behind a fresher, weaker one.
 *
 * @param candidates every piece of evidence available, from any source, some possibly absent
 * @param observations the readings to test them against — see {@link ../codex/quotaLog.readLatestCodexQuotaObservations}
 * @returns every uncleared piece of evidence, most recently observed first
 */
export function survivingEvidence({
  candidates,
  observations,
}: {
  candidates: readonly (CodexQuotaEvidence | undefined)[];
  observations: readonly CodexQuotaObservation[];
}): readonly CodexQuotaEvidence[] {
  const healthy = observations.filter((observation) => observation.evidence === undefined);
  const cleared = ({ evidence }: { evidence: CodexQuotaEvidence }): boolean =>
    evidence.limitId !== undefined &&
    healthy.some(
      (observation) =>
        observation.limitId === evidence.limitId &&
        strictlyLater({ earlier: evidence.observedAtIso, later: observation.observedAtIso }),
    );
  return candidates
    .filter(
      (candidate): candidate is CodexQuotaEvidence => candidate !== undefined && !cleared({ evidence: candidate }),
    )
    .toSorted(
      (left, right) => observedMs({ instant: right.observedAtIso }) - observedMs({ instant: left.observedAtIso }),
    );
}

/**
 * Decide across EVERY surviving piece of evidence: refuse on the first one that still refuses, else allow.
 *
 * The counterpart to {@link survivingEvidence} returning a list. A window-limit whose reset has passed is a
 * pass on ITS OWN terms and says nothing about a `credits-out` sitting beside it, so the only safe reading of
 * a set is "refuse if any member refuses". Walking newest-first means the refusal a caller is shown is the
 * most recently observed one, which is the one they can act on.
 *
 * @param evidence every uncleared piece of evidence, most recently observed first
 * @param nowIso the current instant, ISO-8601 — injected so a reset can be judged against a fixed clock
 * @returns the first refusal found, or a clear pass when nothing in the set still refuses
 */
export function resolveCodexQuotaDecisionAcross({
  evidence,
  nowIso,
}: {
  evidence: readonly CodexQuotaEvidence[];
  nowIso: string;
}): CodexQuotaDecision {
  for (const candidate of evidence) {
    const decision = resolveCodexQuotaDecision({ evidence: candidate, nowIso });
    if (decision.refuse) {
      return decision;
    }
  }
  return { refuse: false };
}

/**
 * Decide whether the given evidence should refuse a spawn.
 *
 * @param evidence the most recent quota evidence available (see {@link mostRecentEvidence}), or undefined
 * @param nowIso the current instant, ISO-8601 — injected so a weekly-limit reset can be judged against a
 *   fixed clock in tests rather than the real one
 * @returns the refusal (with its human-readable reason), or a clear pass
 */
export function resolveCodexQuotaDecision({
  evidence,
  nowIso,
}: {
  evidence: CodexQuotaEvidence | undefined;
  nowIso: string;
}): CodexQuotaDecision {
  if (evidence === undefined) {
    return { refuse: false };
  }
  if (evidence.kind === "credits-out") {
    return {
      evidence,
      reason: `Codex is out of credits (detected ${evidence.observedAtIso}) — ${RECOVERY_HINT}`,
      refuse: true,
    };
  }
  // Like `credits-out` and unlike `window-limit`, this one never self-clears on a clock: the event that
  // reports it carries both windows null, so there is no reset instant to compare `nowIso` against. Falling
  // through to the weekly branch would print a reset clause it cannot fill and, worse, would keep refusing
  // forever on an absent one. It lifts the same way `credits-out` does — a fresher healthy snapshot.
  if (evidence.kind === "usage-limit") {
    return {
      evidence,
      reason:
        `Codex reported a usage limit reached (detected ${evidence.observedAtIso}); the event names no ` +
        `window, so there is no reset to wait for — ${RECOVERY_HINT}`,
      refuse: true,
    };
  }
  // Parsed, not compared as text — see {@link strictlyLater}. A reset exactly EQUAL to now counts as passed,
  // which is this gate's standing behaviour and not something this change touched. Written as an explicit
  // "both parse, and reset is at or before now" rather than as `!strictlyLater(now, reset)`: the negated
  // form reads identically until the parse FAILS, and then clears a live cap on an unreadable timestamp.
  if (evidence.resetAtIso !== undefined && atOrBefore({ instant: evidence.resetAtIso, limit: nowIso })) {
    return { refuse: false };
  }
  const resetClause = evidence.resetAtIso === undefined ? "" : `, resets ${evidence.resetAtIso}`;
  const window =
    evidence.windowMinutes === undefined ? "a usage window" : `its ${String(evidence.windowMinutes)}-minute window`;
  return {
    evidence,
    reason: `Codex exhausted ${window} (detected ${evidence.observedAtIso}${resetClause}) — ${RECOVERY_HINT}`,
    refuse: true,
  };
}
