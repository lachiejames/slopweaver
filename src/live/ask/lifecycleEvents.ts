/**
 * The ASK LIFECYCLE VOCABULARY — every event kind one ask may record, and the four that close it out.
 *
 * Its own module because it is a REGISTER and the file around it is machinery: `./lifecycle.ts` holds the
 * codec that reads these shapes off disk and the fold that turns a stream of them into one entry, and those
 * two never change when a new ending is added. Adding one here is a three-line act — the interface, the
 * union member, and {@link TERMINAL_ASK_LIFECYCLE_KINDS} when it is terminal — and every reader of the log
 * inherits it, because {@link terminalAskLifecycleEvent} and {@link RESOLVED_WITHOUT_ANSWER} are DERIVED
 * from that one list rather than restated per caller. `../listen/recover.ts` and
 * `../../cli/commands/turn/run.ts` each carried their own copy of the four-way `kind` check before this.
 *
 * Every declaration below is re-exported from `./lifecycle.ts`, so no importer needs to know it moved.
 *
 * ## `lease-expired` is a candidate, not a terminal state
 *
 * Every OTHER event kind names where an ask ended up. `lease-expired` does not: it is what a periodic or
 * startup sweep appends when a `dispatched` ask's `leaseExpiresAt` (see `../turn/tier.ts`) has passed with no
 * later event, and it exists to make that ask a re-judgement candidate for the VISIBLE SUPERVISOR — never an
 * automatic relaunch. A `dispatched` event appended after it moves the lifecycle straight back to
 * `dispatched`; nothing here retries or suppresses on its own.
 *
 * `dispatch-failed` is the second of that pair and the same shape: a candidate, not an ending. It says the
 * `dispatched` event above it was never true of anything — see {@link DispatchFailedEvent}.
 *
 * `redispatched` is what a candidate becoming an ACT looks like, and it is the owner's ruling:
 * a running VISIBLE session spends a stranded ask's one re-dispatch and records it here, so the bound is a
 * fact in the log rather than a promise a session makes to itself. Still not a relaunch — nothing in this
 * file, or anywhere below it, starts anything; see {@link RedispatchedEvent}.
 *
 * ## `dispatch-unwitnessed` is neither, and conflating it with `dispatch-failed` orphaned a live worker
 *
 * "The pickup command was sent and nothing saw it arrive" and "nothing ran" are different claims, and for
 * four measured dispatches the first was recorded as the second. {@link DispatchUnwitnessedEvent} carries
 * the incident and the three consequences; the short of it is that an unwitnessed dispatch is still HOLDING
 * a worker, so it keeps its `activeDispatch`, keeps its burst slot, and raises no indicator of its own.
 */
import type { RespondDecision } from "../turn/tier.js";
import type { StartedChecklist } from "./checklist.js";
import type { AskIdentity } from "./identity.js";

/**
 * Which execution tier a routing decision dispatched to — the same three names `../turn/tier.ts` declares.
 *
 * @internal
 */
export type AskDispatchTier = "inline" | "read-only-subagent" | "fresh-visible-session";

/** A tag was captured — the listener saw it and it entered this stream. Always the FIRST event for its key. */
export interface CapturedEvent extends AskIdentity {
  readonly kind: "captured";
  readonly tsIso: string;
  readonly userId: string;
  readonly surface: "channel" | "dm";
  /**
   * What was asked, tags normalised to `@(id)` — the same `../listen/mention.ts#Mention.text` the listener
   * already held when it wrote this row.
   *
   * OPTIONAL because the log predates the field, and a fold over an older home must still open an entry
   * rather than refuse one. Every row the live capture chain writes from here on carries it, which is what
   * lets `../../cli/commands/turn/brief.ts` recover `--text` exactly the way it already recovers
   * `--turn-id`/`--working-ts`: a session re-routing an ask nobody dispatched rebuilds the question from
   * the ledger instead of re-reading Slack for a sentence the listener had already written down.
   */
  readonly text?: string | undefined;
}

