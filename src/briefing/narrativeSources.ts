/**
 * How each of the twelve recorded sources READS on the page — one formatter per member of
 * `../supervisor/tickTypes.ts`'s `TICK_SOURCE_KINDS`, and nothing else.
 *
 * Its own module rather than a switch inside `./narrative.ts`, because the two answer different questions.
 * That file decides WHICH observations reach the page and proves none was dropped; this one decides what a
 * reading of the machine's load or the model plans says in words. Keeping them apart is what stops the
 * projector becoming a large formatter with a projection buried in it.
 *
 * ## Four rules every formatter here keeps
 *
 * **The newest status decides first.** An `unavailable` observation renders its diagnostic and never exposes
 * an older good reading, which is the whole reason `SourceObservation` has three arms: the failure
 * `../supervisor/tickTypes.ts` was built to close is a page that reads "nothing open" when the truth is
 * "nobody looked". A `partial` reading renders its facts AND its diagnostic, never one of the two.
 *
 * **A verb's own line wins.** Where a recorder captured `verbatimLine`, that is what renders: the source verb
 * already wrote the sentence, and re-composing it here would be a second opinion about a reading this code
 * never took. The typed fields are what a source with no line of its own is rendered from.
 *
 * **A reference is a LINK, never text shaped like one.** A recorded pull request carries its `url`, so it
 * renders as a link run — `../bareRef.ts` refuses a bare owner/repo-and-number key on any outbound surface, and
 * writing one as plain text here would be the projection manufacturing the exact defect that gate exists for.
 * This is why a line is {@link BriefingContent} rather than a string.
 *
 * **Nothing here is fleet jargon.** These lines are COMPOSED by this projection, so `./sectionQuality.ts`
 * reads every one of them and `./fleetJargon.ts` refuses an unglossed fleet word — `the sweep`, `board rows`,
 * `landed gold`. The wording below says the same thing in words the owner has not had to learn, which is the cheaper
 * half of that rule: a substitution, never a re-composition.
 *
 * Pure: one observation in, one line of runs out. No clock, no filesystem, no `Result` — a formatter cannot
 * fail, because every arm of every observation has something true to say.
 */
import { unusedNowClause } from "../capacity/ceilingsRender.js";
import type { BriefingContent, BriefingInline } from "../outbound/briefing/types.js";
import type { GaugeFacts } from "../supervisor/tickGaugeTypes.js";
import type {
  CapacityFacts,
  CloseDoneFacts,
  DepthFacts,
  FrictionFacts,
  GithubFacts,
  LandingsFacts,
  ListenerFacts,
  RecipeDueFacts,
  ReconcileFacts,
  SourceObservation,
  SupervisorTickSources,
  TickSourceKind,
  VelocityFacts,
  WatchFacts,
} from "../supervisor/tickTypes.js";

/** How each source is labelled on the page — plain words rather than the field name a recorder uses. */
const SOURCE_LABELS: Readonly<Record<TickSourceKind, string>> = {
  capacity: "machine",
  closeDone: "finished sessions",
  depth: "context depth",
  friction: "self-improvement review",
  gauge: "model plans",
  github: "github",
  landings: "what landed",
  listener: "slack listener",
  recipeDue: "automations",
  reconcile: "board and intake",
  velocity: "pace",
  watch: "live sessions",
};

/**
 * One source's line, ready to render: its label, what it says, and how the reading went.
 *
 * `status` travels beside the runs rather than only inside them so a caller can COUNT the three kinds
 * without parsing prose back out — a day's rollup headline reports how many sources read, read partly and
 * could not be read at all.
 */
export interface NarrativeSourceLine {
  readonly kind: TickSourceKind;
  readonly label: string;
  readonly status: "read" | "partial" | "unavailable";
  /** The whole line a reader meets, label included, as the runs the renderer emits. */
  readonly content: BriefingContent;
}

/** One plain-text run. The shape every formatter here builds its line out of. */
function say({ text }: { text: string }): BriefingInline {
  return { kind: "text", text };
}

/** A number as the page prints it, so every formatter here spells one the same way. */
function count({ value }: { value: number }): string {
  return String(value);
}

/**
 * Where a spawn of one class would go, or the plain sentence for nowhere.
 *
 * Its own function rather than a conditional inside the sentence, because `null` here is a real reading —
 * every plan is too full to take one — and a coalesce would read as a default rather than as that fact.
 *
 * @param plan the plan the gauge named, `null` when none can take a session
 * @returns the phrase to put after "goes to"
 */
