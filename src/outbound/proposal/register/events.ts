/**
 * The proposal register's typed events, and the pure fold that turns a journal into current state.
 *
 * A register entry is a HISTORY, not a snapshot: a decision, a supersession, an announced Slack thread and a
 * status change are all facts about a moment, and a mutable JSON file would either discard the reason a status
 * changed or reinvent an embedded history array to keep it. This mirrors `../../../handover/ledger.ts`'s own
 * typed-event-plus-fold shape — one append-only file per proposal, folded on read — rather than the two literal
 * storage choices the originating brief offered, because that is the closest precedent already in this
 * repository and the register's own history requirement fits it exactly.
 *
 * ## Why `status` never drifts from `supersededBy`/`decision`
 *
 * `docs/constraints/coupled-claims.md` and `../../../handover/doc.ts` record a lesson from this program's own history:
 * `blocked` was dropped from `DocStatus` because `blockedBy` already determined it, and letting both be
 * declared independently meant they could disagree with no way to tell which was right. `superseded`,
 * `decided` and `rejected` have the identical trap here, so this fold makes `status` the ONLY thing a reader
 * trusts for "where is this now" — each of those three sets it as a side effect of recording the decision or
 * supersession itself, and a generic status change can never reach any of them (see {@link RegisterStatus}
 * vs. the narrower {@link SettableRegisterStatus} a `status-changed` event may carry).
 *
 * The same lesson is why there is no stored `stale`/`drifted` status even though the owner named one. Drift
 * is DERIVED — `./drift.ts` compares the newest material event against the Notion page's own
 * `last_edited_time` — so a declarable `stale` would be a second authority over the same question.
 *
 * ## Reopening is allowed
 *
 * Nothing in this repository establishes that a decided or superseded proposal may never return to active
 * discussion, and real proposals do reopen. The fold does not enforce a transition graph; it trusts whichever
 * event actually happened, in order, and keeps every event as durable history regardless of what the CURRENT
 * status says.
 */
import type { ProposalAddress } from "../address.js";

/**
 * Where a proposal has got to. The lifecycle axis — orthogonal to `ProposalIntake`'s drafting-workflow status.
 *
 * Nine states, in rough lifecycle order. The first three are pre-verdict, the next three post-verdict, and the
 * last three are the ways a proposal ends without being built. `decided` means approved with nothing started
 * yet — the state the owner named "approved-not-started" — and it keeps its name because the decision LEDGER
 * is what the owner asked the register to hold, so the status that says a decision happened should say so.
 */
export type RegisterStatus =
  | "strawman"
  | "shared"
  | "discussed"
  | "decided"
  | "partially-implemented"
  | "implemented"
  | "rejected"
  | "superseded"
  | "withdrawn";

/** The subset of {@link RegisterStatus} a generic status change may set — the other three arrive only via their own atomic event. */
export type SettableRegisterStatus = Exclude<RegisterStatus, "decided" | "rejected" | "superseded">;

/** Every status `proposal status` accepts, in the order the usage text lists them. */
export const SETTABLE_REGISTER_STATUSES: readonly SettableRegisterStatus[] = [
  "strawman",
  "shared",
  "discussed",
  "partially-implemented",
  "implemented",
  "withdrawn",
];

/** Every status a folded entry can be at, in lifecycle order — what `proposal list --status` validates against. */
export const REGISTER_STATUSES: readonly RegisterStatus[] = [
  "strawman",
  "shared",
  "discussed",
  "decided",
  "partially-implemented",
  "implemented",
  "rejected",
  "superseded",
  "withdrawn",
];

/**
 * Whether a string is one of the statuses a generic status change may set.
 *
 * @param value the candidate status
 * @returns true iff `proposal status` may set it directly
 */
export function isSettableRegisterStatus(value: string): value is SettableRegisterStatus {
  return (SETTABLE_REGISTER_STATUSES as readonly string[]).includes(value);
}

/**
 * Whether a string is any register status at all, settable or atomic.
 *
 * @param value the candidate status
 * @returns true iff it is one of the nine folded statuses
 */
export function isRegisterStatus(value: string): value is RegisterStatus {
  return (REGISTER_STATUSES as readonly string[]).includes(value);
}

/**
 * What a decision decided. A rejection IS a decision — same decider, same date, same reason — so it is an
 * OUTCOME on the one decision event rather than a second event kind that would duplicate all three fields.
 */
export type RegisterDecisionOutcome = "approved" | "rejected";

/**
 * Whether a string is a decision outcome.
 *
 * @param value the candidate outcome
 * @returns true iff it is `approved` or `rejected`
 */