/**
 * The listener posted the capture-time checklist. This is the durable half of a fact that used to live only
 * in one stdout/queue-file JSON line (`EmittedMention.started`) — carried forward to `turn brief --turn-id
 * --working-ts` purely by the driving session remembering to do so. A session that forgets mid-turn used to
 * orphan the checklist message with no way to recover it; `turn brief` can now fall back to this event
 * (`../ask/store.ts`'s `startedRefForAsk`) keyed by the SAME `channel`/`messageTs` it already requires.
 *
 * A process death between Slack accepting the stream and this event's own local append is a real, accepted
 * gap this alone does not close: the checklist exists in Slack with no lifecycle trace of it. Recovery
 * proof scoped to this handover requires a durably recorded `checklist-posted` event as its precondition
 * rather than claiming resilience across that exact crash window — see
 * `docs/routing-witnessed-acceptance-proof/scenarios-1-to-4.md`.
 */
export interface ChecklistPostedEvent extends AskIdentity {
  readonly kind: "checklist-posted";
  readonly tsIso: string;
  readonly turnId: string;
  readonly workingTs: string;
}

/**
 * The visible supervisor judged this ask needs no reply, and is ABOUT to clean up any capture checklist —
 * NOT yet terminal. `{@link TriagedNoResponseEvent}` below is the terminal twin, and the two are deliberately
 * split: appending the terminal event before the checklist delete is CONFIRMED means a crash, a door
 * refusal, or an unconfirmed `deleteMessage` result would leave the lifecycle terminal while the checklist
 * stays visible forever, with no later event ever able to revisit it. This event is what a sweep or recovery
 * pass instead finds pending — never excluded the way a genuine terminal state is.
 */
export interface TriageCleanupIntendedEvent extends AskIdentity {
  readonly kind: "triage-cleanup-intended";
  readonly tsIso: string;
  /** Why, in the supervisor's own words — never inferred, always recorded. */
  readonly reason: string;
  /** The exact checklist this intends to delete, when a capture checklist exists for this ask. */
  readonly checklistDelete?: StartedChecklist | undefined;
}

/**
 * The visible supervisor judged this ask needs no reply at all. Genuinely terminal, appended only after
 * {@link TriageCleanupIntendedEvent}'s own cleanup attempt is confirmed (or was never needed), never before.
 */
export interface TriagedNoResponseEvent extends AskIdentity {
  readonly kind: "triaged-no-response";
  readonly tsIso: string;
  /** Why, in the supervisor's own words — never inferred, always recorded. */
  readonly reason: string;
}

/**
 * The visible supervisor judged this ask OWES a reply that a PERSON should give, and is ABOUT to clean up any
 * capture checklist — NOT yet terminal. The same split as {@link TriageCleanupIntendedEvent}, kept as its own
 * kind so a cleanup that stalls still says a person is owed an answer rather than reading as "nothing owed",
 * and so the terminal that must follow it is never ambiguous.
 */
export interface HandoverCleanupIntendedEvent extends AskIdentity {
  readonly kind: "handover-cleanup-intended";
  readonly tsIso: string;
  /** Why a person should answer, in the supervisor's own words — never inferred, always recorded. */
  readonly reason: string;
  /** The exact checklist this intends to delete, when a capture checklist exists for this ask. */
  readonly checklistDelete?: StartedChecklist | undefined;
}

/**
 * The visible supervisor judged this ask OWES a reply and that a PERSON should give it, so the bot stays out.
 * Terminal, appended only after {@link HandoverCleanupIntendedEvent}'s own cleanup attempt is confirmed.
 *
 * **Distinct from `triaged-no-response`, and the difference is what the asker is told.** Triage settles to
 * `acknowledged` (`:ack:`, nothing owed); this settles to `for-a-human` (`:for-a-human:`, a person should
 * answer). Recording both as one kind would leave every reader of the log, and the reaction the sweep
 * re-asserts, unable to tell "needs nothing" from "needs a human". The owner's call.
 */
export interface LeftForAHumanEvent extends AskIdentity {
  readonly kind: "left-for-a-human";
  readonly tsIso: string;
  /** Why a person should answer, in the supervisor's own words — never inferred, always recorded. */
  readonly reason: string;
}