function planOrNowhere({ plan }: { plan: string | null }): string {
  if (plan === null) {
    return "nowhere — none can take one";
  }
  return plan;
}

/**
 * The machine reading: whether anything held, and the numbers behind it.
 *
 * @param facts the capacity reading
 * @returns the line's body, without its label
 */
function capacityBody({ facts }: { facts: CapacityFacts }): BriefingContent {
  const held =
    facts.hold && facts.holdSubjects.length > 0 ? `holding on ${facts.holdSubjects.join(" and ")}` : "nothing holding";
  // The dispatch leads the line when there is one — the owner should not have to read past three gauge
  // numbers to find out something is being looked into. One clause, naming
  // WHO: the tree behind it lives in `slopweaver machine dispatches`, per rule 7.
  // A row journalled before the dispatch readings existed carries none of them, and says so rather than
  // reading as "nothing open": an unrecorded reading is not a zero.
  const unrecorded =
    facts.dispatchOpen === undefined || facts.dispatchCovering === undefined || facts.dispatchSubject === undefined;
  let coverage = "";
  if (unrecorded) {
    coverage = "; load-investigation coverage was not recorded in this older supervisor check";
  }
  const lines = [
    `${held}; load ${facts.load1.toFixed(2)}, memory compressor ${count({ value: facts.segmentsPct })}% full, ` +
      `${count({ value: facts.swapfileCount })} swapfile(s)${diskClause({ facts })}` +
      `${registeredWorktrees({ facts })}; biggest program that is not ours is ` +
      `${facts.topForeignLabel} at ${facts.topForeignGb.toFixed(1)} GB${coverage}`,
  ];
  if (
    facts.dispatchOpen !== undefined &&
    facts.dispatchCovering !== undefined &&
    facts.dispatchSubject !== undefined &&
    facts.dispatchOpen > 0
  ) {
    // An open finding with nobody on it is the one the owner most needs to see, so the line says which it is rather
    // than reporting a count that reads like coverage: a backed-off or failed seat leaves an alert standing.
    let manned = `${count({ value: facts.dispatchCovering })} with a session on it`;
    if (facts.dispatchCovering === 0) {
      manned = "NOBODY on it yet";
    }
    lines.unshift(
      `${count({ value: facts.dispatchOpen })} load finding(s) open, ${manned}, newest on ` +
        `${facts.dispatchSubject} — \`slopweaver machine dispatches\``,
    );
  }
  return lines.map((text) => say({ text }));
}

/**
 * What is unused on every ceiling right now, and the lowest — ONE reading of the
 * plan usage left on the table, on the page the owner reads. Nothing when the capture carried none.
 *
 * @param facts the capacity reading
 * @returns the clause's runs, or none
 */
function ceilingsClause({ facts }: { facts: CapacityFacts }): BriefingContent {
  if (facts.ceilings === undefined) {
    return [];
  }
  return [say({ text: `; ${unusedNowClause({ reading: facts.ceilings })}` })];
}

/**
 * The volume's free space and the floor it holds below, when the reading was taken.
 *
 * Free GB against the floor, never a percentage: a volume 85% full with 150 GB free is no reason to hold
 * (the owner's ruling). The reading is `live/machine/diskFootprint.ts`'s and simply absent
 * when it was not taken; a row from before the floor was journalled says the free figure alone.
 */
function diskClause({ facts }: { facts: CapacityFacts }): string {
  if (facts.diskFreeGb === undefined) {
    return "";
  }
  if (facts.diskHoldFreeGb === undefined) {
    return `; disk ${facts.diskFreeGb.toFixed(1)} GB free`;
  }
  return `; disk ${facts.diskFreeGb.toFixed(1)} GB free, holding below ${String(facts.diskHoldFreeGb)} GB`;
}

/**
 * How many worktrees are registered across the declared main checkouts, and what clears them.
 *
 * Exported so the fold's one actionable disk number has a name a reader can grep for: a volume percentage is
 * a problem, and this is the step. The verb is named in the clause for the same reason — the count sat at
 * 766 for seventeen days with nothing on any surface saying what to run.
 *
 * @internal — rendered by {@link capacityBody} in this file; nothing outside it names this.
 * @param facts the capacity reading
 * @returns the clause, or the empty string when no repository answered
 */
