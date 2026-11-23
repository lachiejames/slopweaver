/**
 * STRANDED ASKS — the ones a running visible session picks up again, exactly once.
 *
 * `../turn/recoveryWording.ts` closed the half of this that was wording: a turn that ends with no answer
 * stops telling the person who asked to tag the bot again. It deliberately shipped no recovery, because
 * AGENTS.md rule 2 forbids a queue consumer, a restart and a retry, and at the time nothing distinguished
 * those from picking the ask up again.
 *
 * The owner's ruling draws that distinction: rule 2's property is VISIBILITY, so a stranded ask is
 * re-dispatched by a session the owner can see and interrupt as it runs, and by nothing else. This module is the decision half of that, and it is
 * pure — it starts nothing, reads no clock and touches no surface. What acts on it is
 * `../../cli/commands/listen/scheduledRecover.ts`, which only ever runs inside the visible loop session, so
 * with no session running there is no re-dispatch and the failure card `recoveryWording.ts` composed stays
 * standing, loud and unchanged.
 *
 * ## Why the answer had to be a re-ADMISSION rather than a relaunch of the old dispatch
 *
 * MEASURED over this install's live log, and the split is the whole reason. Of the 31 asks whose newest
 * event is one of the three stranded kinds, only 8 ever recorded a `dispatched` event at all — the other 23
 * were captured, carded, and never routed, so there is no decision on record to replay and no way to
 * synthesise one without a routing JUDGEMENT, which is a model act that belongs in the visible session.
 * Reproduce both numbers over any live home with:
 *
 * ```
 * jq -rs 'group_by(.channel+"/"+.messageTs)
 *   | map({last:(map(.kind)|last), everDispatched:(map(.kind)|index("dispatched")!=null)})
 *   | map(select(.last as $l | ["failed","dispatch-failed","lease-expired"]|index($l)))
 *   | group_by(.everDispatched) | map({(.[0].everDispatched|tostring): length}) | add' \
 *   "$SLOPWEAVER_HOME/live/slack/asks.jsonl"
 * ```
 *
 * So a stranded ask re-enters as a RECOVERY SURVIVOR: the same shape a dropped tag already takes, admitted
 * through the same whitelist, given the same capture UX, and answered by the same three steps the loop runs
 * for a live tag. One lane covers all four failure kinds instead of two lanes covering 26% and 74%, and the
 * judgement stays where rule 2 puts it.
 *
 * ## The bound is ONE, and it lives in the log
 *
 * {@link ../ask/lifecycle.ts#RedispatchedEvent} is appended when the re-dispatch is decided, and this module
 * refuses an ask that already carries one. A session that dies between the append and the capture spends the
 * ask's one attempt without answering it — accepted, and stated rather than discovered: the alternative is a
 * bound kept in a session's memory, which does not survive the session death this whole feature exists for.
 *
 * ## An OPEN REVIEW is not a strand, and the fold alone cannot see that
 *
 * MEASURED on `C0SYN000001/1790048248.995219`. A door refusal wrote a `failed` event over a turn
 * whose worker was alive and holding an open review round. This module read that state and called the ask
 * stranded — while `turn dispatch --sweep`, in the same minute, read the review record and said `IN REVIEW —
 * DO NOT ROUTE`. Two verbs judging one ask from two readers, and only the sweep was right: the pass minted a
 * second turn over a live one and left a false sentence standing in a public channel, which no card
 * finalisation can reach because it was never a card.
 *
 * So the review posture is now an INPUT, required rather than optional, and `../turn/reviewPosture.ts` is the
 * one reader that builds it — the same reader the sweep goes through. `recordOpen` is the field, not
 * `inFlight`: a round that has returned `broken` with the next not yet opened is still a live review, and
 * `inFlight` goes false in exactly that window. An omitted posture must never be able to read as "no review",
 * which is why the field carries no default anywhere in this file.
 */
import type { AskIdentity } from "../ask/identity.js";
import type { AskLifecycle, StrandedAs } from "../ask/lifecycle.js";

/**
 * The three fold states meaning this ask was worked and ended with NO answer — the four failure kinds
 * `../turn/recoveryWording.ts` unified, as the three lifecycle states that carry them (`dispatch-failed`
 * covers both a workspace that held nothing and an ask no session ever routed).
 *
 * `answer-lost` is deliberately NOT one of them, and this is the one place that distinction has to be
 * written down: an answer that was composed and then lost is not a turn that failed to produce one, so
 * re-admitting it would re-run work that already succeeded. It stays excluded permanently, exactly as
 * `./recover.ts` has always excluded it.
 */