/**
 * A `respond` decision as a `dispatched` row RECORDED it — {@link RespondDecision} with `truthMode` optional.
 *
 * OPTIONAL because the log predates the field, the same posture as {@link CapturedEvent}'s `text`: `truthMode`
 * joined the decision later, and every `dispatched` row written before it carries
 * a decision without one. Requiring it here refused all 69 such rows of the live log on every read, while the
 * 65 asks they belong to had long since ended. The optionality is for READING alone: `RespondDecision` stays
 * strict, the durable append takes {@link AppendableAskLifecycleEvent}, and both readers deep-compare a
 * recorded decision against a current one, which an old row can never equal — so it reads as a stale
 * decision, never as a guessed current one.
 */
export type RecordedRespondDecision = Omit<RespondDecision, "truthMode"> & {
  readonly truthMode?: RespondDecision["truthMode"] | undefined;
};

/** A routing decision sent this ask to a tier that has not yet reported terminal completion. */
export interface DispatchedEvent extends AskIdentity {
  readonly kind: "dispatched";
  readonly tsIso: string;
  readonly tier: AskDispatchTier;
  /** When this dispatch's lease expires — the same wall-clock model `../turn/tier.ts`'s `isLeaseExpired` reads. */
  readonly leaseExpiresAt: string;
  /**
   * The EXACT decision this dispatch executed under — carried here, not just handed to the caller, so
   * `turn answer`'s direct (non-`--dispatch`) mode can cross-check the `--decision` FILE it is handed against
   * what was actually dispatched, rather than trusting whichever file happens to be at that path when the
   * session gets around to answering. The same "a hand-editable local file is not proof" reasoning the
   * responder whitelist already applies to a hand-authored brief.
   */
  readonly decision: RecordedRespondDecision;
}

/**
 * A real answer posted, as this process's own record of it — never trusted, BY ITSELF, as proof a specific
 * Slack message exists; recovery re-checks that against Slack's own metadata before ever calling an ask
 * "already answered". That is a DIFFERENT question from the one this event answers for suppression: whether
 * this exact ask should ever be reconsidered at all. For that question alone, this local record — like
 * `TriagedNoResponseEvent`/`WithheldEvent` — IS the authority (see {@link terminalAskLifecycleEvent}): the
 * owner's own explicit ruling is that a terminal ledger entry must never be re-flagged as dropped, even with
 * no remote metadata to independently confirm it, accepting a false-negative bias (a deleted answer stays
 * suppressed) over the alternative of re-litigating an ask already judged closed.
 */
export interface AnsweredEvent extends AskIdentity {
  readonly kind: "answered";
  readonly tsIso: string;
  /** The posted answer message's own `ts`. */
  readonly answerTs: string;
}

/**
 * What a first answer says is still owed after it, as a closed set — see {@link FirstAnsweredEvent}.
 *
 * `pull-requests` is the case that made this event exist; `other` is there because a plan can promise
 * something that is not a pull request, and a worker that cannot name its follow-through under the first
 * heading must still be able to declare one rather than post a terminal answer over unfinished work.
 */
export const FOLLOW_THROUGH_OWES = ["pull-requests", "other"] as const;

/** One member of {@link FOLLOW_THROUGH_OWES}. */
export type FollowThroughOwes = (typeof FOLLOW_THROUGH_OWES)[number];

/**
 * A FIRST answer posted — a plan, with work the same worker still owes after it. NOT terminal.
 *
 * The answer-first rule (`skills/loop-bot/reference/raising-a-pr.md`) has a worker post a reviewed plan in
 * the thread BEFORE it opens a pull request. Recorded as `answered`, that post ended the dispatch and closed
 * the worker's own workspace the instant it obeyed — MEASURED on `C0SYN000010/1790924298.202269`:
 * right after the plan posted, both workspaces were gone within a minute, no pull request opened, and nothing
 * on the sweep or the stranded lane could see it, because the log said the turn was over.
 *
 * So this event is written instead when the answer form declares `followThrough`, and it says the opposite
 * of `answered`: the thread has an answer, and the turn is NOT over. It keeps `activeDispatch` (and its
 * generation token) so the sweep keeps supervising the builder, keeps the worker's workspace open, and clears
 * the answer-first gate. The worker's later FINAL answer, or its `turn resume --failed`, ends the turn
 * exactly as before. A builder that vanishes is caught by the sweep's `phantom`/`lease-expired` arms and
 * stranded, so `../listen/stranded.ts` re-dispatches it once from a visible session.
 */