export function registeredWorktrees({ facts }: { facts: CapacityFacts }): string {
  if (facts.registeredWorktrees === undefined) {
    return "";
  }
  return `; ${count({ value: facts.registeredWorktrees })} registered worktree(s), cleared by \`slopweaver worktree prune\``;
}

/**
 * A window's own reset as a trailing clause, or nothing on a row recorded before each window carried one.
 *
 * @param iso the window's reset instant, when the row carries it
 * @returns ` resets <iso>`, or the empty string
 */
function resetClause({ iso }: { iso: string | undefined }): string {
  if (iso === undefined) {
    return "";
  }
  return ` resets ${iso}`;
}

/**
 * Every configured plan's own `PLAN` line, appended even under the gauge's verbatim line: that line carries the
 * chair and react-now lines alone, and the plan inventory — an unreadable or paused plan included — must reach
 * the briefing whatever wins the body. A row recorded before the gauge printed them appends nothing.
 *
 * @param facts the gauge reading
 * @returns one run per plan line, or none
 */
function gaugePlanLines({ facts }: { facts: GaugeFacts }): BriefingContent {
  if (facts.planLines === undefined) {
    return [];
  }
  return facts.planLines.map((line) => say({ text: `; ${line}` }));
}

/**
 * The model plans: every readable login, and where the next new session of each class would go.
 *
 * @param facts the gauge reading
 * @returns the line's body, without its label
 */
function gaugeBody({ facts }: { facts: GaugeFacts }): BriefingContent {
  const plans = facts.plans.map((plan) => {
    // No five-hour reading is the Ultra shape (`src/claude/contracts.ts`): that plan has no five-hour cap.
    const fiveHour =
      plan.fiveHourPct === undefined
        ? "no five-hour cap"
        : `${count({ value: plan.fiveHourPct })}% of five hours${resetClause({ iso: plan.fiveHourResetsIso })}`;
    return (
      `${plan.plan} ${count({ value: plan.weekPct })}% of the week resets ${plan.resetsIso}, ` +
      `${count({ value: plan.fablePct })}% Fable${resetClause({ iso: plan.fableResetsIso })}, ${fiveHour}`
    );
  });
  const next = [
    `the next all-models session goes to ${planOrNowhere({ plan: facts.nextAllModels })}`,
    `the next Fable session goes to ${planOrNowhere({ plan: facts.nextFable })}`,
  ].join("; ");
  const reactNow = facts.reactNowLines.length === 0 ? "" : `; ${facts.reactNowLines.join("; ")}`;
  const rows = plans.length === 0 ? "no plan was readable" : plans.join(" · ");
  return [say({ text: `${rows}; ${next}${reactNow}` })];
}

/**
 * The Slack listener's grade, which is the one reading that means the bot is off the air.
 *
 * @param facts the listener reading
 * @returns the line's body, without its label
 */
function listenerBody({ facts }: { facts: ListenerFacts }): BriefingContent {
  const pid = facts.pid === null ? "no process" : `pid ${count({ value: facts.pid })}`;
  return [say({ text: `${facts.grade} on ${facts.armId}, ${pid}, socket ${facts.socketState} — ${facts.why}` })];
}

/**
 * The board and intake reading. Both generated sentences render verbatim: the verb wrote them.
 *
 * @param facts the reconcile reading
 * @returns the line's body, without its label
 */
function reconcileBody({ facts }: { facts: ReconcileFacts }): BriefingContent {
  return [
    say({
      text:
        `${facts.headline} ${facts.intakeClause} ${count({ value: facts.rankedCount })} ranked, ` +
        `${count({ value: facts.alignedCount })} aligned, ${count({ value: facts.misalignedCount })} misaligned, ` +
        `${count({ value: facts.unregisteredCount })} unregistered, ${count({ value: facts.staleAskCount })} stale, ` +
        `${count({ value: facts.starvingCount })} starving`,
    }),
  ];
}

/**
 * Every live session the watch reported, and how many it did not show.
 *
 * @param facts the watch reading
 * @returns the line's body, without its label
 */
function watchBody({ facts }: { facts: WatchFacts }): BriefingContent {
  const rows = facts.rows.map((watch) => `${watch.session} ${watch.state} on ${watch.on}`);
  const seen = rows.length === 0 ? "no live session" : rows.join(" · ");
  return [say({ text: `${seen}; ${count({ value: facts.suppressed })} not shown` })];
}

/**
 * What the close-done pass did with sessions that had finished.
 *
 * @param facts the close-done reading
 * @returns the line's body, without its label
 */