export function isRegisterDecisionOutcome(value: string): value is RegisterDecisionOutcome {
  return value === "approved" || value === "rejected";
}

/** What kind of thing somebody said about a proposal. `pushback` is the one the owner asked to see first. */
export type RegisterFeedbackKind = "pushback" | "acknowledgement" | "support" | "question";

/** Every feedback kind, most-important-first — the order `proposal feedback` sorts by. */
export const REGISTER_FEEDBACK_KINDS: readonly RegisterFeedbackKind[] = [
  "pushback",
  "acknowledgement",
  "support",
  "question",
];

/**
 * Whether a string is a feedback kind.
 *
 * @param value the candidate kind
 * @returns true iff it is one of the four recorded kinds
 */
export function isRegisterFeedbackKind(value: string): value is RegisterFeedbackKind {
  return (REGISTER_FEEDBACK_KINDS as readonly string[]).includes(value);
}

/** One follow-up this proposal spawned — a handover doc, a Linear ticket, a pull request. */
interface RegisterFollowUp {
  readonly ref: string;
  readonly label?: string | undefined;
}

/** The decision this proposal reached, the last time a `decided` event was recorded. */
interface RegisterDecision {
  readonly text: string;
  readonly decider: string;
  readonly decidedIso: string;
  readonly outcome: RegisterDecisionOutcome;
}

/** One piece of feedback somebody gave, folded together with the answer it did or did not get. */
export interface RegisterFeedback {
  readonly id: string;
  readonly feedbackKind: RegisterFeedbackKind;
  readonly who: string;
  readonly what: string;
  readonly where?: string | undefined;
  /** When the CLI recorded it. */
  readonly recordedIso: string;
  /** When it was actually said, when `--date` supplied it — an agent reading last week's thread today. */
  readonly occurredIso?: string | undefined;
  readonly answer?: { readonly how: string; readonly answeredIso: string } | undefined;
}

/**
 * The kinds that OWE an answer, and so can be unanswered at all.
 *
 * Two needs pull apart: see pushback so the owner can go back to whoever raised it, and still record the
 * positive replies because they are sometimes useful — while tracking everything would get noisy. Treating an acknowledgement as an open debt is exactly that
 * noise: nobody owes a reply to "sounds good", so a query that lists one has invented work.
 *
 * So all four kinds are RECORDED and all four are listed; only these two are ever UNANSWERED.
 */
export const ANSWER_OWING_FEEDBACK_KINDS: readonly RegisterFeedbackKind[] = ["pushback", "question"];

/**
 * Whether this piece of feedback is one somebody still owes an answer to.
 *
 * @param feedback the folded feedback item
 * @returns true iff its kind owes an answer and no answer event has landed against it
 */
export function feedbackIsUnanswered({ feedback }: { feedback: RegisterFeedback }): boolean {
  return feedback.answer === undefined && ANSWER_OWING_FEEDBACK_KINDS.includes(feedback.feedbackKind);
}

/** Where a `created` event came from — the only two writers this register has. */
export type RegisterSource = "publish" | "sync";

/**
 * One thing that happened to a proposal's register entry.
 *
 * ## `atIso` is when it was RECORDED. `occurredIso` is when it happened.
 *
 * Every event carries `atIso`, the instant the CLI appended it, and that is the only timestamp most of them
 * need. `decided` has always carried `decidedIso` separately, precisely because a decision is routinely
 * written down after the fact — and the same is true of a supersession, an implementation and a follow-up,
 * which had no way to say so. Backfilling July's facts in August therefore filed them all under August.
 *
 * That is not a cosmetic difference once `./drift.ts` compares them against a Notion page's own edit time: an
 * August append time against a July page edit reads as drift even when the July edit already documented the
 * thing. So the three material kinds and `feedback-recorded` take an OPTIONAL `occurredIso`, written by
 * `--date`, and drift prefers it. An event with none falls back to its append time, and a drift report says
 * which of the two it used rather than quietly presenting one as the other.
 */