export interface FirstAnsweredEvent extends AskIdentity {
  readonly kind: "first-answered";
  readonly tsIso: string;
  /** The posted first answer's own `ts` — protected from every later card reap. */
  readonly answerTs: string;
  /** `answerDigestOf` of the posted form, so the verdict that cleared it reads as spent rather than usable. */
  readonly answerDigest: string;
  /** What kind of work is still owed. */
  readonly owes: FollowThroughOwes;
  /** What is still owed, in the worker's own words off the reviewed form. */
  readonly what: string;
  /**
   * The lease RE-ARMED at the first answer — `tsIso` plus `DEFAULT_LEASE_HOURS`. Stored here rather than
   * rewritten onto the dispatch, because the dispatch's own `leaseExpiresAt` is the generation token the
   * dispatch record and the durable turn marker bind on, and changing it would orphan both. Every CLOCK reader
   * takes the later of the two (`../turn/tier.ts`'s `effectiveLeaseExpiresAt`).
   */
  readonly leaseExpiresAt: string;
}

/** The composed answer was held for the owner's review rather than sent. */
export interface WithheldEvent extends AskIdentity {
  readonly kind: "withheld";
  readonly tsIso: string;
  /** The `admit/queue.ts` entry id this resolves to, so a recovered ask can be released the normal way. */
  readonly queueId: string;
  readonly code: string;
  readonly reason: string;
}

/** The turn broke before it could answer, withhold, or triage. */
export interface FailedEvent extends AskIdentity {
  readonly kind: "failed";
  readonly tsIso: string;
  readonly reason: string;
}

/**
 * The turn REACHED an answer and then broke on the way out — the answer existed and was destroyed.
 *
 * Distinct from `failed` for the same reason `dispatch-failed` is: the two look identical in the log and
 * mean opposite things to whoever reads the row next. `failed` says no answer was ever composed, so a
 * reader's open question is whether this ask can be answered at all. This one says the ask was answerable,
 * was answered, and the reply died in delivery — nothing about the question is in doubt, and the retry path
 * is simply to run the turn again (for a Slack ask, a re-tag).
 *
 * MEASURED, which is why it exists: one of the owner's own work orders was investigated,
 * answered, sent through three rounds of review and returned verdict-clean, and then the send threw because
 * the door's gate list resolved a repository root from the plugin mirror it was installed into
 * (`../../lib/gitRepo.ts`'s `runningCheckoutRoot` header carries that fault). The ask's terminal row read
 * `kind: failed`, which is what an unanswerable question looks like.
 *
 * Non-terminal, exactly like `failed` — see {@link terminalAskLifecycleEvent}. It ends the dispatch, and
 * `../listen/recover.ts` counts it among the WORKED states, so a recovery sweep never silently re-runs it.
 */
export interface AnswerLostEvent extends AskIdentity {
  readonly kind: "answer-lost";
  readonly tsIso: string;
  readonly reason: string;
}

/**
 * The dispatch never landed — nothing is behind this ask.
 *
 * Distinct from `failed` for the same reason `../turn/indicators.ts` keeps `failed` and `abandoned` apart:
 * `failed` is a turn reporting its own break, and something therefore RAN. `dispatch-failed` says the
 * opposite. NOTHING RAN is the whole content of this event, so nothing can have had a side effect, which is
 * exactly what makes re-judging or re-dispatching this ask safe. Non-terminal, and NOT an active state
 * (`./burst.ts`) — an ask nobody is working is not one a later tag should queue behind — while still being
 * a burst-slot RELEASE, so whatever was queued behind it drains rather than waiting forever.
 *
 * Three ways to reach it, and they are all the same claim:
 *
 *  - the workspace was opened and recorded but its pickup command was never witnessed arriving;
 *  - a liveness check found no session in the workspace the record names (`phantom`);
 *  - **no `dispatched` event was ever recorded at all** — the ask was captured, its `:eyes:` and its
 *    capture-time card went up, and no session ever routed it. Added with the sweep's
 *    `never-dispatched` arm (`../../cli/commands/turn/sweptRecords.ts#recordUndispatchedAsk`); before it, this
 *    class had no terminaliser anywhere and a card could stand mid-checklist indefinitely.
 */
