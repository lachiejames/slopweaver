/**
 * The monitors this installation declares, and the words each one speaks in.
 *
 * A monitor's WORDING is authored here rather than derived, for the same reason the briefing's open-page
 * cards refuse a synthesised `what`: a sentence built out of a monitor id reads like a log line, and the
 * whole value of the card is that the owner can act off the one line without opening anything.
 *
 * ## Every `what` is phrased as the owner's action, and that is forced rather than stylistic
 *
 * A card becomes a row in the hand register (`src/hand/`), whose gate REFUSES a sentence naming the fleet as
 * its actor — a step the fleet could take is work being filed rather than done, and rule 10 says a session
 * that can do a thing does it. So each `what` below names something only the owner can do, and the monitors are
 * chosen on the same criterion: a condition a session would simply fix is not a monitor.
 *
 * `bot-off-the-air` is the one worth justifying, because a session looks able to fix it. It is not: rule 2
 * bans a headless or auto-restarted model outright, and a Slack tag arriving with no session running is a
 * no-op BY DESIGN. Seating a visible bot session is the owner's, every time.
 *
 * `recipe-stopped` is the other. A scheduled row going quiet must reach the owner, structurally impossible to
 * miss, and it is never the owner's CHOICE: a seat takes the repair (`slopweaver automation repair`). What only
 * the owner can do is seat one when none has — so that is the card, and
 * a stop a seat HAS taken moves to `recipe-repairing`, the one NOTICE here: a floating note naming the recipe and
 * the seat, on no queue and asking nothing. `./card.ts` refuses any card offering restart, repair or retire.
 *
 * `codex-plan-signed-out` is the owner's by construction: only the owner's own sign-in at the provider closes it,
 * from Settings → Models or a terminal (`../plans/login.ts`).
 * Falling back to a signed-in plan stays the fleet's and unasked; the card is the half only the owner can close.
 *
 * `claude-plan-unusable` exists because a Claude plan once sat signed out about 72 hours unsaid:
 * a plan its last probe found signed out, not set up locally or failing is ONE floating card per plan, keyed by the
 * fault episode so it fires once per fault and clears when a probe reads the plan. A sign-in is the owner's command; a
 * setup-token or usage-reader fault is the owner's word to the supervisor, since nothing starts that repair on its own
 * (`./claudePlanUnusable.ts`).
 *
 * `secret-absent` is the owner's because only the owner holds the value: they mint a key in the provider's console
 * and provision it, and the fleet never does. The card puts `slopweaver secrets set <name>` on their pasteboard,
 * one per missing file. It fires only where a row the missing one goes with IS stored, so a platform this install
 * never connected stays silent (`./secretAbsent.ts`). No `floats`: every floating monitor here is one the owner asked
 * to see as a note, and none covers secrets — the card reaches the owner through the queue and
 * `monitor check --push`'s one banner.
 *
 * `resync-signed-out` exists so that a sign-in the owner must do arrives as a button in front of them:
 * a scheduled resync that stopped at a platform's sign-in page is a sign-in only the owner can do, so each origin is
 * ONE card with the command opening it in their work Chrome profile on their pasteboard. A card the owner pressed
 * Done on is held until the row's next attempt says whether it got past (`./resyncSignedOut.ts`).
 *
 * `turn-signed-out` exists so that a blocked browser sign-in reaches the owner as a high-priority floating note and
 * queue card: a bot turn blocked on a browser sign-in its answer needs is a sign-in only the owner can do, so each
 * origin is ONE floating work card with the page opened in their work Chrome. It sits ahead of
 * `resync-signed-out` because a person in a thread is waiting on it (`./turnSignedOut.ts`).
 *
 * `codex-fleet-capped` is the second NOTICE: a cap is waited out, never bought out of,
 * so nothing is the owner's to do — but the owner wants to be told the pass it is read, so the note names every
 * account and the first reset, and rule 9's Claude fallbacks keep running meanwhile (`./codexFleetCapped.ts`).
 *
 * `fleet-unhealthy`: syncs failing for everything and the bot unhealthy reach the owner as
 * ONE floating note the same pass. A check-in while jobs fail — seats repair them — and the owner's own step once the
 * bot is off the air, which only the owner can seat (`./fleetHealth.ts`). The note leads with
 * what CHANGED since the last one, keeps every failing run behind its disclosure row, and goes up only on a change,
 * paced and in the owner's waking hours (`./fleetHealthDelta.ts`).
 *
 * `console-sync-failed` fires on ONE failed run, never a threshold: a refresh the console started is one press, and
 * its failure is the reason a reading on the page stays stale. It is ONE check-in card for the whole set, keyed by
 * the latest failure to arrive with every failure behind its disclosure row, since a seat repairs it and the owner only checks
 * it. The console writes the ledger itself, since the failure can be a verb that would not start
 * (`./consoleSyncFailed.ts`).
 *
 * `fleet-runs-dry` fires on the whole fleet only, every configured provider: one plan spent is a routing outcome the next spawn
 * steps around, while hours with no Claude or Codex plan left are a choice only the owner can make (`./fleetRunsDry.ts`).
 *
 * `host-week-runs-out`: a floating note backed by a card when either model
 * host's plans TOGETHER are projected to run out before a reset, never when one plan caps while the rest carry it,
 * and opened only on a projection run below the trailing rate so it does not cry wolf (`./hostWeekRunsOut.ts`).
 *
 * `meeting-prep-due` is the third NOTICE: a prep page tagged to a meeting, floated with the page as its address in
 * the hour before it starts, so the owner never goes into a meeting without the page cut for it
 * (`./meetingPrepDue.ts`).
 *
 * `org-health` is the fourth NOTICE: the organisation's own incidents, one line floated when one starts, reopens or
 * changes severity, its Open button the incident's page, because a new incident should page
 * the owner; every quieter move is read with `org-health status` (`./orgHealth.ts`).
 *
 * `profile-unloaded` is the fifth NOTICE: a running session whose load of the owner's profile failed or never ran,
 * floated the pass it is seen, because a session can only act as the owner if it can load their profile, so such a
 * failure must reach the owner's screen at once (`./profileUnloaded.ts`).
 *
 * `fseventsd-bloated` puts fseventsd's restart on the owner's queue once its footprint passes 2 GiB, the root step
 * only the owner can run, and never while a voice call is live: the restart stalls configd for about a minute, which
 * drops the call (`./fseventsdBloated.ts`).
 *
 * Pure: declarations only, no I/O.
 */