function closeDoneBody({ facts }: { facts: CloseDoneFacts }): BriefingContent {
  return [
    say({
      text:
        `${count({ value: facts.closedChats })} chat(s) closed, ` +
        `${count({ value: facts.closedLedgerRows })} record(s) closed, ` +
        `${count({ value: facts.heldBusy })} left alone as busy, ${count({ value: facts.keptOpen })} kept open`,
    }),
  ];
}

/**
 * How much context each session has used, and which could be restarted.
 *
 * @param facts the depth reading
 * @returns the line's body, without its label
 */
function depthBody({ facts }: { facts: DepthFacts }): BriefingContent {
  if (facts.rows.length === 0) {
    return [say({ text: "no session was measured" })];
  }
  return [
    say({
      text: facts.rows
        .map(
          (row) =>
            `${row.session} at ${count({ value: row.tokens })} tokens` +
            `${row.respawnCandidate ? ", worth restarting" : ""}`,
        )
        .join(" · "),
    }),
  ];
}

/**
 * Which automations are due, how late each is, and who already holds it.
 *
 * @param facts the due-ask reading
 * @returns the line's body, without its label
 */
function recipeDueBody({ facts }: { facts: RecipeDueFacts }): BriefingContent {
  if (facts.rows.length === 0) {
    return [say({ text: "nothing due" })];
  }
  return [
    say({
      text: facts.rows
        .map(
          (row) =>
            `${row.label} (${row.id}) ${row.runs === "spawn" ? "needs its own session" : "runs here"}, ` +
            `${count({ value: row.lateMinutes })} minute(s) late, ` +
            `${row.heldBy === null ? "nobody holding it" : `held by ${row.heldBy}`}`,
        )
        .join(" · "),
    }),
  ];
}

/**
 * How much the fleet finished today, with the verb's own caution carried verbatim beside it.
 *
 * @param facts the pace reading
 * @returns the line's body, without its label
 */
function velocityBody({ facts }: { facts: VelocityFacts }): BriefingContent {
  return [say({ text: `${count({ value: facts.docsLandedToday })} document(s) finished today — ${facts.caution}` })];
}

/**
 * Whether an unpublished self-improvement review is waiting — and whether anything is still writing them.
 *
 * The STALE branch comes first. A dead producer closes the gap by starving it, so without that branch the
 * line reads "nothing waiting; newest report <old date>" seventeen days after anything last wrote a report.
 * Both clauses are true and the quiet one is the one that matters, which is exactly the shape a briefing
 * must not have.
 *
 * @param facts the friction reading
 * @returns the line's body, without its label
 */
function frictionBody({ facts }: { facts: FrictionFacts }): BriefingContent {
  const newest = facts.newestReport === null ? "never run" : `newest report ${facts.newestReport}`;
  if (facts.isStale === true) {
    return [say({ text: `nothing has written a review for days — the producer has stopped; ${newest}` })];
  }
  const waiting = facts.hasGap ? "a review is waiting to be published" : "nothing waiting";
  // A row from before the staleness check existed never claims the producer is running — it did not look.
  if (facts.isStale === undefined) {
    return [say({ text: `${waiting}; ${newest}; whether anything still writes reviews was not checked then` })];
  }
  return [say({ text: `${waiting}; ${newest}` })];
}

/**
 * Where the base branch is, whether merging is held, and every open pull request the reading covered.
 *
 * Each pull request is a LINK carrying its title beside its number, which is both halves of the
 * rule at once: never a bare key as plain text (`../bareRef.ts`), and never a key with no title beside it.
 *
 * @param facts the repository reading
 * @returns the line's body, without its label
 */
function githubBody({ facts }: { facts: GithubFacts }): BriefingContent {
  const head = `main at ${facts.mainSha}; ${facts.holdStanding ? "merging is held" : "merging is open"}; `;
  if (facts.pullRequests.length === 0) {
    return [say({ text: `${head}nothing open` })];
  }
  const runs: BriefingInline[] = [say({ text: head })];
  for (const [index, pull] of facts.pullRequests.entries()) {
    if (index > 0) {
      runs.push(say({ text: " · " }));
    }
    runs.push({
      kind: "link",
      text: `${pull.repo}#${count({ value: pull.number })} ${pull.title}`,
      url: pull.url,
    });
    runs.push(say({ text: `${pull.draft ? " (draft)" : ""} — ${pull.mergeable}, checks ${pull.rollup}` }));
  }
  return runs;
}