export const STRANDED_STATES: ReadonlySet<AskLifecycle["state"]> = new Set<StrandedAs>([
  "failed",
  "dispatch-failed",
  "lease-expired",
]);

/**
 * How stale a strand may be and still be worth picking up.
 *
 * Twenty-four hours, and it is measured rather than picked. For each of this install's 31 stranded asks,
 * the gap from the stranding event to the next live capture anywhere in the log is how long that ask sat
 * before a visible session was running again — the wait this bound has to clear for the mechanism to reach
 * the asks it exists for. Reproduce it with:
 *
 * ```
 * jq -rs 'def secs: (.[0:19]+"Z")|fromdate;
 *   (map(select(.kind=="captured")|.tsIso|secs)|sort) as $caps
 *   | group_by(.channel+"/"+.messageTs)
 *   | map({last:(map(.kind)|last), at:(map(.tsIso)|last|secs)})
 *   | map(select(.last as $l | ["failed","dispatch-failed","lease-expired"]|index($l)))
 *   | map(. as $s | ($caps|map(select(. > $s.at))|first) as $n
 *         | if $n == null then null else (($n - $s.at)/60|floor) end)
 *   | map(select(. != null)) | sort' "$SLOPWEAVER_HOME/live/slack/asks.jsonl"
 * ```
 *
 * Measured: 30 of the 31 waited 782 minutes (13.0h) or less, the two big clusters sitting at
 * 616 and 628 minutes — overnight strands, which are precisely the case the owner asked to recover. The one
 * outlier waited 3,054 minutes (50.9h), across a weekend, and answering that one unbidden is the thing the owner's
 * recovery framing rules out (an ask that came in weeks ago). A day is the smallest round bound that takes all
 * thirty and leaves the fifty-hour one alone.
 *
 * @internal
 */
export const STRANDED_REDISPATCH_MAX_AGE_MINUTES = 1440;

/** One stranded ask a visible session may pick up again, with everything the thread has to be told. */
export interface StrandedAsk {
  readonly ask: AskIdentity;
  /** Which surface addressed the bot, as the `captured` event recorded it — never inferred from the id. */
  readonly surface: "channel" | "dm";
  /** Which stranded state it is in — what the in-thread notice is composed from. */
  readonly strandedAs: StrandedAs;
  /** How long it has been stranded, whole minutes. */
  readonly sinceMinutes: number;
  /** The observation, in words a reader can act on. */
  readonly reason: string;
  /** When the stranded worker posted its first answer (the plan), when it had — what the notice must not deny. */
  readonly firstAnswerIso?: string | undefined;
}

/**
 * Narrow a fold state to a stranded one, or `undefined` when it is not stranded.
 *
 * A predicate rather than a membership test on {@link STRANDED_STATES} because the caller needs the NARROWED
 * value — the notice, the spend record and the report all branch on which of the three it is, and recovering
 * that from a `has()` would take a type assertion this repo prefers to do without.
 *
 * @param state the fold state to narrow
 * @returns the stranded state, or `undefined`
 */
function strandedStateOf({ state }: { state: AskLifecycle["state"] }): StrandedAs | undefined {
  if (state === "failed" || state === "dispatch-failed" || state === "lease-expired") {
    return state;
  }
  return undefined;
}

/**
 * What one folded ask earns from this pass.
 *
 * Three arms rather than `StrandedAsk | undefined`, because "not stranded at all" and "stranded on paper
 * while a worker holds an open review" are two different facts and the second one has to be REPORTABLE. A
 * skip collapsed into `undefined` is exactly how the ask that minted a duplicate public card looked like an
 * ask nobody had considered.
 */
export type StrandedDecision =
  | { readonly kind: "ineligible" }
  | { readonly kind: "review-open"; readonly ask: AskIdentity }
  | { readonly kind: "stranded"; readonly stranded: StrandedAsk };

/** One ask to judge: its fold, and whether its review record is still open — see the module header. */
export interface StrandedCandidate {
  readonly ask: AskLifecycle;
  /** `../turn/reviewPosture.ts`'s `recordOpen` for this ask, read by the caller. Never defaulted. */
  readonly reviewOpen: boolean;
}