export interface DispatchFailedEvent extends AskIdentity {
  readonly kind: "dispatch-failed";
  readonly tsIso: string;
  readonly reason: string;
}

/**
 * The pickup command was SENT into a live workspace and no witness confirmed it arriving inside the send
 * verifier's bound — the third answer `dispatched`/`dispatch-failed` could not express.
 *
 * **This event does NOT end the dispatch**, and that is the whole reason it exists rather than being a
 * flavour of {@link DispatchFailedEvent}. Measured live on the ask at message ts `1787878821.099679`
 * → workspace:399: the send landed, the worker booted, read its brief and composed a real answer, while the
 * dispatch had already been recorded `dispatch-failed`. Three things followed from that one wrong word, and
 * each is a defect the reader of this event is being kept out of:
 *
 *  - {@link supersedesDispatch} cleared `activeDispatch`, so `turn dispatch --sweep` reported `0 working`
 *    over a live worker — nothing would have reported it if it had then died, stalled or run past its lease;
 *  - `./burst.ts` released the burst slot, so the asker's follow-up in the same thread was admitted
 *    `proceed` against a holder nobody could see, and its worker went on to compose "nothing ran";
 *  - the thread got a PUBLIC `:warning:` reaction while the answer was being written.
 *
 * So an unwitnessed dispatch is treated as a RUNNING one everywhere: it keeps `activeDispatch` (the sweep
 * tracks it, its lease still expires, a phantom workspace is still caught), it stays in `./burst.ts`'s
 * `ACTIVE_STATES`, and it raises no indicator of its own. What is NOT claimed is that the pickup landed —
 * only that nothing has yet proved it did not. `../../cli/commands/turn/dispatchSweep.ts` reconciles it
 * against cmux's own delivery record on the next sweep, and `phantom` is what turns it into a real failure.
 */
export interface DispatchUnwitnessedEvent extends AskIdentity {
  readonly kind: "dispatch-unwitnessed";
  readonly tsIso: string;
  readonly reason: string;
}

/**
 * A later look CORROBORATED an unwitnessed dispatch's pickup — the reconciliation half of
 * {@link DispatchUnwitnessedEvent}, so an ask does not sit at `dispatch-unwitnessed` forever once the doubt
 * is settled. Carries the witness that answered, because "how do you know" is the question this whole pair
 * exists to keep answerable. Like `dispatch-unwitnessed`, it does not end the dispatch.
 */
export interface DispatchWitnessedEvent extends AskIdentity {
  readonly kind: "dispatch-witnessed";
  readonly tsIso: string;
  readonly reason: string;
}

/**
 * A sweep found a `dispatched` ask past its lease — a re-judgement candidate, recorded so it is never silent.
 *
 * @internal
 */
export interface LeaseExpiredEvent extends AskIdentity {
  readonly kind: "lease-expired";
  readonly tsIso: string;
}

/**
 * What only the owner can do, in the two shapes the design names. A closed set rather than free prose,
 * because the reader BRANCHES on it: a sign-in is a chore the owner does about once a day and a risky act is a
 * decision the owner has to make, and the sentence the thread and the briefing are told differs per kind.
 *
 * Signing in and approving something risky are close to the only cases that come up. `other` exists
 * because "close to" is not "only", and a turn that genuinely cannot name
 * its blocker under either heading must still be able to record one rather than invent a fit or, worse,
 * finish and call itself done.
 *
 * `ruling` is the tag decision tree's step (d) (`../turn/tagDecisionTree.ts`): no general ruling of the owner's covers
 * the kind of ask and the asker is not on the trusted tier, so the ask waits for the owner's one-off approval. It
 * is not `risky-approval`, because nothing about the ask need be risky; what is missing is the owner's ruling, and
 * the thread is told exactly that, in the owner's own words.
 */
export type BlockedNeed = "sign-in" | "risky-approval" | "ruling" | "other";

/** Every {@link BlockedNeed}, in the order `turn block`'s usage line lists them. */
export const BLOCKED_NEEDS: readonly BlockedNeed[] = ["sign-in", "risky-approval", "ruling", "other"];

/**
 * Whether a raw value is one of the {@link BlockedNeed}s — the one test both decoders and the flag reader share,
 * so a fifth need cannot be added to the type and forgotten by a reader.
 *
 * @param value the raw value off a line or a flag
 * @returns whether it names a need
 */
