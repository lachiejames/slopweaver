/**
 * The recipe KIND registry — the half of a recurring job that lives in the repository.
 *
 * A definition file holds **params only, plus one open kind that only briefs**. So the procedure a
 * recurring job runs is a reviewed, gated, tested verb named here, and the definition outside the repository
 * only ever SELECTS one and configures it. A row chooses when and with what; it can never choose what
 * Slopweaver is allowed to do.
 *
 * ## The read/write declaration is the owner's, and it is the reason this file has an `effect` column
 *
 * Every recipe says up front whether it reads or writes, because certain recipes do both and some should only
 * read. So a definition declares its own {@link RecipeEffect}, this registry declares what each kind is
 * CAPABLE of, and {@link recipeEffectExceedsKind} refuses a row claiming more than its kind can do. The
 * declaration is checkable rather than decorative: a row saying `read` cannot select a writing kind, and the
 * briefing-only kind cannot be declared as writing at all.
 *
 * The check is deliberately one-directional. A row may declare LESS than its kind is capable of — a
 * `read-write` kind pinned to `read` by its row is a recipe the owner has chosen to keep harmless — and that
 * narrowing is always safe, so it is allowed. It may never declare MORE.
 *
 * ## Why the open kind is safe, stated rather than assumed
 *
 * {@link BRIEFING_KIND} is the one kind whose behaviour comes from the row rather than from this file, which
 * is exactly the shape every other gate here exists to prevent. What makes it admissible is that it cannot
 * act: it is `briefingOnly`, so its effect is pinned to `read` and a row declaring otherwise is refused. That
 * is not a new principle — it generalises the standing rule on the self-improvement recipe: it stays as long
 * as it does not take action automatically and only produces a briefing for the owner to react to.
 *
 * ## And it runs in the ASK LANE
 *
 * The other kinds name a procedure this repository ships. The briefing-only one names a QUESTION, so
 * `./investigate.ts` does the only thing that can honestly be done with one: it asks it, in the row's own
 * channel, through the ordinary door — and the posted message's ts is the ask's address from then on. There
 * is no second lifecycle, no second dispatcher and no second form; the clock is simply another sender.
 */

/** What a recurring job does to the world — the declaration the owner asked every recipe to make up front. */
export type RecipeEffect = "read" | "write" | "read-write";

/** One kind of recurring job: a procedure that ships in this repository, and what it is capable of. */
export interface RecipeKind {
  /** The identifier a definition names to select this kind. */
  readonly kind: string;
  /** What a reader should understand this kind to do, in one line. */
  readonly summary: string;
  /** The most this kind may ever do. A definition may declare this or less, never more. */
  readonly capability: RecipeEffect;
  /**
   * Whether this kind's behaviour is described by the ROW rather than by this repository. Exactly one kind
   * is, and it is pinned to `read` in exchange — see this module's header.
   */
  readonly briefingOnly: boolean;
  /**
   * Whether ONE run of this kind covers exactly ONE cadence slot, rather than bringing the world current.
   *
   * This is what decides whether `onMissed: backfill` can mean anything. A kind that reads everything up to
   * now — a verb behind `--if-stale`, a card summarising the latest window — covers every missed slot in one
   * run, so running it once per slot would do the same work N times: a four-hourly Notion resync that takes
   * 94 minutes, six times over. A kind whose run is scoped to its slot — one day's metrics pushed for that
   * day — leaves a permanent hole for each slot it skips, so only there does backfill walk the slots one by
   * one. `./definitionDue.ts` is where the flag is read.
   */
  readonly perSlot: boolean;
  /**
   * Whether this kind's WRITE reaches its destination through something that accepts the slot's own
   * idempotency key, so the destination itself refuses a second delivery of one firing.
   *
   * This is what decides whether an ABANDONED attempt — one whose lease expired with nothing settled, so
   * its effect may or may not have landed — may simply be run again
   * (`./slotAttempt.ts#retryAfterUnknownIsSafe`). A kind that posts through `slack post` carries the key, and
   * the door's reservation answers "did this firing already land"
   * (`outbound/slack/sendReservation.ts`). A `verb-run` row's argv is arbitrary by design, so nothing can
   * know whether its verb already wrote — such a slot is declared dead rather than retried, and handed to a
   * person.
   *
   * Meaningless for a kind that cannot write at all, and declared `false` there rather than omitted: a
   * missing field would read as "not yet decided", which is the fail-open answer.
   */
  readonly destinationTakesSlotKey: boolean;
}

