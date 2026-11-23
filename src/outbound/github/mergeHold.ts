/**
 * The MERGE HOLD — one pull request that owns the merge queue, and every decision about it, as pure
 * functions. The file it lives in is written by `./mergeHoldStore.ts`; nothing here touches the filesystem,
 * the network or the clock.
 *
 * ## Why a record rather than nine messages
 *
 * Measured over one night: a pull request was rebased twice because `main` moved under it while it
 * was in flight, and the only way to stop that happening a third time was for the supervisor to read
 * `ListAgents`, send one message per live session telling it to hold its merge, write a line into a state
 * doc, and then send a second round of messages carrying the landed SHA to release them. Nine hand-typed
 * messages, and a session that was mid-turn when its message arrived could miss it entirely.
 *
 * A message has to be READ. A refusal at the landing step cannot be missed, so a hold that refuses THERE
 * reaches every session at exactly the moment it matters, with no fan-out and nothing to remember.
 *
 * ## BOTH landing verbs, because doctrine names two of them
 *
 * {@link mergeHoldGate} is consulted by `slopweaver github merge` AND by `slopweaver github enqueue`.
 * Doctrine rule 1 prescribes `enqueue` where the base has a native merge queue and `merge --admin` where it
 * does not, so a gate on only one of them is inert for whichever lane the repository is actually in.
 *
 * MEASURED, which is why this is stated rather than assumed: the gate was on `merge` alone, and
 * every hold placed after the queue landed stood on a QUEUED base — four for four. One hold lasted about
 * twenty-seven minutes and another pull request landed underneath it, queued by a `verb:github.enqueue`
 * door record that the hold never saw.
 * The hold refused the verb nobody in that lane was using. Reproduce both halves:
 * `grep github-hold "$SLOPWEAVER_HOME/live/events/stream.jsonl"` and
 * `grep verb:github.enqueue "$SLOPWEAVER_HOME/ledgers/door.jsonl"`.
 *
 * `--dequeue` is deliberately NOT gated, on `enqueue`'s own reasoning: leaving a queue only ever narrows
 * what happens next, and a hold refusing it would refuse the very act that gets a competing entry out of
 * the holder's way.
 *
 * ## It is advisory BY MECHANISM, and that is not a weakness to fix
 *
 * The hold refuses slopweaver's own verbs. It does not — and cannot — stop `gh pr merge`, GitHub's own
 * "Merge when ready" button, or an administrator override, for exactly the reason `./mergeGuard.ts` states
 * about the guard it sits beside: running the door is a discipline the operator chooses, not a fence GitHub
 * enforces. What the hold changes is that the disciplined path now KNOWS, so choosing it no longer means
 * remembering a message.
 *
 * ## At most one hold per repository
 *
 * Keyed by `owner/name`: a hold placed for one repository never refuses a merge in the other (see
 * `docs/constraints/partition.md` for why there are two). A second hold on the SAME repository is
 * refused rather than queued — "one pull request owns the queue" is the whole idea, and two standing holds
 * would need a policy nobody has asked for.
 */

import type { GithubHoldEventKind, GithubHoldStreamEvent } from "../../events/event.js";
import { isRecord } from "../../lib/parsers.js";
import type { Measured } from "../../measurement/status.js";

/**
 * How long a hold may stand before it is warned about, in minutes.
 *
 * Thirty, from the shape of the thing being waited on rather than from taste: a hold exists to let ONE pull
 * request land, and a rebase-plus-revalidate-plus-merge cycle on this repository runs well inside half an
 * hour. Past that the likely truth is that the holder went away, and a hold nobody remembers placing is the
 * failure this threshold exists to make visible.
 */
export const DEFAULT_HOLD_STALE_MINUTES = 30;

/** The on-disk document's layout marker, so a future shape change can be told from a corrupt file. */
const MERGE_HOLD_DOCUMENT_VERSION = 1;

/** One standing hold: which pull request owns the merge queue for one repository, who said so, and why. */
export interface MergeHold {
  /** The repository this hold governs, as `owner/name`. A merge in any other repository is untouched. */
  readonly repo: string;
  /** The held pull request — the ONE that may merge while this stands. */
  readonly pr: number;
  /** Why the queue is held, in the holder's own words. Printed verbatim in every refusal. */
  readonly why: string;
  /** The session that placed it, so a refused session knows who to ask. */
  readonly holder: string;
  readonly atIso: string;
  /** The threshold this hold was placed with, so a later reader judges staleness by the holder's own bound. */
  readonly staleMinutes: number;
  /** When a `stale` warning was published for this hold, so the stream carries it once rather than per read. */
  readonly staleWarnedAtIso: string | undefined;
}