export function isBlockedNeed(value: unknown): value is BlockedNeed {
  return BLOCKED_NEEDS.some((need) => need === value);
}

/**
 * THE TURN IS WAITING ON THE OWNER, and it is NOT done.
 *
 * The design rejects the premise that the loop itself waits on the owner: the listener is always on and the
 * session generally runs autonomously. What waits is a STEP. The worked case is a Datadog monitor deploy that
 * cannot proceed because nobody is signed into Google Cloud locally — a sign-in the owner does about once a day.
 *
 * **Deliberately NOT terminal** ({@link terminalAskLifecycleEvent} is unchanged), and that is the whole
 * point of the event rather than an incidental property: _"I definitely would want to avoid [the bot]
 * treating something as done if it was not really done, and it was actually only being marked as done as a
 * cheap way for the bot to tick something off a list … the owner is going to come back and look at it and
 * say what the fuck, you just embarrassed me in public."_ An ask sitting here reads as unfinished at every
 * reader of this log, and `../../cli/commands/turn/run.ts` refuses to post a final answer over one.
 *
 * **Not stranded either**, and this is the difference a reader must not blur. `../listen/stranded.ts`'s
 * `STRANDED_STATES` names the three ways a turn ends with nothing and nobody coming back; this is a turn
 * that ended with a plan and a named person. Re-admitting it would re-run investigation that already
 * succeeded and would post a second capture checklist over the card the hourglass is standing on.
 *
 * **No time bound anywhere.** _"Might be one minute, might be one week, it should not necessarily be
 * constrained on time."_ So nothing here carries a deadline, an expiry or an age, and nothing downstream may
 * derive one: `since` is answered by `tsIso` for a reader, never by a sweep deciding this has waited long
 * enough to give up on.
 *
 * It ENDS the dispatch (see {@link supersedesDispatch}) because the worker session genuinely stops — holding
 * a lease open for a week is the "it looks like it is working" lie `../turn/indicators.ts` exists to end.
 */
export interface BlockedOnHumanEvent extends AskIdentity {
  readonly kind: "blocked-on-human";
  readonly tsIso: string;
  /** Which of the two shapes this is. */
  readonly need: BlockedNeed;
  /** What the owner has to actually do, in one colleague-safe sentence — rendered on the card and in the thread. */
  readonly what: string;
  /** The step the card shows the hourglass on, in the worker's own words. */
  readonly stepText: string;
  /**
   * The bare HTTPS origin the owner signs in to, when the sign-in is a page in their work Chrome — what the
   * `turn-signed-out` monitor floats a note and a top-of-queue card for. Absent on every other need, and on a
   * sign-in with no page (a local CLI login), which no browser card can open.
   */
  readonly signInOrigin?: string | undefined;
  /** The in-thread message that tagged the owner, once it is posted — absent when no owner is configured. */
  readonly tagTs?: string | undefined;
}

/**
 * THE OWNER DID THE THING — the resume half, and the only thing that ever lifts {@link BlockedOnHumanEvent}.
 *
 * Recorded by a VISIBLE session running `slopweaver turn unblock`, never by a poller noticing a credential
 * came back: rule 2's property is visibility, and "the block cleared itself" is a claim no file on this
 * machine can honestly make about a human. It claims nothing about the answer — the ordinary `dispatched` →
 * `answered` events that follow record that, exactly as they always have, which is what makes the resume
 * _"pick up from where it stopped"_ rather than start again.
 *
 * Not terminal and not active: nothing is running between this event and the re-dispatch that follows it.
 */
export interface UnblockedEvent extends AskIdentity {
  readonly kind: "unblocked";
  readonly tsIso: string;
  /** What the owner did, in the unblocking session's own words — what the resumed card and the journal say. */
  readonly note: string;
  /**
   * The need and the sentence of the block this LIFTED, copied off it at write time.
   *
   * Copied rather than looked up, because the fold clears {@link AskLifecycle.blockedOnHuman} the moment
   * this event lands — so a resume row reading the fold alone would know an ask was owed a re-dispatch and
   * not what it had been waiting for. Copying is what makes this event self-describing in the log too: one
   * line says what was blocked, what kind of block it was, and that it is over.
   */
  readonly lifted: { readonly need: BlockedNeed; readonly what: string };
}