/** The one kind whose procedure comes from its row, admissible only because it can never act. */
export const BRIEFING_KIND = "investigate";

/**
 * The kind whose run is long enough that it gets its own visible session.
 *
 * It selects the same wrapper verb `verb-run` does and is planned by the same planner — what differs is
 * WHERE it runs. An automation runs because a supervisor pass decided to
 * seat one, and no session stands by for it. Measured on this install: one pass over about forty resync
 * targets took 2h40m, and single targets took 29, 42 and 98 minutes, so running them in the chair's own
 * process holds the fleet's one coordinating session for hours. `./definitionShape.ts` is where that
 * becomes the `spawn` answer, and `skills/automation/SKILL.md` is what the seated session opens on.
 * A compile-only atlas's row is the exception, written on `verb-run` instead: it walks no account, needs no model and runs
 * in seconds once cached (`../resync/registrationPlan.ts`'s `resyncDefinitionFor`).
 */
export const RESYNC_KIND = "resync";

/**
 * The kind whose run hands a visible session the day's landing read of THE OWNER's pull requests to work.
 *
 * Seated for the reason `resync` is, and for a second one that is rule 2 itself: the read is a command, but
 * what follows it — pressing a ready pull request, drafting a first review ask or, with no agreed
 * discussion behind it and no obvious bug, a discussion opener instead, finishing or carding a close — is
 * judgement, and judgement happens in a session the owner can see and interrupt. So the executor
 * (`../../cli/commands/automation/hygieneRowRunner.ts`) reads, publishes `live/hygiene/github-landing.json` and
 * prints the packet into that session's transcript; it sends nothing, comments on nothing, closes nothing.
 * `./hygieneSweep.ts` plans the read, and `skills/automation/SKILL.md` § A hygiene-sweep row is what
 * the seated session does with it.
 */
export const HYGIENE_SWEEP_KIND = "hygiene-sweep";

/**
 * The kind that drives one repository's red or stale dependency bumps green, in a session seated for it.
 *
 * A scheduled ask, every 24 hours, gets the repository's dependency bump pull requests green and merged.
 * `github bump-drive` already
 * presses the bumps a verb can finish; what it cannot do is rebase one or fix its CI, so it seats a board row and
 * stops. This kind is the session that does that work. Its row runs the same wrapper verb `verb-run` does — a
 * bump-drive WORKLIST — and `skills/automation/reference/bump-fix.md` is what the seated session follows.
 */
export const BUMP_FIX_KIND = "bump-fix";

/**
 * The kind that turns Error Tracking's top issues into a weekly batch of about five fix pull requests, in a
 * session seated for it.
 *
 * Triaging the top-n error patterns over a window yields a
 * batch the shape of the security and dependency bump batches, each pull request saying the user-facing impact,
 * the blast radius and the options, posted to the owning team's channel. Seated for the reason `bump-fix` is:
 * the row's run is a read — the `datadog errors` worklist, in seconds — while picking an issue, measuring who it
 * reaches and writing the fix is judgement a session the owner can watch does (`AGENTS.md` rule 2).
 * `skills/automation/reference/error-tracking-batch.md` is what that session follows.
 */
export const ERROR_TRACKING_BATCH_KIND = "error-tracking-batch";