/** Milliseconds in a minute, named so the two age computations below cannot disagree. */
const MS_PER_MINUTE = 60_000;

/**
 * Decode the hold document, dropping anything that is not a whole, usable hold.
 *
 * Tolerant rather than strict, and for the same reason the supervisor stream's parser is: this file is read
 * on the refusal path of a verb whose job is to protect a merge, and a hand-edited or half-written document
 * that made every merge in the repository throw would be far worse than one that reports no hold. A dropped
 * entry is a hold that does not refuse — which is exactly the pre-existing behaviour.
 *
 * @param raw the parsed JSON document, or `undefined` when the file is absent
 * @returns every decodable hold, in file order
 */
export function parseMergeHolds({ raw }: { raw: unknown }): readonly MergeHold[] {
  if (!isRecord(raw)) {
    return [];
  }
  const entries = raw["holds"];
  if (!Array.isArray(entries)) {
    return [];
  }
  const holds: MergeHold[] = [];
  for (const entry of entries) {
    const hold = parseOneHold({ raw: entry });
    if (hold !== undefined) {
      holds.push(hold);
    }
  }
  return holds;
}

/** Decode one entry, or `undefined` when any load-bearing field is missing or the wrong shape. */
function parseOneHold({ raw }: { raw: unknown }): MergeHold | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const repo = raw["repo"];
  const pr = raw["pr"];
  const why = raw["why"];
  const holder = raw["holder"];
  const atIso = raw["atIso"];
  const staleMinutes = raw["staleMinutes"];
  const staleWarnedAtIso = raw["staleWarnedAtIso"];
  if (typeof repo !== "string" || repo.length === 0 || typeof why !== "string" || typeof holder !== "string") {
    return undefined;
  }
  if (typeof pr !== "number" || !Number.isSafeInteger(pr) || pr <= 0) {
    return undefined;
  }
  if (typeof atIso !== "string" || !Number.isFinite(Date.parse(atIso))) {
    return undefined;
  }
  return {
    atIso,
    holder,
    pr,
    repo,
    staleMinutes:
      typeof staleMinutes === "number" && Number.isSafeInteger(staleMinutes) && staleMinutes > 0
        ? staleMinutes
        : DEFAULT_HOLD_STALE_MINUTES,
    staleWarnedAtIso: typeof staleWarnedAtIso === "string" ? staleWarnedAtIso : undefined,
    why,
  };
}

/**
 * The document to write for a set of holds.
 *
 * @param holds every hold that should stand after this write
 * @returns the JSON-serialisable document
 */
export function mergeHoldDocument({ holds }: { holds: readonly MergeHold[] }): {
  readonly version: number;
  readonly holds: readonly MergeHold[];
} {
  return { holds, version: MERGE_HOLD_DOCUMENT_VERSION };
}

/**
 * The hold standing over one repository, if any.
 *
 * @param holds every standing hold
 * @param repo the `owner/name` slug to look for
 * @returns the hold governing that repository, or `undefined`
 */
export function holdFor({ holds, repo }: { holds: readonly MergeHold[]; repo: string }): MergeHold | undefined {
  return holds.find((hold) => hold.repo === repo);
}

/**
 * How long a hold has stood, in whole minutes.
 *
 * @param hold the hold to measure
 * @param nowIso the current time
 * @returns whole minutes since it was placed, floored at zero so a clock skew never reports a negative age
 */
export function holdAgeMinutes({ hold, nowIso }: { hold: MergeHold; nowIso: string }): number {
  const elapsed = Date.parse(nowIso) - Date.parse(hold.atIso);
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / MS_PER_MINUTE)) : 0;
}

/**
 * Whether a hold has stood past its own threshold.
 *
 * @param hold the hold to judge
 * @param nowIso the current time
 * @returns true once its age reaches the threshold it was placed with
 */
export function holdIsStale({ hold, nowIso }: { hold: MergeHold; nowIso: string }): boolean {
  return holdAgeMinutes({ hold, nowIso }) >= hold.staleMinutes;
}