/** Which of the four ways a turn ends with no answer left this ask stranded — the unified set. */
export type StrandedAs = "failed" | "dispatch-failed" | "lease-expired";

/**
 * A RUNNING VISIBLE SESSION spent this ask's one re-dispatch — the durable half of the owner's
 * ruling that a stranded ask is picked up again by a session they can see, never by a daemon, a queue
 * consumer, a restart or a retry.
 *
 * Its only job is to be a SPEND RECORD. `../listen/stranded.ts` re-admits a stranded ask exactly when this
 * event is absent, so appending it is what makes the re-dispatch happen once and never again — the bound
 * lives in the log rather than in a session's memory, which is the only place it survives a session death.
 *
 * **Not terminal and not active.** It says a session decided to try again; it claims nothing about the
 * outcome, which the ordinary `captured` → `dispatched` → `answered`/`failed` events that follow it record
 * as they always have. It supersedes no dispatch because a stranded ask by definition holds none.
 *
 * `strandedAs` is kept as a field rather than folded into `reason` because a reader BRANCHES on it: the
 * sentence the thread is told differs per failure kind (`../turn/recoveryWording.ts` draws the same
 * distinction for the same four kinds), and a `reason` string cannot be branched on without re-parsing prose.
 */
export interface RedispatchedEvent extends AskIdentity {
  readonly kind: "redispatched";
  readonly tsIso: string;
  /** Which stranded state this ask was in when the re-dispatch was decided. */
  readonly strandedAs: StrandedAs;
  /** What the stranded lane observed, in words a reader can act on. */
  readonly reason: string;
}

/**
 * THIS ASK'S CONTENT WAS ALREADY ANSWERED, by a reply belonging to a DIFFERENT ask in the same thread — the
 * one terminal that settles an ask to completion and says nothing.
 *
 * MEASURED on `C0SYN000012`. Three asks landed in one thread; the third
 * (`1787540579.950269`, the owner's burst follow-up *"also answer the question they just asked"*) had its
 * content satisfied by the answer turn for ask `1787540532.743159`, while its own working card
 * had stood for hours. The ledger still owed that ask a terminal, and every terminal the vocabulary
 * offered POSTED something: `answered` a card, `failed`/`withheld` a notice, `triaged-no-response` the
 * `acknowledged` react that reads as "noted" over an ask that was in fact answered. So it was
 * dispatched purely to close itself, and it then posted a fourth bot message into a thread that was
 * finished to every person reading it. Its own dispatch rationale names the trap outright: *"This ask still
 * carries a live card, so it needs its own terminal rather than being left standing behind the answer it
 * asked for."*
 *
 * The loop's own framing of the class, kept verbatim: *"a thread that is DONE to a person can still owe two
 * terminals to the ledger, and satisfying the ledger is what put the fourth message in front of the owner."*
 *
 * **Distinct from `triaged-no-response`, and the difference is what the reader is told.** Triage says the
 * turn judged this ask and owed no reply, which is why it settles to `acknowledged` — `completion` would
 * overstate it. This says the ask WAS answered, in this thread, at {@link SatisfiedElsewhereEvent.answeredByTs};
 * `completion` is the only truthful symbol for it, and `acknowledged` would understate a satisfied ask as
 * merely noted. **Distinct from a permanent ignore** (`./ignore.ts`) for the same reason the terminal kinds
 * differ at all: nothing here is suppressed, and a later tag on this ask is admitted normally.
 *
 * Terminal ({@link terminalAskLifecycleEvent}), and it ends the dispatch — the ask is over, so a worker's
 * answer to it is no longer wanted.
 */
export interface SatisfiedElsewhereEvent extends AskIdentity {
  readonly kind: "satisfied-elsewhere";
  readonly tsIso: string;
  /**
   * The `ts` of the message that already answers this ask — the POINTER that makes this event checkable.
   *
   * A reader scrolling the thread can land on it; `../../cli/commands/turn/satisfied.ts` refuses to write
   * one naming this ask's own message, or one naming a card this ask itself posted, because an ask pointed
   * at its own working checklist is not a satisfied ask.
   */
  readonly answeredByTs: string;
  /** Why that answer satisfies this ask, in the deciding session's own words — recorded, never inferred. */
  readonly reason: string;
}