/**
 * Whether one folded ask is stranded and still has its re-dispatch to spend. Pure — the clock and the review
 * posture are both injected.
 *
 * Four guards, and each is a different failure this would otherwise cause: a state test (an ask still in
 * flight, or already answered, is not stranded at all), the spend record (a second re-dispatch is the retry
 * loop rule 2 bans), the age bound (an ask nobody has thought about since last week), and the review posture
 * (a worker holding an open round is working, whatever the fold says). The posture is checked LAST, so a
 * `review-open` skip is only ever reported for an ask that was otherwise about to be picked up — reporting
 * one for an already-answered ask would be noise about a decision nothing was going to make.
 *
 * @param ask the folded ask to judge
 * @param nowIso the instant to judge the wait against
 * @param maxAgeMinutes how stale a strand may be; defaults to {@link STRANDED_REDISPATCH_MAX_AGE_MINUTES}
 * @param reviewOpen whether this ask's review record is open, from `../turn/reviewPosture.ts`
 * @returns what this ask earns — ineligible, skipped on an open review, or the strand to re-admit
 */
export function strandedRedispatch({
  ask,
  nowIso,
  maxAgeMinutes = STRANDED_REDISPATCH_MAX_AGE_MINUTES,
  reviewOpen,
}: {
  ask: AskLifecycle;
  nowIso: string;
  maxAgeMinutes?: number;
  reviewOpen: boolean;
}): StrandedDecision {
  const strandedAs = strandedStateOf({ state: ask.state });
  if (strandedAs === undefined || ask.redispatched !== undefined) {
    return { kind: "ineligible" };
  }
  const strandedAt = Date.parse(ask.lastEvent.tsIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(strandedAt) || Number.isNaN(now)) {
    return { kind: "ineligible" };
  }
  const sinceMinutes = Math.floor((now - strandedAt) / 60_000);
  if (sinceMinutes < 0 || sinceMinutes > maxAgeMinutes) {
    return { kind: "ineligible" };
  }
  const identity: AskIdentity = { channel: ask.channel, messageTs: ask.messageTs, threadTs: ask.threadTs };
  if (reviewOpen) {
    return { ask: identity, kind: "review-open" };
  }
  return {
    kind: "stranded",
    stranded: {
      ask: identity,
      firstAnswerIso: ask.firstAnswer?.tsIso,
      reason:
        `this ask has been ${strandedAs} for ${String(sinceMinutes)}m (last event ${ask.lastEvent.tsIso}) ` +
        "and has never been re-dispatched",
      sinceMinutes,
      strandedAs,
      surface: ask.surface,
    },
  };
}

/**
 * What cmux says of a stranded ask's recorded worker workspace right now: `gone` (the liveness check's
 * phantom), `unrecorded` (no dispatch record file at all), `alive`, or `unknown` — a liveness read that could
 * not decide, or a record file that exists and will not parse.
 */
export type BuilderSighting = "gone" | "unrecorded" | "alive" | "unknown";

/**
 * Whether a stranded ask must be left alone because the worker that posted its plan may still be building.
 *
 * A first answer re-arms the lease once and a live builder is reprieved for the review-hold cap past it, but a
 * four-PR build can outlast both — and `lease-expired` neither closes the builder's workspace nor stops it, so
 * re-dispatching then would start a SECOND builder beside the first on the same ask. So a `lease-expired`
 * strand whose plan stands is held while its recorded workspace is alive or undecidable, and picked up once
 * it is gone — the vanish this lane exists for.
 *
 * LIVENESS, never the screen: an idle screen is not a stopped builder. A Claude builder waiting on a
 * backgrounded `github checks --wait` shows an idle prompt and resumes when the wait lands, and a Codex
 * builder's background terminal outlives the turn that started it the same way (measured,
 * `../../cmux/backgroundWork.ts`). A builder that truly stopped
 * holds until its workspace closes; that hold is narrated every pass, and the close is what releases it — but
 * only inside {@link STRANDED_REDISPATCH_MAX_AGE_MINUTES}, after which the ask is too old to pick up at all.
 *
 * Deliberately narrow: an ask with no first answer, or a `failed`/`dispatch-failed` strand (the worker said it
 * stopped, or nothing ran), is judged exactly as it always was — a failed worker's workspace stays open for
 * diagnosis, so holding on liveness there would never pick one up.
 *
 * @param stranded the strand about to be picked up
 * @param sighting what cmux shows of its recorded worker workspace
 * @returns whether to hold it rather than re-dispatch
 */
export function liveBuilderHolds({
  stranded,
  sighting,
}: {
  stranded: StrandedAsk;
  sighting: BuilderSighting;
}): boolean {
  const builderMayRun = sighting === "alive" || sighting === "unknown";
  return stranded.strandedAs === "lease-expired" && stranded.firstAnswerIso !== undefined && builderMayRun;
}

/**
 * Whether a strand is one {@link liveBuilderHolds} could hold at all — so a caller asks cmux only when the
 * answer can change the decision.
 *
 * @param stranded the strand about to be picked up
 * @returns whether its worker's workspace is worth sighting
 */