/**
 * One standing hold, with everything a reader has to be told about it already decided.
 *
 * `holderLive` is a {@link Measured} rather than a boolean because absence of a session from the live
 * registry is only evidence of death when every registry file decoded — `measurement/sessions.ts` states
 * why, and a hold report that flattened "not measurable" into "gone" would tell a supervisor to release a
 * hold whose holder is very much alive.
 */
export interface HoldReport {
  readonly hold: MergeHold;
  readonly ageMinutes: number;
  readonly stale: boolean;
  /** Whether the session that placed it is still in the live-session registry, or why that is unknown. */
  readonly holderLive: Measured<boolean>;
}

/**
 * Everything `--status` has to decide about one hold, in one value.
 *
 * @param hold the standing hold
 * @param holderLive whether its holder is still live, as measured by the caller's registry read
 * @param nowIso the current time
 * @returns the report the renderers below consume
 */
export function holdReport({
  hold,
  holderLive,
  nowIso,
}: {
  hold: MergeHold;
  holderLive: Measured<boolean>;
  nowIso: string;
}): HoldReport {
  return {
    ageMinutes: holdAgeMinutes({ hold, nowIso }),
    hold,
    holderLive,
    stale: holdIsStale({ hold, nowIso }),
  };
}

/**
 * Whether a report describes a hold whose holder is PROVABLY gone.
 *
 * Positive proof only: an unmeasurable verdict is not a gone holder, for the reason {@link HoldReport}
 * gives.
 *
 * @param report the hold's report
 * @returns true only when the registry was readable and the holder was not in it
 */
export function holderIsGone({ report }: { report: HoldReport }): boolean {
  return report.holderLive.known && !report.holderLive.value;
}

/** The token appended to the holder column — nothing when it is live, a flag when it is not. */
function holderSuffix({ report }: { report: HoldReport }): string {
  if (!report.holderLive.known) {
    return " (liveness unknown)";
  }
  return report.holderLive.value ? "" : " GONE";
}

/** One hold rendered as the line a human scans — repository, number, holder, age, and the stated reason. */
function holdLine({ report }: { report: HoldReport }): string {
  const { hold } = report;
  const stale = report.stale ? " STALE" : "";
  return (
    `${hold.repo}#${String(hold.pr)}\theld ${String(report.ageMinutes)}m${stale}\t` +
    `by ${hold.holder}${holderSuffix({ report })}\t${hold.why}`
  );
}

/**
 * What `github hold --status` prints.
 *
 * A hold whose holder is provably gone gets a SECOND line carrying the release command, because that is the
 * one state a reader has to act on and the tab-separated line above is scanned, not read. It is a report and
 * nothing more: nothing here releases a hold, and a dead holder's hold keeps refusing exactly as it did —
 * the hold is the exception rather than the lane, and making one
 * easier to place or to survive is not what this flag is for.
 *
 * @param reports every standing hold, already measured
 * @returns the lines to print, or the single line saying nothing is held
 */
export function holdStatusLines({ reports }: { reports: readonly HoldReport[] }): readonly string[] {
  if (reports.length === 0) {
    return ["no merge hold stands: every pull request may merge through the door."];
  }
  const lines: string[] = [];
  for (const report of reports) {
    lines.push(holdLine({ report }));
    if (holderIsGone({ report })) {
      const { hold } = report;
      lines.push(
        `  its holder ${hold.holder} is not in the live-session registry — nobody is landing ` +
          `#${String(hold.pr)}. Release it with \`slopweaver github release --pr ${String(hold.pr)} ` +
          `--repo ${hold.repo}\` once you have checked whether it landed.`,
      );
    }
  }
  return lines;
}

/**
 * What `github hold --status --json` prints: every hold's own fields, plus what `--status` decided about it.
 *
 * @param reports every standing hold, already measured
 * @returns the one JSON line
 */
export function holdStatusJson({ reports }: { reports: readonly HoldReport[] }): string {
  return JSON.stringify({
    holds: reports.map((report) => ({
      ...report.hold,
      ageMinutes: report.ageMinutes,
      holderGone: holderIsGone({ report }),
      holderLive: report.holderLive,
      stale: report.stale,
    })),
  });
}