/** One appended event. `captured` opens an entry; every other kind updates the fold for its `(channel, messageTs)` key. */
export type AskLifecycleEvent =
  | CapturedEvent
  | ChecklistPostedEvent
  | TriageCleanupIntendedEvent
  | TriagedNoResponseEvent
  | HandoverCleanupIntendedEvent
  | LeftForAHumanEvent
  | SatisfiedElsewhereEvent
  | DispatchedEvent
  | AnsweredEvent
  | FirstAnsweredEvent
  | WithheldEvent
  | FailedEvent
  | AnswerLostEvent
  | DispatchFailedEvent
  | DispatchUnwitnessedEvent
  | DispatchWitnessedEvent
  | LeaseExpiredEvent
  | RedispatchedEvent
  | BlockedOnHumanEvent
  | UnblockedEvent;

/**
 * An event a writer may append NOW: every kind as declared, except that a `dispatched` event's decision is the
 * strict {@link RespondDecision}. {@link RecordedRespondDecision}'s optional `truthMode` exists to READ rows
 * already written before `truthMode` existed, never to write a new one without it — so the durable append takes this type,
 * and a fresh dispatch missing `truthMode` fails to compile rather than landing in the log.
 */
export type AppendableAskLifecycleEvent = Exclude<AskLifecycleEvent, DispatchedEvent> | AppendableDispatchedEvent;

/** A `dispatched` event a writer may append NOW: its decision is the strict {@link RespondDecision}. */
export type AppendableDispatchedEvent = DispatchedEvent & { readonly decision: RespondDecision };

/** The five event kinds that genuinely close an ask out — see each one's own doc for why it counts. */
export type TerminalAskLifecycleEvent =
  AnsweredEvent | TriagedNoResponseEvent | LeftForAHumanEvent | WithheldEvent | SatisfiedElsewhereEvent;

/**
 * Whether one event is a terminal event, narrowing its type when it is. Pure and total — the single
 * definition of "terminal" every other reader of this log should share, rather than each caller re-typing
 * the same four-way `kind` check (`../../cli/commands/turn/run.ts`'s `dispatchGenerationCheck` used to be
 * exactly that, hardcoded a second time).
 *
 * @param event the event to classify
 * @returns the same event, narrowed, when it is terminal — else `undefined`
 */
export function terminalAskLifecycleEvent({
  event,
}: {
  event: AskLifecycleEvent;
}): TerminalAskLifecycleEvent | undefined {
  return event.kind === "answered" ||
    event.kind === "triaged-no-response" ||
    event.kind === "left-for-a-human" ||
    event.kind === "withheld" ||
    event.kind === "satisfied-elsewhere"
    ? event
    : undefined;
}

/**
 * Every terminal kind as a VALUE, so the set below can be derived rather than hand-maintained.
 *
 * `satisfies` rather than an annotation on purpose: the array keeps its literal tuple type, so
 * {@link RESOLVED_WITHOUT_ANSWER} narrows, while a kind added to {@link TerminalAskLifecycleEvent} and
 * forgotten here still fails {@link terminalAskLifecycleEvent}'s own exhaustiveness at the call site.
 */
const TERMINAL_ASK_LIFECYCLE_KINDS = [
  "answered",
  "triaged-no-response",
  "left-for-a-human",
  "withheld",
  "satisfied-elsewhere",
] as const satisfies readonly TerminalAskLifecycleEvent["kind"][];

/**
 * The terminal kinds that closed an ask WITHOUT a posted answer message.
 *
 * Derived from {@link TERMINAL_ASK_LIFECYCLE_KINDS} so a new ending is resolved everywhere the moment it is
 * declared — the hand-maintained subset this replaced in `../listen/recover.ts` sat one kind behind for as
 * long as nobody remembered to edit two files. `answered` is the one exclusion, because a reader that has
 * the answer message wants to name it rather than report the ask merely resolved.
 */
export const RESOLVED_WITHOUT_ANSWER: ReadonlySet<AskLifecycleEvent["kind"]> = new Set(
  TERMINAL_ASK_LIFECYCLE_KINDS.filter((kind) => kind !== "answered"),
);