import { fitLine } from "../hand/push/notice.js";
import { type HandContext, UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";

import { AUTOMATION_HELD_ON_YOU } from "./automationHeldOnYou.js";
import { CLAUDE_PLAN_UNUSABLE } from "./claudePlanUnusableDefinition.js";
import { fleetCapKeyLapsesAt, fleetCapUnblocks } from "./codexFleetCapped.js";
import { CODEX_PLAN_SIGNED_OUT } from "./codexPlanSignedOutDefinition.js";
import { CODEX_RESET_FAILED } from "./codexResetFailedDefinition.js";
import { CONSOLE_SYNC_UNBLOCKS } from "./consoleSyncFailed.js";
import { DEATHS_MIN, fleetHealthWhat, signalsOfKey } from "./fleetHealth.js";
import { FLEET_HEALTH_WINDOW_MS } from "./fleetHealthAttempts.js";
import { drySpellKeyLapsesAt, drySpellKeyRevision, MIN_DRY_HOURS } from "./fleetRunsDry.js";
import { FSEVENTSD_BLOATED } from "./fseventsdBloated.js";
import { HOST_WEEK_RUNS_OUT } from "./hostWeekRunsOutDefinition.js";
import { MEETING_PREP_DUE } from "./meetingPrepDue.js";
import { ORG_HEALTH } from "./orgHealth.js";
import { PROFILE_UNLOADED } from "./profileUnloaded.js";
import { PUBLICATION_LEAK } from "./publicationLeak.js";
import { RESYNC_SIGNED_OUT } from "./resyncSignedOutDefinition.js";
import { STEER_AT_RISK } from "./steerAtRisk.js";
import { TURN_SIGNED_OUT } from "./turnSignedOutDefinition.js";
import type { MonitorId, MonitorSubject } from "./types.js";

/** Everything one monitor declares about itself, apart from how its source is read. */
export interface MonitorDefinition {
  readonly id: MonitorId;
  /**
   * The short, id-safe token this monitor's hand steps are prefixed with.
   *
   * Not the id: `mon-recipe-stopped-<key>` spends 19 of the register's 60 characters before the subject is
   * named at all, and a run slug is routinely 90. `src/hand/step.ts` § ID_MAX is the constraint.
   */
  readonly prefix: string;
  /** One line for `monitor list` — what this monitor is for. */
  readonly blurb: string;
  /** The local source, named so a reader can go and look at it without reading the code. */
  readonly source: string;
  /** The sentence the card puts in front of the owner, for ONE subject. Returns the owner's action. */
  readonly what: (options: { subject: MonitorSubject }) => string;
  /** What is stopped until the owner acts — the register requires it, and a naked instruction is the reason. */
  readonly unblocks: (options: { subject: MonitorSubject }) => string;
  /**
   * What happens if the owner does nothing, built from the subject's own data, or absent to leave the card drawing
   * `unblocks` — the line the owner ranks the card by (`../hand/stepConsequence.ts`). Fitted to
   * `IF_IGNORED_CAP` by the definition, as `unblocks` is to its cap.
   */
  readonly ifIgnored?: (options: { subject: MonitorSubject }) => string;
  /** What makes the monitor stop firing, in words, for the skill and for `monitor list`. */
  readonly resolves: string;
  /**
   * The hand context every step this monitor posts DECLARES, or absent to leave the console placing the step
   * from its words.
   *
   * Declared rather than inferred from the card, because it decides where the row ranks: a `work` step is
   * `team-blocked`, the first of the ordinary tiers, and hand rows are projected ahead of asks within a tier
   * (`site/lib/queueRows.ts`). Context alone never puts a card at the very top: {@link stopsWork} does.
   */
  readonly context?: HandContext;
  /**
   * Whether every step this monitor posts STOPS the owner's work, or absent for a card that merely waits on them.
   *
   * A stopped automation stays on the owner's Queue every day it
   * stands, never buried, and it ranks straight after their priorities. The step carries this as
   * `stopsWork` (`../hand/step.ts`) and the Queue draws it under "Stopped automations"
   * (`site/lib/queueStopping.ts`), so the site never infers it from a monitor's name. Declared by
   * `recipe-stopped`, `corpus-sync-stopped` and `automation-held-on-you`.
   */
  readonly stopsWork?: true;
  /**
   * Whether `monitor check --fire` raises the floating note itself for each step this monitor newly posts.
   *
   * Every other monitor posts quietly and leaves one banner to `hand push`. This one is on because the owner
   * wants the note on their screen, not a banner pointing at a list. Each arrival's note stacks in front of
   * the notes already up, in the next cascade slot, and none of them gives way.
   */
  readonly floats?: true;
  /**
   * Whether a fired pass raises this floating monitor's note AGAIN once it is gone without the owner's press, or absent to
   * raise it only on the pass that posts the card (`./noticeReraise.ts`).
   *
   * A notice always is, being on no list. A step card is on the owner's Queue, so a lost note still reaches them
   * there — bar one where the note itself is the delivery: `claude-plan-unusable`, where a raise that failed once
   * would leave the fault with one card and no note for good.
   */
  readonly keepsNoteUp?: true;
  /**
   * The window level this monitor's floating note draws at, or absent for the ordinary level every other note
   * shares, where the newest is in front and every older title shows above it. `meeting-prep` is declared by
   * `meeting-prep-due` alone, the one note raised a level above the rest: it stays in front of every later note
   * until the meeting, in its own cascade from the top-left so it never covers an ordinary note's title.
   */
  readonly noteLevel?: "meeting-prep";
  /**
   * Whether every step this monitor posts is a NOTICE — news on the owner's screen with nothing waiting on them, left off
   * every list of what does (`../hand/step.ts`'s `notice`) — carrying the sentence the note says in place of an
   * address, or absent for a step the owner takes.
   *
   * First declared by `recipe-repairing`: a stopped job a seat is
   * fixing reaches the owner as a floating note and never shows up as a queue card or something blocked on
   * them. So a notice declares `floats` and no `context`, carries no decision, and opens no queue card. Why it
   * opens nothing is the monitor's own to say: a seat repairing a recipe and a reset Codex waits for are not one
   * sentence.
   */
  readonly notice?: { readonly unaddressed: string };
  /**
   * The sentence a card falls back to when the hand register refuses the subject's own, or absent to report
   * that refusal instead.
   *
   * A subject id is data, and the register's word gates read a `what` as prose: a recipe named `the session`
   * names the fleet as the actor. Refused on every pass, the card would never be drawn — so a monitor that must
   * never go silent declares a sentence carrying no subject, and `unblocks`, which the register only measures,
   * still names the subject.
   */
  readonly plainWhat?: string;
  /**
   * Whether this monitor may post one card PER subject, or absent to post ONE card for its whole set.
   *
   * One card is the default, and the pass REFUSES a reading from any other monitor that carries more than one
   * subject — it posts nothing and settles nothing (`./pass.ts` § readingShapeRefusal). Rule 6 draws one step
   * only the owner can take, and the fan-out this closes was measured: 25 `mon-park-*` notes in one second,
   * each a question already on the owner's queue. A monitor opts in only where every subject is a separate
   * act of theirs —`prs-backed-up`, where each pull request needs its own code-owner pick, `codex-plan-signed-out`,
   * one sign-in per plan, `secret-absent`, one paste per missing file, and `resync-signed-out`, one sign-in per
   * origin.
   */
  readonly perSubject?: true;
  /**
   * Where a subject's {@link MonitorSubject.literal} goes — the posting form refuses a paste that does not say
   * (`../hand/posting.ts`), because a paste is WHAT the owner puts somewhere, not where. Absent when no subject pastes.
   */
  readonly where?: string;
  /**
   * The instant past which the subject a step's KEY names can no longer be true, whatever any read says, or
   * absent when a key names no such instant.
   *
   * An unmeasurable pass settles nothing (`./pass.ts`), which is right for a subject that may still hold. It is
   * wrong for one that is over by construction: a `fleet-runs-dry` card names the hour its spell ends, and a
   * watch that stops the day before must not leave that card open for ever. So the pass settles a step whose
   * key has lapsed even when the monitor cannot read its source.
   */
  readonly lapsesAt?: (options: { key: string }) => string | undefined;
  /**
   * Whether an open card stays up while the monitor keeps firing, whatever subject it now reads, or absent to
   * re-cut the card whenever the subject's key changes.
   *
   * For a monitor whose subject is a forecast, the key is a choice among projected spells, and every rule for
   * choosing has a boundary drifting demand crosses back and forth — each crossing a settle and a fresh
   * floating note for the same decision (the first spell, then
   * the longest). So the card is held until the pass reads clear, or until its own key has lapsed
   * ({@link lapsesAt}), when the card is re-cut on the spell then forecast. Declared only beside `lapsesAt`, so
   * a held card never outlives the subject it names.
   */
  readonly holdsWhileFiring?: true;
  /**
   * The part of a key that must match between an open card and the firing subject for {@link holdsWhileFiring} to
   * hold it, or absent to hold any open card. `undefined` for a key carrying none, which matches nothing — so a
   * card cut before the revision existed is re-cut once.
   *
   * Holding absorbs drift in WHICH spell is carded; it must not absorb a change in what the card is about. A
   * `fleet-runs-dry` card cut while a plan was paused stood unchanged after it resumed, so every plan must be accounted for: the fleet's membership rides in the key and a changed one re-cuts.
   */
  readonly holdRevision?: (options: { key: string }) => string | undefined;
  /**
   * What WORSE means for one of this monitor's subjects, for the note's "When it gets worse" answer
   * (`./escalationHolds.ts`): a number read off the subject, its unit, and which direction is worse. Declared only
   * where a subject carries a measure that honestly orders — a footprint in bytes, a count of failing automations;
   * a monitor declaring none never offers the answer, so the button never stands for nothing.
   */
  readonly worsens?: {
    /** What the measure counts, as `monitor check` prints a hold — `bytes`, `failing automations`. */
    readonly unit: string;
    readonly direction: "higher" | "lower";
    /** The measure off one subject, or `undefined` when this subject carries none. */
    readonly measure: (options: { subject: MonitorSubject }) => number | undefined;
  };
}

/** What a `recipe-stopped` card says either side of the recipe id. */
const RECIPE_WHAT_OPEN = "Seat a repair for ";
const RECIPE_WHAT_CLOSE = " — it stopped firing and no seat has it";

/**
 * One data value as a card sentence can carry it: a terminator followed by a space inside it (`x. y`) would read
 * as a second sentence and the hand register would refuse the card on every pass, so that
 * space is dropped. `unblocks` still carries the value exactly.
 */
function oneSentence({ text }: { text: string }): string {
  return text.replaceAll(/([.?!])\s+/g, "$1");
}

/**
 * The `recipe-stopped` card's sentence, with the recipe id fitted to the room the note's cap leaves it.
 *
 * The id is data, so the sentence could grow past {@link WHAT_CAP} by arithmetic; fitting the ID rather than
 * truncating the finished sentence keeps the action and the reason whole.
 *
 * @param subject the silent row, whose `id` is its recipe id
 * @returns the one sentence, never longer than the cap
 */
function recipeWhat({ subject }: { subject: MonitorSubject }): string {
  const room = WHAT_CAP - RECIPE_WHAT_OPEN.length - RECIPE_WHAT_CLOSE.length;
  return `${RECIPE_WHAT_OPEN}${fitLine({ cap: room, text: oneSentence({ text: subject.id }) })}${RECIPE_WHAT_CLOSE}`;
}

/** What a `recipe-repairing` note says between the recipe id and the seat, and after the seat. */
const REPAIRING_WHAT_MID = " stopped firing — seat ";
const REPAIRING_WHAT_CLOSE = " is repairing it";

/**
 * The `recipe-repairing` note's sentence: the recipe and the seat repairing it, each fitted to half the room.
 *
 * Both are data. Half each rather than the id first, because a long recipe id must not push the seat — the half
 * of the note the owner is owed — off the end. A set of several names the count and leaves each pair to
 * `unblocks`.
 *
 * @param subject the taken stop, whose `id` is its recipe id and `repairedBy` the row slug, or a set's count
 * @returns the one sentence, never longer than the cap
 */
function repairingWhat({ subject }: { subject: MonitorSubject }): string {
  if (subject.repairedBy === undefined) {
    return `${subject.id} are being repaired — each is named below with the seat repairing it`;
  }
  const half = Math.floor((WHAT_CAP - REPAIRING_WHAT_MID.length - REPAIRING_WHAT_CLOSE.length) / 2);
  const recipe = fitLine({ cap: half, text: oneSentence({ text: subject.id }) });
  const seat = fitLine({ cap: half, text: oneSentence({ text: subject.repairedBy }) });
  return `${recipe}${REPAIRING_WHAT_MID}${seat}${REPAIRING_WHAT_CLOSE}`;
}

/** The monitors, in the order `monitor list` prints them and a pass posts them: most-blocked-on-the-owner first. */
export const MONITORS: readonly MonitorDefinition[] = [
  AUTOMATION_HELD_ON_YOU,
  {
    blurb:
      "A standing recipe row stopped firing and no seat has taken its repair: slots went by unrun, it keeps deferring or failing, or never ran.",
    context: "work",
    floats: true,
    id: "recipe-stopped",
    plainWhat: "Seat a repair for a stopped recipe — its id is below",
    prefix: "recipe",
    resolves:
      "the row fires again inside its own threshold, is disabled or held, or a seat takes its repair (`slopweaver automation repair`)",
    source:
      "$SLOPWEAVER_HOME/live/recipe/ — the definitions, their run stamps, the slot ledger and the repairs register",
    stopsWork: true,
    unblocks: ({ subject }) =>
      fitLine({ cap: UNBLOCKS_CAP, text: `${subject.id} — ${subject.label}`.replaceAll(/\s+/g, " ") }),
    what: ({ subject }) => recipeWhat({ subject }),
  },
  {
    blurb: "A stopped recipe a seat has taken the repair of — a floating note naming both, on no queue.",
    floats: true,
    id: "recipe-repairing",
    notice: {
      unaddressed: "nothing waits on you — the seat named here is repairing it, and this note goes when it is done",
    },
    plainWhat: "A stopped recipe is being repaired by a seat — both are named below",
    prefix: "repairing",
    resolves: "the recipe fires again, or the repair row is done, cancelled or rejected, or its run closes",
    source:
      "$SLOPWEAVER_HOME/live/recipe/repairs.jsonl against the stopped rows and each repair row's doc and run journal",
    unblocks: ({ subject }) =>
      fitLine({ cap: UNBLOCKS_CAP, text: `nothing — in hand: ${subject.label}`.replaceAll(/\s+/g, " ") }),
    what: ({ subject }) => repairingWhat({ subject }),
  },
  {
    blurb:
      "A corpus source's scheduled resync stopped firing — steered or not, since a steer says who seats it, never that it ran.",
    context: "work",
    floats: true,
    id: "corpus-sync-stopped",
    prefix: "corpus",
    resolves: "every corpus resync fires again inside its own threshold, or is disabled or held",
    source: "$SLOPWEAVER_HOME/live/recipe/ — the `resync-corpus-*` definitions, their run stamps and the slot ledger",
    stopsWork: true,
    unblocks: ({ subject }) =>
      fitLine({
        cap: UNBLOCKS_CAP,
        text: `every card, page and workstream reading the corpus — ${subject.id}: ${subject.label}`.replaceAll(
          /\s+/g,
          " ",
        ),
      }),
    what: () => "Seat the corpus resyncs — a corpus source stopped syncing",
  },
  CODEX_PLAN_SIGNED_OUT,
  CLAUDE_PLAN_UNUSABLE,
  {
    blurb:
      "A live credential is missing from this machine while a register row it goes with is stored — a row nobody set.",
    context: "work",
    id: "secret-absent",
    perSubject: true,
    plainWhat: "Store a missing secret on this machine — its name and the command are below",
    prefix: "secret",
    resolves:
      "the file is in $SLOPWEAVER_HOME/secrets/, or no other live row it goes with is stored, or the register marks it optional or retired",
    source:
      "$SLOPWEAVER_HOME/secrets/ file NAMES only, never a value, against the credential register (src/secrets/registry.ts)",
    unblocks: ({ subject }) => fitLine({ cap: UNBLOCKS_CAP, text: subject.label.replaceAll(/\s+/g, " ") }),
    what: ({ subject }) => `Store the ${subject.id} secret on this machine — it is missing beside ones already stored`,
    where: "Your own terminal — it asks for the value without echoing it, and the card clears once the file is there",
  },
  TURN_SIGNED_OUT,
  RESYNC_SIGNED_OUT,
  PUBLICATION_LEAK,
  {
    blurb:
      "No registered Codex account can take a pass and at least one is out for capacity — a note naming each reset, on no queue.",
    floats: true,
    holdsWhileFiring: true,
    id: "codex-fleet-capped",
    lapsesAt: ({ key }) => fleetCapKeyLapsesAt({ key }),
    notice: {
      unaddressed:
        "nothing waits on you — Codex takes a pass again at the first reset named here, and this note goes when it does",
    },
    plainWhat: "Codex is capped on every account — Claude fallbacks plan and review meanwhile",
    prefix: "capped",
    resolves:
      "a Codex read finds an account that can take a pass, or none is out for capacity, or the first reset passes",
    source: "the store's codex_fleet_cap row — what the last Codex fleet read concluded about every account",
    unblocks: ({ subject }) => fleetCapUnblocks({ subject }),
    what: ({ subject }) => `Codex is capped on ${subject.id} — Claude fallbacks plan and review meanwhile`,
  },
  CODEX_RESET_FAILED,
  {
    blurb: "A pull request passes every test the fleet can pass and is waiting on a code owner.",
    id: "prs-backed-up",
    perSubject: true,
    prefix: "prs",
    resolves: "the code-owner requirement clears, or the row leaves `blocked-on`",
    source: "a `slopweaver github landing --json` document, handed in with `--landing`",
    unblocks: ({ subject }) => `${subject.id} — ${subject.label}`,
    what: ({ subject }) => `Pick a code owner on ${subject.id}, so it can land`,
  },
  {
    blurb: "The Slack listener is not connected, so a tag reaches nobody.",
    id: "bot-off-the-air",
    prefix: "bot",
    resolves: "the next heartbeat reports the socket connected",
    source: "$SLOPWEAVER_HOME/live/listener/heartbeat.json",
    unblocks: ({ subject }) => `every Slack tag arriving while ${subject.label} — they are a no-op by design`,
    what: () => "Seat a visible bot session — the Slack listener is not connected",
  },
  {
    blurb: "The pinned supervisor chair is not on Fable, or nothing is pinned at all.",
    id: "chair-off-fable",
    prefix: "chair",
    resolves: "a pinned chair's ledger row reports a Fable boot model",
    source: "$SLOPWEAVER_HOME/sessions/supervisor-pin.json against the session ledger",
    unblocks: ({ subject }) => `the one chat you talk to —${subject.label}`,
    what: ({ subject }) => chairWhat({ subject }),
  },
  FSEVENTSD_BLOATED,
  {
    blurb: "The most recent restore rehearsal says the store backup would not restore into a fresh database.",
    id: "store-rehearsal-failed",
    prefix: "rehearsal",
    resolves: "the next `slopweaver store rehearse` passes",
    source: "$SLOPWEAVER_HOME/backups/store/rehearsal/last.json",
    unblocks: ({ subject }) =>
      fitLine({ cap: UNBLOCKS_CAP, text: `a store you can restore — ${subject.label}`.replaceAll(/\s+/g, " ") }),
    what: () => "Decide the fix for the store backup — its restore rehearsal failed",
  },
  {
    blurb: `Every routable Claude and Codex plan is measured spent, so no seat can start for ${String(MIN_DRY_HOURS)} hours or more.`,
    context: "work",
    floats: true,
    holdRevision: ({ key }) => drySpellKeyRevision({ key }),
    holdsWhileFiring: true,
    id: "fleet-runs-dry",
    lapsesAt: ({ key }) => drySpellKeyLapsesAt({ key }),
    prefix: "dry",
    resolves: `a combined ceilings read finds a route, a dry interval shorter than ${String(MIN_DRY_HOURS)} hours, or the named reset passes`,
    source: "the latest locally filed machine capacity reading, re-judged from its Claude and Codex ceilings",
    unblocks: ({ subject }) => fitLine({ cap: UNBLOCKS_CAP, text: `every provider-backed seat: ${subject.label}` }),
    what: () => "Decide whether to hold or shed seats — no routable Claude or Codex plan has capacity until a reset",
  },
  HOST_WEEK_RUNS_OUT,
  // Last: its card is a check-in, which ranks last on the owner's list, and the last note a pass raises is the one in front
  // of every ordinary note that pass raised.
  {
    blurb:
      "Automations failing above a share, runs dying mid-run, or the Slack listener off the air — one note for all of it.",
    context: "slopweaver",
    floats: true,
    id: "fleet-unhealthy",
    plainWhat: "Check fleet health — what is failing is named below",
    prefix: "health",
    resolves: `the last ${String(FLEET_HEALTH_WINDOW_MS / 3_600_000)}h of scheduled runs fail under the share, fewer than ${String(DEATHS_MIN)} die mid-run, and the listener is on the air`,
    source:
      "$SLOPWEAVER_HOME/live/recipe/slot-attempts/ (every firing's outcome), the repairs register, and the listener heartbeat",
    unblocks: ({ subject }) => fitLine({ cap: UNBLOCKS_CAP, text: subject.label.replaceAll(/\s+/g, " ") }),
    what: ({ subject }) =>
      fleetHealthWhat({ delta: subject.fleet?.delta, signals: signalsOfKey({ key: subject.key }) }),
    worsens: {
      direction: "higher",
      measure: ({ subject }) => subject.fleet?.shown.broken.length,
      unit: "failing automations",
    },
  },
  {
    blurb: "A refresh started by the console failed, so its displayed reading may stay stale.",
    context: "slopweaver",
    id: "console-sync-failed",
    prefix: "console-sync",
    resolves: "the failed run leaves the 24-hour action window",
    source:
      "$SLOPWEAVER_HOME/live/console-sync-failures.jsonl, and $SLOPWEAVER_HOME/console-sync-failure-append-failures.jsonl for a row it refused",
    // Fixed words, never the subject's label: the label carries a failed verb's own stderr, and the posting gates
    // that read `unblocks` refuse a proof word or a machine id in it, which would keep the card off the Queue.
    unblocks: () => CONSOLE_SYNC_UNBLOCKS,
    what: () => "Check the console sync repair — a browser-triggered refresh failed",
  },
  ORG_HEALTH,
  PROFILE_UNLOADED,
  // In front of every ordinary note before it: a deliverable the owner explicitly steered, at risk, is news for now.
  STEER_AT_RISK,
  // After fleet health, org health, an unloaded profile and a steer at risk, so a pass raising them leaves the
  // meeting's note on top: it is gone once the meeting starts.
  MEETING_PREP_DUE,
];

/**
 * The chair card's sentence, which differs between its two subjects and may name neither the supervisor
 * nor a session.
 *
 * Written as an `if` over the subject rather than one sentence covering both, because "seat a chair on
 * Fable" is wrong when nothing is pinned at all and "pin one" is wrong when a chair is sitting there on the
 * wrong model. The wording avoids the noun "supervisor" for a mechanical reason rather than a stylistic
 * one: `../hand/step.ts`'s {@link fleetActorPhrase} refuses a determiner followed by it, so the register
 * would reject the card at runtime — and `unit/monitor/registry.test.ts` is what caught exactly that.
 *
 * @param subject which of the two the chair monitor is speaking about
 * @returns the one sentence
 */
function chairWhat({ subject }: { subject: MonitorSubject }): string {
  if (subject.key === "unpinned") {
    return "Seat a Fable chair — nothing holds the pin right now";
  }
  return "Seat the chair on Fable — it booted on another model";
}

/**
 * The hand-step id one subject is posted under.
 *
 * @param prefix the monitor's own short token
 * @param subject the thing being watched, for its {@link MonitorSubject.key}
 * @returns the id, which `src/hand/step.ts` still validates
 */
export function handStepId({ prefix, subject }: { prefix: string; subject: MonitorSubject }): string {
  return `mon-${prefix}-${subject.key}`;
}

/**
 * The id one subject's card is posted under the Nth time it arrives — the base id the first time, then
 * `<base>.2`, `<base>.3` and so on.
 *
 * The hand register never takes the same id twice: a settled step stays settled, and a second posting under
 * its id is a `STEP_ID_CONFLICT`. So a subject that clears and later comes back needs a fresh id, or its card
 * is refused and never drawn. A subject key is only `[a-z0-9-]`, so a trailing
 * `.<n>` is unambiguous.
 *
 * @param base the id from {@link handStepId}
 * @param occurrence which arrival this is, counting from 1
 * @returns the id to post under
 */
export function occurrenceId({ base, occurrence }: { base: string; occurrence: number }): string {
  if (occurrence <= 1) {
    return base;
  }
  return `${base}.${String(occurrence)}`;
}

/**
 * The base id an open step was posted under, whichever occurrence it is.
 *
 * @param id an open step's id
 * @returns the id with any `.<n>` occurrence suffix removed
 */
export function occurrenceBase({ id }: { id: string }): string {
  return id.replace(/\.\d+$/, "");
}

/**
 * Which occurrence of its base an open step is — the inverse of {@link occurrenceId}.
 *
 * @param id an open step's id
 * @returns 1 for the bare base id, else the number in its `.<n>` suffix
 */
export function occurrenceNumber({ id }: { id: string }): number {
  const suffix = /\.(\d+)$/.exec(id);
  if (suffix === null) {
    return 1;
  }
  return Number(suffix[1]);
}

/** The prefix every monitor step id opens with, so the register can be filtered without knowing the monitors. */
export const MONITOR_STEP_PREFIX = "mon-";

/**
 * Look one monitor's declaration up by id.
 *
 * @returns its declaration
 */
export function monitorDefinition({ monitorId }: { monitorId: MonitorId }): MonitorDefinition {
  const found = MONITORS.find((monitor) => monitor.id === monitorId);
  if (found === undefined) {
    // Unreachable while `MonitorId` and `MONITORS` agree, and `unit/monitor/registry.test.ts` asserts they do.
    throw new Error(`no monitor is declared for ${monitorId}`);
  }
  return found;
}

/**
 * Whether a string is one of the declared monitor ids.
 *
 * Positional, which `.claude/rules/typescript-patterns.md` names as the compiler's own exception: TypeScript
 * error TS1230 forbids a type predicate over a binding pattern, so the named object cannot be written here.
 *
 * @param value the candidate, off an argv
 * @returns true when a monitor is declared under it
 */
export function isMonitorId(value: string): value is MonitorId {
  return MONITORS.some((monitor) => monitor.id === value);
}