/**
 * Whether one LANDING invocation may proceed past whatever hold stands over its repository.
 *
 * Shared by `github merge` and `github enqueue` so the two can never disagree about who owns the queue —
 * see this file's header for the measurement that made the second caller necessary.
 *
 * `number` is how the invocation names ITSELF. A landing that does not name a pull request cannot be shown
 * to be the held one, so it is refused while a hold stands rather than waved through — the whole mechanism
 * would be worthless if the way past it were to omit a flag.
 *
 * @param hold the hold standing over this repository, or `undefined` when none does
 * @param number the pull request this invocation is for, when it named one
 * @param nowIso the current time, for the age in the refusal
 * @returns whether the landing is refused, and the lines to print either way
 */
export function mergeHoldGate({
  hold,
  number,
  nowIso,
}: {
  hold: MergeHold | undefined;
  number: number | undefined;
  nowIso: string;
}): { readonly refused: boolean; readonly lines: readonly string[] } {
  if (hold === undefined) {
    return { lines: [], refused: false };
  }
  const held = `${hold.repo}#${String(hold.pr)}`;
  const placed = `placed by ${hold.holder} at ${hold.atIso} (${String(holdAgeMinutes({ hold, nowIso }))}m ago)`;
  if (number === hold.pr) {
    return {
      lines: [`merge hold: this IS the held pull request ${held} — ${placed}. It does not block you.`],
      refused: false,
    };
  }
  const heading =
    number === undefined
      ? `a merge hold stands on ${hold.repo}: ${held} owns the merge queue — ${placed}.`
      : `a merge hold stands on ${hold.repo}: ${held} owns the merge queue, and this invocation is for #${String(number)} — ${placed}.`;
  return {
    lines: [
      heading,
      `why: ${hold.why}`,
      number === undefined
        ? "name this invocation's pull request with --number <n> so the report can tell whether the hold is yours."
        : `wait for ${held} to land, or clear the hold with \`slopweaver github release --pr ${String(hold.pr)} --repo ${hold.repo}\`.`,
      "the hold refuses slopweaver's own landing verbs — `github merge` and `github enqueue`. `gh pr merge`, " +
        "GitHub's own 'Merge when ready' button and an administrator override still bypass it entirely.",
    ],
    refused: true,
  };
}

/**
 * One `github-hold` event for the supervisor stream.
 *
 * @param hold the hold the event is about
 * @param kind what happened to it
 * @param nowIso when it happened
 * @param why the sentence a supervisor can print verbatim
 * @returns the event to publish
 */
export function holdEvent({
  hold,
  kind,
  nowIso,
  why,
}: {
  hold: MergeHold;
  kind: GithubHoldEventKind;
  nowIso: string;
  why: string;
}): GithubHoldStreamEvent {
  return { atIso: nowIso, kind, pr: hold.pr, repo: hold.repo, source: "github-hold", why };
}

/**
 * The `stale` event a hold owes the supervisor stream, or `undefined` when it owes none yet.
 *
 * Published at most ONCE per hold: `staleWarnedAtIso` is written back by whichever surface observes the
 * crossing first, so a supervisor sweep that runs every twenty minutes beside eight sessions each hitting
 * their own merge step produces one warning rather than a page of them. Nothing polls holds — a hold goes
 * stale when somebody LOOKS, which is `github hold --status` (the supervisor's sweep runs it every tick) or
 * a merge that the hold refuses. Stated rather than implied: with nobody looking at all, nothing warns.
 *
 * @param hold the hold to judge
 * @param nowIso the current time
 * @returns the event to publish, or `undefined` when the hold is fresh or has already warned
 */
export function staleHoldEvent({
  hold,
  nowIso,
}: {
  hold: MergeHold;
  nowIso: string;
}): GithubHoldStreamEvent | undefined {
  if (hold.staleWarnedAtIso !== undefined || !holdIsStale({ hold, nowIso })) {
    return undefined;
  }
  const age = holdAgeMinutes({ hold, nowIso });
  return holdEvent({
    hold,
    kind: "stale",
    nowIso,
    why:
      `${hold.repo}#${String(hold.pr)} has held the merge queue for ${String(age)}m ` +
      `(threshold ${String(hold.staleMinutes)}m), placed by ${hold.holder}: ${hold.why}. ` +
      `Release it with \`slopweaver github release --pr ${String(hold.pr)} --repo ${hold.repo}\` if it has landed.`,
  });
}

/**
 * The same hold, marked as having warned, so the warning is published once rather than on every read.
 *
 * @param hold the hold that just warned
 * @param nowIso when it warned
 * @returns the hold to write back
 */