export type RegisterEvent =
  /** The entry's identity. Always the first event; a slug with no `created` event does not exist. */
  | {
      readonly kind: "created";
      readonly atIso: string;
      readonly title: string;
      readonly address: ProposalAddress;
      readonly intakeId?: string | undefined;
      readonly source: RegisterSource;
    }
  /**
   * Where it lives (or its title) changed — a republish, or a later sync correcting a title. A legacy
   * `page-linked` line decodes to this kind, carrying the Notion address it named.
   */
  | {
      readonly kind: "destination-linked";
      readonly atIso: string;
      readonly title: string;
      readonly address: ProposalAddress;
    }
  /** A non-terminal status change, each with its own reason. */
  | {
      readonly kind: "status-changed";
      readonly atIso: string;
      readonly status: SettableRegisterStatus;
      readonly occurredIso?: string | undefined;
      readonly why: string;
    }
  /** A decision was reached. Sets `status` to `decided` or `rejected` as part of the same atomic fact. */
  | {
      readonly kind: "decided";
      readonly atIso: string;
      readonly decision: string;
      readonly decider: string;
      readonly decidedIso: string;
      readonly outcome: RegisterDecisionOutcome;
      readonly why: string;
    }
  /** This proposal was superseded. Sets `status: "superseded"` as part of the same atomic fact. */
  | {
      readonly kind: "superseded";
      readonly atIso: string;
      readonly by: string;
      readonly occurredIso?: string | undefined;
      readonly why: string;
    }
  /** A Slack announce permalink was recorded against this proposal. */
  | { readonly kind: "slack-linked"; readonly atIso: string; readonly permalink: string }
  /** A follow-up this proposal spawned was recorded. */
  | {
      readonly kind: "follow-up-added";
      readonly atIso: string;
      readonly ref: string;
      readonly occurredIso?: string | undefined;
      readonly label?: string | undefined;
    }
  /** The audience this proposal is addressed to was recorded or corrected. */
  | { readonly kind: "audience-set"; readonly atIso: string; readonly audience: string }
  /** Somebody said something about this proposal, and it is now tracked until it gets an answer. */
  | {
      readonly kind: "feedback-recorded";
      readonly atIso: string;
      readonly id: string;
      readonly feedbackKind: RegisterFeedbackKind;
      readonly who: string;
      readonly what: string;
      readonly where?: string | undefined;
      readonly occurredIso?: string | undefined;
    }
  /** One recorded piece of feedback was answered. Its `id` is the one the `feedback-recorded` event carried. */
  | { readonly kind: "feedback-answered"; readonly atIso: string; readonly id: string; readonly how: string };

/** The current, folded state of one proposal — what every read verb actually shows. */
export interface RegisterEntry {
  readonly slug: string;
  readonly title: string;
  readonly status: RegisterStatus;
  /** Where the proposal lives, on whichever destination published or imported it. */
  readonly address: ProposalAddress;
  readonly intakeId?: string | undefined;
  readonly audience?: string | undefined;
  readonly decision?: RegisterDecision | undefined;
  readonly supersededBy?: string | undefined;
  readonly slackPermalinks: readonly string[];
  readonly followUps: readonly RegisterFollowUp[];
  readonly feedback: readonly RegisterFeedback[];
  /** The `why` of the most recent status-setting event, if any has carried one. */
  readonly statusSummary?: string | undefined;
  readonly createdIso: string;
  readonly updatedIso: string;
  readonly source: RegisterSource;
}

/**
 * The id the NEXT `feedback-recorded` event should carry, allocated from the RAW journal.
 *
 * Two separate properties, and the second is the one that dictates this signature:
 *
 * - The id is STORED in the event rather than derived from position on read, so a line a future build cannot
 *   decode can never renumber the feedback after it and silently point an answer at the wrong objection.
 * - It is counted from the decoded EVENTS rather than from a folded entry. `loadRegisterEntry` discards the
 *   unreadable-line residue `parseRegisterJournal` reports, so allocating from a fold would happily reissue
 *   an id already taken by a line this build cannot read — defeating the forward-compatibility the stored id
 *   exists for. The caller must refuse to allocate at all while any line is unreadable; this function counts
 *   what it can see and cannot know what it cannot.
 *
 * @param events the journal's decoded events
 * @returns the next free feedback id
 */
export function nextFeedbackId({ events }: { events: readonly RegisterEvent[] }): string {
  return `f${String(events.filter((event) => event.kind === "feedback-recorded").length + 1)}`;
}

/** Attach an answer to the one piece of feedback carrying this id, leaving the rest untouched. */
function answerFeedback({
  feedback,
  id,
  how,
  atIso,
}: {
  feedback: readonly RegisterFeedback[];
  id: string;
  how: string;
  atIso: string;
}): readonly RegisterFeedback[] {
  return feedback.map((item) => (item.id === id ? { ...item, answer: { answeredIso: atIso, how } } : item));
}

/** The feedback list after one of the two feedback events — appended, or answered in place. */
function applyFeedbackEvent({
  entry,
  event,
}: {
  entry: RegisterEntry;
  event: Extract<RegisterEvent, { kind: "feedback-recorded" | "feedback-answered" }>;
}): readonly RegisterFeedback[] {
  return event.kind === "feedback-answered"
    ? answerFeedback({ atIso: event.atIso, feedback: entry.feedback, how: event.how, id: event.id })
    : [
        ...entry.feedback,
        {
          feedbackKind: event.feedbackKind,
          id: event.id,
          occurredIso: event.occurredIso,
          recordedIso: event.atIso,
          what: event.what,
          where: event.where,
          who: event.who,
        },
      ];
}