/**
 * The kind that drafts one tagged chase per Slack thread quiet on the owner's ask two business days or more, in a
 * session seated for it, each PARKED on the owner's queue.
 *
 * With no reply after a day, a chase tags some specific people and asks specific questions to drive engagement,
 * and the drafts show across all workstreams via the queue. Seated for the reason `bump-fix` is: the row's run is
 * the `slack awaiting` worklist, read from the corpus in seconds, while choosing whom to tag and what to ask is
 * judgement a session the owner can watch makes (`AGENTS.md` rule 2). Nothing is sent: each chase is a
 * `slack draft record` the owner approves.
 * `skills/automation/reference/thread-chase.md` is what the seated session follows. Unrelated to
 * `./silentRows.ts`, which is about scheduled ROWS that went quiet.
 */
export const THREAD_CHASE_KIND = "thread-chase";

/**
 * The kind that drafts one reply AS THE OWNER per followed Slack thread whose last word asks the owner something,
 * in a session seated for it, each PARKED on the owner's queue.
 *
 * The inverse of `thread-chase`: that one chases a thread quiet on THE OWNER's ask, this one answers a thread quiet
 * on somebody else's. MEASURED: a colleague's "what are you trying to achieve there?" under the owner's own post sat
 * 38 hours with `slack owed` listing it and nothing drafting it, while the owner went to the Queue expecting the
 * draft. Seated for the reason `thread-chase` is: the row's run is the `slack owed` worklist, read from
 * the corpus in seconds, while investigating and answering the question is judgement a session the owner can watch
 * makes (`AGENTS.md` rule 2). Nothing is sent: each reply is a `slack draft record` the owner approves (rule 10).
 * `skills/automation/reference/owed-reply.md` is what the seated session follows.
 */
export const OWED_REPLY_KIND = "owed-reply";

/**
 * The kind that classifies what the owner said on the day's calls, passage by passage, and records what was learned,
 * then classifies the day's slice of stored rows the data-class rules send for assessment, in a session seated for it
 * once a day.
 *
 * The owner ruled one daily visible reader on the plans already owned, with no new spend, so no model is called in
 * a process: the row's run is the `store assessment-due --with-calls` check, read from the call files and the store
 * in seconds, while deciding each class and what a call teaches is judgement a session the owner can watch makes
 * (`AGENTS.md` rule 2). It writes only local state — the verdict register (`talk assessment-record`,
 * `store assessment-record`) and knowledge rows — never rewords a word, never writes a stored row's class (that is
 * `store classify`'s), and never moves the public switch. `skills/automation/reference/call-assessment.md` is what the
 * seated session follows.
 */
export const CALL_ASSESSMENT_KIND = "call-assessment";

/**
 * The kind that triages the owner's Gmail inbox into cards on the owner's Queue — archive this set, reply to this,
 * send this — in a session seated for it.
 *
 * The goal is an empty inbox the owner never has to sort, with the Queue saying what to react to. Seated for the
 * reason `thread-chase` is: the row's run is the `gmail triage` worklist, read in seconds, while deciding what each
 * sender group wants is judgement a session the owner can watch makes (`AGENTS.md` rule 2). Nothing is archived,
 * sent or unsubscribed without the owner's word until a reaction becomes a standing rule, recorded as a knowledge
 * row.
 * `skills/automation/reference/inbox-triage.md` is what the seated session follows.
 */
export const INBOX_TRIAGE_KIND = "inbox-triage";

/**
 * The kind that briefs, at the end of each day, EVERY write the owner should make into Linear — comments, state
 * changes, project updates, superseded tickets, stale ones back to the backlog — as one page and one Queue card the
 * owner's yes applies, per item or all.
 *
 * This ONE read-only automation replaces the weekly project-update drafts and the daily cycle reconcile: it
 * proposes all the writes the owner should be making into Linear, the writes follow only after the owner approves
 * the briefing, and with no approval nothing happens in Linear. Seated for the reason
 * `thread-chase` is: the row's run is the `cycle reconcile --verify` worklist, read in seconds, while what each
 * ticket's evidence means is judgement a session the owner can watch makes (`AGENTS.md` rule 2). Cumulative, never a
 * 24-hour window: the evidence floor is the last briefing whose every write landed, so a missed card loses nothing.
 * `skills/automation/reference/linear-briefing.md` is what the seated session follows.
 */