export function withStaleWarned({ hold, nowIso }: { hold: MergeHold; nowIso: string }): MergeHold {
  return { ...hold, staleWarnedAtIso: nowIso };
}

/**
 * What a `base-moved` refusal needs to prescribe the lap that lands: the repository the push targets, the
 * hold standing over it, and who is asking. Absent on `pr create`, whose pull request does not exist yet.
 */
export interface BaseMovedLane {
  readonly repo: string;
  readonly hold: MergeHold | undefined;
  /** This visible session's id, so a hold it placed itself reads as its own. */
  readonly sessionId: string | undefined;
  readonly nowIso: string;
}

/**
 * The queue remedy — the lap that lands on a base with a native merge queue, which is the ordinary case.
 *
 * It prescribes ONE rebase and one gate lap, then `enqueue`. There is no hold to take: GitHub orders the
 * entries, tests each against the tip plus everything ahead of it, and evicts the one that actually fails,
 * so a session that dies after queueing costs the lane nothing.
 */
function queueRemedy({ repo }: { repo: string }): readonly string[] {
  return [
    "remedy: rebase onto the current base ONCE, run the full gate, push, and land with " +
      `\`slopweaver github enqueue --pr <n> --repo ${repo}\``,
    "do NOT take a merge hold and do NOT hand a baton on: GitHub orders the queue, tests your entry against " +
      "the tip plus everything ahead of it, and nothing waits on a session staying alive",
  ];
}

/**
 * The remedy a `base-moved` refusal prints — the lap that lands, rather than the lap that loses.
 *
 * `github push` is where a session LEARNS it is in a serial landing, and the remedy it printed there was
 * "rebase, rerun the gate, retry": the exact lap that loses to the next landing. Measured on one
 * shift: main moved six times in
 * two hours, one pull request rebased five times, and two others each lost three laps.
 *
 * The lap that lands is the QUEUE, not a hold. A hand-run hold-and-baton lane
 * was measured and rejected — it sat idle 371 of
 * 905 minutes, 41% of the day, behind stalled or parked holders, because a hold belongs to a session and a
 * baton by name has nothing to notice when that session dies (`skills/github/reference/merge-hold.md`).
 *
 * So the hold branches below fire only when a hold actually STANDS, which on a queued base now happens only
 * in the surviving exception — a proof that is an expensive live measurement a moved head would invalidate
 * outright — and on a base with no queue at all. With nothing held, the remedy names the queue.
 *
 * Only the branch for a hold this session OWNS names a landing verb, and it names `merge --admin`, because
 * that is the one case where the hold itself proves which lane the reader is in. Waiting behind SOMEONE
 * ELSE\'s hold does not: the base may have no queue (land with `merge --admin`) or be the queued base\'s
 * expensive-measurement exception (land with `enqueue`), and nothing readable from here separates them. So
 * that branch prescribes the wait and the single rebase, and stops — the landing verb is decided at the
 * merge step, by a verb that knows.
 *
 * @param lane the repository, its standing hold and the asking session, or `undefined` when the caller could
 *   not read a hold — the remedy then names the queue with the repository left for the reader
 * @returns the remedy lines, in the order a reader should act on them
 */
export function baseMovedRemedy({ lane }: { lane: BaseMovedLane | undefined }): readonly string[] {
  if (lane === undefined) {
    return queueRemedy({ repo: "<owner/name>" });
  }
  const { hold, nowIso, repo, sessionId } = lane;
  if (hold === undefined) {
    return queueRemedy({ repo });
  }
  const held = `${hold.repo}#${String(hold.pr)}`;
  const age = `${String(holdAgeMinutes({ hold, nowIso }))}m${holdIsStale({ hold, nowIso }) ? " STALE" : ""}`;
  if (sessionId !== undefined && hold.holder === sessionId) {
    return [
      `remedy: you own the merge hold on ${hold.repo} (${held}, placed ${age} ago) — this is the lap that lands: ` +
        `rebase onto the current base, run the full gate ONCE, push, and \`merge --admin --number ${String(hold.pr)}\` releases it`,
    ];
  }
  return [
    `remedy: ${held} owns the merge hold on ${repo} (held ${age} by ${hold.holder}: ${hold.why}) — do NOT rebase ` +
      `yet: every lap you run before it lands is one you lose`,
    `wait for ${held} to land, then rebase onto the current base ONCE`,
  ];
}