/** Fold one event into the running entry. `created` is handled by the caller, since it seeds the base entry. */
function applyRegisterEvent({ entry, event }: { entry: RegisterEntry; event: RegisterEvent }): RegisterEntry {
  switch (event.kind) {
    case "created":
      return entry;
    case "destination-linked":
      return { ...entry, address: event.address, title: event.title, updatedIso: event.atIso };
    case "status-changed":
      return { ...entry, status: event.status, statusSummary: event.why, updatedIso: event.atIso };
    case "decided":
      return {
        ...entry,
        decision: {
          decidedIso: event.decidedIso,
          decider: event.decider,
          outcome: event.outcome,
          text: event.decision,
        },
        status: event.outcome === "rejected" ? "rejected" : "decided",
        statusSummary: event.why,
        updatedIso: event.atIso,
      };
    case "superseded":
      return {
        ...entry,
        status: "superseded",
        statusSummary: event.why,
        supersededBy: event.by,
        updatedIso: event.atIso,
      };
    case "slack-linked":
      return { ...entry, slackPermalinks: [...entry.slackPermalinks, event.permalink], updatedIso: event.atIso };
    case "follow-up-added":
      return {
        ...entry,
        followUps: [...entry.followUps, { label: event.label, ref: event.ref }],
        updatedIso: event.atIso,
      };
    case "audience-set":
      return { ...entry, audience: event.audience, updatedIso: event.atIso };
    case "feedback-recorded":
    case "feedback-answered":
      return { ...entry, feedback: applyFeedbackEvent({ entry, event }), updatedIso: event.atIso };
  }
}

/**
 * Fold a proposal's whole event history into its current state.
 *
 * `undefined` when the journal has no `created` event — an empty or corrupt journal names no proposal, so
 * there is nothing to fold rather than a half-populated entry to hand back.
 *
 * @param slug the proposal's slug (the journal's own filename stem, not carried in any event)
 * @param events the journal's events, in the order they were appended
 * @returns the current entry, or `undefined` when no `created` event exists
 */
export function foldRegisterEntry({
  slug,
  events,
}: {
  slug: string;
  events: readonly RegisterEvent[];
}): RegisterEntry | undefined {
  const created = events.find(
    (event): event is Extract<RegisterEvent, { kind: "created" }> => event.kind === "created",
  );
  if (created === undefined) {
    return undefined;
  }
  let entry: RegisterEntry = {
    createdIso: created.atIso,
    feedback: [],
    followUps: [],
    address: created.address,
    intakeId: created.intakeId,
    slackPermalinks: [],
    slug,
    source: created.source,
    status: "strawman",
    title: created.title,
    updatedIso: created.atIso,
  };
  for (const event of events) {
    entry = applyRegisterEvent({ entry, event });
  }
  return entry;
}

/** One piece of feedback with no answer yet, carrying the proposal it belongs to. */
export interface UnansweredFeedback {
  readonly slug: string;
  readonly title: string;
  readonly feedback: RegisterFeedback;
}

/**
 * Every piece of feedback across a set of entries that has no answer event against it, pushback first.
 *
 * "Unanswered" is exactly one checkable thing: a `feedback-recorded` event of an ANSWER-OWING kind
 * ({@link ANSWER_OWING_FEEDBACK_KINDS}) with no `feedback-answered` event carrying its id. It is not a
 * judgement about whether the answer was good enough, and nothing infers it from a Slack thread — the
 * register only ever knows what was recorded into it.
 *
 * @param entries the folded entries to scan
 * @returns each unanswered item, sorted pushback-first then oldest-first within a kind
 */
export function unansweredFeedback({ entries }: { entries: readonly RegisterEntry[] }): readonly UnansweredFeedback[] {
  const items = entries.flatMap((entry) =>
    entry.feedback
      .filter((feedback) => feedbackIsUnanswered({ feedback }))
      .map((feedback) => ({ feedback, slug: entry.slug, title: entry.title })),
  );
  return items.toSorted((a, b) => {
    const byKind =
      REGISTER_FEEDBACK_KINDS.indexOf(a.feedback.feedbackKind) -
      REGISTER_FEEDBACK_KINDS.indexOf(b.feedback.feedbackKind);
    return byKind !== 0 ? byKind : a.feedback.recordedIso.localeCompare(b.feedback.recordedIso);
  });
}