export const LINEAR_BRIEFING_KIND = "linear-briefing";

/**
 * The kind that briefs the owner's weekday morning: what the owner's manager will look for by end of day, every
 * item held on the owner's permission ranked by how safely the owner could act on it unasked, the compliance
 * controls each of the owner's actions flips, and one goal line — as one local page and one Queue card, sending
 * nothing.
 *
 * The briefing comes early in the morning and anticipates what the owner's manager will expect by the end of
 * the day. Seated
 * for the reason `thread-chase` is: the row's run is the `handover currency` worklist, read in seconds, while what
 * each source means for the owner's day is judgement a session the owner can watch makes (`AGENTS.md` rule 2).
 * `skills/automation/reference/alignment-briefing.md` is what the seated session follows.
 */
export const ALIGNMENT_BRIEFING_KIND = "alignment-briefing";

/**
 * Measure how much of the Claude plans' week went unused against the seats that worked, publish it as a local
 * page, and put it on the owner's Queue when it is worth the owner's judgement.
 *
 * It answers how much of the plan usage is left on the table each week. It has no Slack destination: anything
 * worth the owner knowing or judging comes to the queue. The read is `capacity/seatCeilingRead.ts`, the
 * same one `slopweaver fleet ceiling` prints; the page and the card are `./fleetCeilingReport.ts`'s.
 */
export const FLEET_CEILING_REPORT_KIND = "fleet-ceiling-report";

/**
 * Every kind a definition may name. A closed set on purpose: adding one is a pull request, which is the
 * review this design trades the free-form prompt for.
 *
 * Its literal `kind` names stay literal (`satisfies`, never an annotation that widens them to `string`), so
 * {@link RegisteredRecipeKind} is the closed set and `automations/purposeNames.ts`'s `KIND_PURPOSES` fails to
 * compile until a new kind says, in plain words, what it is.
 *
 * @internal — read it through {@link findRecipeKind}; the purpose registry is the one other reader of the set.
 */