/**
 * How many things landed. The landings themselves render as their own notes — see `./narrative.ts`.
 *
 * @param facts the landings reading
 * @returns the line's body, without its label
 */
function landingsBody({ facts }: { facts: LandingsFacts }): BriefingContent {
  return [say({ text: `${count({ value: facts.landings.length })} thing(s) landed` })];
}

/**
 * One observation's runs: its status first, its own verb's sentence where it has one, its facts otherwise.
 *
 * The `unavailable` arm carries no facts AT ALL in the type, so this cannot accidentally render a stale
 * reading under a failed one — the shape enforces the rule rather than this function remembering it.
 *
 * @param observation the reading
 * @param body how this source's facts read, called only on an arm that has them
 * @returns the reading, and — on a partial one — what it could not see
 */
function observationRuns<TFacts>({
  observation,
  body,
}: {
  observation: SourceObservation<TFacts>;
  body: (args: { facts: TFacts }) => BriefingContent;
}): BriefingContent {
  if (observation.status === "unavailable") {
    return [say({ text: `not read — ${observation.diagnostic}` })];
  }
  const line: BriefingContent =
    observation.verbatimLine === undefined
      ? body({ facts: observation.facts })
      : [say({ text: observation.verbatimLine })];
  if (observation.status === "partial") {
    return [say({ text: "read in part — " }), ...line, say({ text: ` (could not see: ${observation.diagnostic})` })];
  }
  return line;
}

/**
 * One source's whole line, label and witness included.
 *
 * @param kind which source this is
 * @param observation the reading
 * @param body how this source's facts read
 * @returns the line, ready to render as one list item
 */
function sourceLine<TFacts>({
  kind,
  observation,
  body,
  always,
}: {
  kind: TickSourceKind;
  observation: SourceObservation<TFacts>;
  body: (args: { facts: TFacts }) => BriefingContent;
  /**
   * Facts that render EVEN under the verb's own line — a reading the verb's sentence does not carry. The
   * capacity verdict names the machine alone, so the plan ceilings read in the same pass are appended here.
   */
  always?: (args: { facts: TFacts }) => BriefingContent;
}): NarrativeSourceLine {
  const label = SOURCE_LABELS[kind];
  const exit = observation.witness.exitCode;
  let appended: BriefingContent = [];
  if (always !== undefined && observation.status !== "unavailable") {
    appended = always({ facts: observation.facts });
  }
  return {
    content: [
      say({ text: `${label}: ` }),
      ...observationRuns({ body, observation }),
      ...appended,
      say({ text: ` · read at ${observation.observedAtIso} by ` }),
      { kind: "code", text: observation.witness.command },
      say({ text: exit === null ? " (no exit was watched)" : ` (exit ${count({ value: exit })})` }),
    ],
    kind,
    label,
    status: observation.status,
  };
}

/**
 * Every source of one recorded pass, as lines, in `TICK_SOURCE_KINDS` order.
 *
 * The order is the recorder's own rather than a ranking invented here, so a reader can join a line to the
 * step that produced it without a mapping table — and so two days' rollups list their sources identically.
 *
 * @param sources the pass's twelve observations
 * @returns one line per source, in declaration order
 */
export function narrativeSourceLines({ sources }: { sources: SupervisorTickSources }): readonly NarrativeSourceLine[] {
  return [
    sourceLine({ always: ceilingsClause, body: capacityBody, kind: "capacity", observation: sources.capacity }),
    sourceLine({ always: gaugePlanLines, body: gaugeBody, kind: "gauge", observation: sources.gauge }),
    sourceLine({ body: listenerBody, kind: "listener", observation: sources.listener }),
    sourceLine({ body: reconcileBody, kind: "reconcile", observation: sources.reconcile }),
    sourceLine({ body: watchBody, kind: "watch", observation: sources.watch }),
    sourceLine({ body: closeDoneBody, kind: "closeDone", observation: sources.closeDone }),
    sourceLine({ body: depthBody, kind: "depth", observation: sources.depth }),
    sourceLine({ body: recipeDueBody, kind: "recipeDue", observation: sources.recipeDue }),
    sourceLine({ body: velocityBody, kind: "velocity", observation: sources.velocity }),
    sourceLine({ body: frictionBody, kind: "friction", observation: sources.friction }),
    sourceLine({ body: githubBody, kind: "github", observation: sources.github }),
    sourceLine({ body: landingsBody, kind: "landings", observation: sources.landings }),
  ];
}