export function strandNeedsBuilderSighting({ stranded }: { stranded: StrandedAsk }): boolean {
  return stranded.strandedAs === "lease-expired" && stranded.firstAnswerIso !== undefined;
}

/**
 * The `too-old` cutoff a stranded candidate is classified against.
 *
 * The scan's own window is minutes wide — it exists to find a tag that arrived while the socket blinked —
 * and every strand this lane is for is hours old, so classifying one against that window would exclude all
 * of them as `too-old` before any other test ran. This is the same bound {@link STRANDED_REDISPATCH_MAX_AGE_MINUTES}
 * puts on the strand, applied to the message, so the two halves of "too stale to pick up" agree.
 *
 * @param nowIso the current instant
 * @param maxAgeMinutes the bound; defaults to {@link STRANDED_REDISPATCH_MAX_AGE_MINUTES}
 * @returns the ISO cutoff, or `undefined` when `nowIso` is unreadable
 */
export function strandedSinceIso({
  nowIso,
  maxAgeMinutes = STRANDED_REDISPATCH_MAX_AGE_MINUTES,
}: {
  nowIso: string;
  maxAgeMinutes?: number;
}): string | undefined {
  const now = Date.parse(nowIso);
  return Number.isNaN(now) ? undefined : new Date(now - maxAgeMinutes * 60_000).toISOString();
}

/**
 * Every ask a visible session should pick up again this pass, oldest strand first — and every ask it left
 * alone because a review is still open on it.
 *
 * Ordered oldest-first deliberately: a pass that can only get through some of them should spend its attempts
 * on the ones that have been silent longest, which is also the order the person waiting experienced them.
 *
 * @param candidates each folded ask with its own review posture, read by the caller
 * @param nowIso the instant to judge the waits against
 * @param maxAgeMinutes how stale a strand may be; defaults to {@link STRANDED_REDISPATCH_MAX_AGE_MINUTES}
 * @returns the stranded asks to re-admit oldest first, and the identities skipped on an open review
 */
export function strandedRedispatches({
  candidates,
  nowIso,
  maxAgeMinutes = STRANDED_REDISPATCH_MAX_AGE_MINUTES,
}: {
  candidates: readonly StrandedCandidate[];
  nowIso: string;
  maxAgeMinutes?: number;
}): { readonly stranded: readonly StrandedAsk[]; readonly reviewOpen: readonly AskIdentity[] } {
  const found: StrandedAsk[] = [];
  const reviewOpen: AskIdentity[] = [];
  for (const candidate of candidates) {
    const decision = strandedRedispatch({
      ask: candidate.ask,
      maxAgeMinutes,
      nowIso,
      reviewOpen: candidate.reviewOpen,
    });
    if (decision.kind === "stranded") {
      found.push(decision.stranded);
    }
    if (decision.kind === "review-open") {
      reviewOpen.push(decision.ask);
    }
  }
  return { reviewOpen, stranded: found.toSorted((left, right) => right.sinceMinutes - left.sinceMinutes) };
}

/**
 * What the thread is told when a session picks a stranded ask up again — the "and says so in-thread" half of
 * the owner's ruling.
 *
 * One sentence, because the card that follows it carries the rest: rule 7's default arrangement, and the
 * failure card this corrects is already standing directly above it. It names WHAT went wrong in the same
 * vocabulary `../turn/recoveryWording.ts` used to say it the first time, so a reader scrolling the thread
 * sees one story rather than two, and it names that a session is doing this rather than a machine waking up.
 *
 * **An ask whose worker already posted its first answer gets its own two sentences**, because every other
 * one says the earlier session never answered, and the plan is standing in the thread right above it. A
 * stranded state that claims nothing ran (`dispatch-failed`) cannot honestly follow a posted plan, so it reads
 * as the session having stopped.
 *
 * @param strandedAs which stranded state this ask was picked up out of
 * @param firstAnswered whether the stranded worker had already posted its first answer (the plan)
 * @returns the sentence to post in the thread, plain text
 */
export function redispatchNotice({
  firstAnswered = false,
  strandedAs,
}: {
  firstAnswered?: boolean;
  strandedAs: StrandedAs;
}): string {
  if (firstAnswered) {
    return strandedAs === "lease-expired"
      ? "Picking this back up — the plan above was posted, but the session building it ran out of time before it finished."
      : "Picking this back up — the plan above was posted, but the session building it stopped before it finished.";
  }
  if (strandedAs === "lease-expired") {
    return "Picking this back up — the session that had it ran out of time before it answered.";
  }
  if (strandedAs === "failed") {
    return "Picking this back up — the session working on it stopped before it could answer.";
  }
  return "Picking this back up — nothing ever ran on it the first time.";
}