export const RECIPE_KINDS = [
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: false,
    kind: "metrics-push",
    perSlot: true,
    summary: "run a metrics producer this installation declares for one UTC day, and submit its points",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: false,
    kind: "verb-run",
    perSlot: false,
    summary: "run one slopweaver verb named in params, on a schedule",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: true,
    kind: "alert-summary",
    perSlot: false,
    summary: "investigate a monitored surface and post one card through the door",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: true,
    kind: "datadog-alert-digest",
    perSlot: false,
    summary: "count a declared set of Datadog probes and post one triage card through the door",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    // A page and a Queue row, never a keyed send: a same-slot retry converges on the dated slug instead, and an
    // abandoned attempt is handed to a person rather than replayed (`./fleetCeilingReport.ts`).
    destinationTakesSlotKey: false,
    kind: FLEET_CEILING_REPORT_KIND,
    perSlot: false,
    summary:
      "measure the Claude plans' unused week against the seats that worked, publish it as a local page, card " +
      "the owner's Queue when more could have run, and fail the firing when the measurement broke so a repair is seated",
  },
  {
    briefingOnly: false,
    capability: "read",
    destinationTakesSlotKey: false,
    kind: RESYNC_KIND,
    perSlot: false,
    summary: "bring one atlas or corpus source current, in a session a supervisor pass seats for it",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: false,
    kind: HYGIENE_SWEEP_KIND,
    perSlot: false,
    summary:
      "read the owner's open pull requests into the day's landing packet, for the session a supervisor pass seats",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: false,
    kind: BUMP_FIX_KIND,
    perSlot: false,
    summary:
      "drive one repository's red or stale dependency bumps green and enqueue them, in a session a supervisor " +
      "pass seats for it",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: false,
    kind: ERROR_TRACKING_BATCH_KIND,
    perSlot: false,
    summary:
      "raise about five fix pull requests from Error Tracking's top issues, each carrying impact, blast radius " +
      "and options for the owning team, in a session a supervisor pass seats for it",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: false,
    kind: THREAD_CHASE_KIND,
    perSlot: false,
    summary:
      "park one tagged chase draft per Slack thread quiet on the owner's ask two business days, for the " +
      "owner's yes, in a session a supervisor pass seats for it",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: false,
    kind: OWED_REPLY_KIND,
    perSlot: false,
    summary:
      "park one reply draft as the owner per followed Slack thread whose last word asks the owner something, " +
      "for the owner's yes, in a session a supervisor pass seats for it",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    // Local state only: a re-run reads the register and finds the day's calls already assessed.
    destinationTakesSlotKey: false,
    kind: CALL_ASSESSMENT_KIND,
    perSlot: false,
    summary:
      "classify every passage the owner spoke on the calls not yet assessed and record what they teach, never " +
      "rewording a word, in a session a supervisor pass seats for it",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: false,
    kind: INBOX_TRIAGE_KIND,
    perSlot: false,
    summary:
      "card the owner's Gmail inbox onto the owner's Queue by sender group — archive, reply, send — for the " +
      "owner's yes, in a session a supervisor pass seats for it",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: false,
    kind: LINEAR_BRIEFING_KIND,
    perSlot: false,
    summary:
      "brief every write the owner should make into Linear since it last matched reality, one page and one " +
      "Queue card the owner's yes applies, in a session a supervisor pass seats for it",
  },
  {
    briefingOnly: false,
    capability: "read-write",
    destinationTakesSlotKey: false,
    kind: ALIGNMENT_BRIEFING_KIND,
    perSlot: false,
    summary:
      "brief the owner's weekday morning against what the owner's manager will look for by end of day, as one " +
      "local page and one Queue card, sending nothing, in a session a supervisor pass seats for it",
  },
  {
    briefingOnly: true,
    capability: "read",
    destinationTakesSlotKey: true,
    kind: BRIEFING_KIND,
    perSlot: false,
    summary: "investigate a brief the row carries and produce a briefing to react to — never acts",
  },
] as const satisfies readonly RecipeKind[];

/** Every kind name this build registers — the closed set a per-kind registry is total over. */
export type RegisteredRecipeKind = (typeof RECIPE_KINDS)[number]["kind"];

/**
 * Look one kind up by name.
 *
 * @param kind the identifier a definition named
 * @returns the registered kind, or `undefined` when nothing registers that name
 */
export function findRecipeKind({ kind }: { readonly kind: string }): RecipeKind | undefined {
  return RECIPE_KINDS.find((candidate) => candidate.kind === kind);
}

/** What each effect is permitted to cover, so "declares less" can be decided without a chain of comparisons. */
const EFFECT_COVERS: Readonly<Record<RecipeEffect, readonly RecipeEffect[]>> = {
  read: ["read"],
  "read-write": ["read", "write", "read-write"],
  write: ["write"],
};

/**
 * Whether a definition's declared effect claims more than its kind can actually do.
 *
 * Deliberately not a simple equality: a row narrowing a `read-write` kind to `read` is the owner keeping a
 * capable recipe harmless, which is always safe to accept. Only the widening direction is refused.
 *
 * @param declared the effect the definition declared for itself
 * @param capability the most the selected kind can do
 * @returns true when `declared` exceeds `capability` and the definition must be refused
 */
export function recipeEffectExceedsKind({
  declared,
  capability,
}: {
  readonly declared: RecipeEffect;
  readonly capability: RecipeEffect;
}): boolean {
  return !EFFECT_COVERS[capability].includes(declared);
}
