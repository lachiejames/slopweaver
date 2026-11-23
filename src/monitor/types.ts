/**
 * The monitor lane's vocabulary — what a monitor IS, and the four answers one can give.
 *
 * A monitor is four things and nothing else: a LOCAL read, a condition, a card, and a resolve. The shape
 * rests on a measurement: cmux raised 10,035 desktop banners in 44 days and 282 of them named the supervisor.
 *
 * ## Three states, not two
 *
 * `clear` and `unmeasurable` are DIFFERENT answers and the distinction is the whole reason this file
 * declares a union rather than a boolean. Every monitor reads local JSON whose shape nothing pins — a
 * `socketState` field, a `bootModel`, a run journal's event name, `github landing --json`. A field rename
 * makes a two-state monitor report "nothing wrong" forever, and nothing on screen distinguishes that from a
 * quiet fleet. So a monitor that cannot answer says so, and `monitor list` prints it distinctly.
 *
 * ## `steered` is the fourth, and it is not `clear` either
 *
 * A condition can hold over subjects another card or a seat already carries. `recipe-stopped` is the case: a stop
 * a seat has taken (`slopweaver automation repair`) is named by `recipe-repairing`, and a stopped corpus resync by
 * `corpus-sync-stopped`, so neither is a question on this card — but neither has stopped being stopped, and
 * calling that `clear` is the conflation the states exist to prevent. A `steered` reading posts no card, and
 * settles an old one in the summary's own words.
 *
 * Pure: types only, no I/O.
 */
import type { SignInProvider } from "../browser/signInPress.js";
import type { ClaudePlanFaultCode } from "../claude/planProbeRecord.js";
import type { HandDecisionContext } from "../hand/decisionContext.js";
import type { ResyncDemandRecord } from "../live/resync/demand.js";
import type { PlanRegisterReadError } from "../plans/errors.js";

/** Every monitor this installation declares. A closed set — a new monitor is a new member here. */
export type MonitorId =
  | "automation-held-on-you"
  | "recipe-stopped"
  | "recipe-repairing"
  | "corpus-sync-stopped"
  | "codex-plan-signed-out"
  | "claude-plan-unusable"
  | "secret-absent"
  | "turn-signed-out"
  | "resync-signed-out"
  | "publication-leak"
  | "codex-fleet-capped"
  | "codex-reset-failed"
  | "prs-backed-up"
  | "bot-off-the-air"
  | "chair-off-fable"
  | "fseventsd-bloated"
  | "store-rehearsal-failed"
  | "fleet-runs-dry"
  | "host-week-runs-out"
  | "fleet-unhealthy"
  | "console-sync-failed"
  | "meeting-prep-due"
  | "org-health"
  | "profile-unloaded"
  | "steer-at-risk";

/** One thing a monitor is watching — a pull request, a run slug, the listener, the chair. */
export interface MonitorSubject {
  /**
   * Stable across passes, and how the subject is NAMED on the card — `<owner>/<repo>#<number>`.
   *
   * Stability is load-bearing rather than tidy: the hand register is this lane's whole memory, so a subject
   * whose id changes between passes is a subject the owner gets told about forever.
   */
  readonly id: string;
  /**
   * The short, id-safe half of the hand step's own id.
   *
   * Separate from {@link MonitorSubject.id} because the two have different masters. `id` is for a reader and
   * carries a slash and a hash; a hand step's id is typed back at `hand done`, is matched against
   * `src/hand/step.ts`'s own pattern, and is capped at 60 characters — which a run slug alone already
   * exceeds. So each evaluator mints a short key and the reader's name stays on the card.
   */
  readonly key: string;
  /** What this subject is, in the owner's words — the title, the question, the reason. */
  readonly label: string;
  /**
   * The decision this subject asks the owner for, carried onto its card whole — problem, options, lean, stakes —
   * when the card is a choice with no other record (`../hand/decisionContext.ts`). Absent on every other subject.
   */
  readonly decision?: HandDecisionContext | undefined;
  /**
   * The exact text the card puts on the owner's pasteboard, when their step is a paste — the sign-in command for one
   * Codex store, the `secrets set` command for one missing secret. Drawn with the monitor's own `where`. Never a
   * command the fleet could run itself (`../hand/runnableLiteral.ts`). Absent on every other subject.
   */
  readonly literal?: string | undefined;
  /**
   * The page the pass opens on the owner's screen itself when it newly posts this subject's card — one signed-out origin,
   * opened in the owner's work Chrome through the pin — carried onto the card as `opened`. Absent on every other subject.
   */
  readonly opens?: string | undefined;
  /**
   * The page the step happens on, cited on the card when no window was opened on it — no pin to open it through, or
   * the open failed — so the card still links the place its sentence names (`../hand/placeLink.ts`). Not `url`: the
   * note's Open lands in the owner's default browser, which may be their personal profile. Absent on every other subject.
   */
  readonly page?: string | undefined;
  /**
   * The page a NOTICE's note opens with its Open button — carried onto the card as `url`, in place of the notice's
   * `unaddressed` sentence. `meeting-prep-due`'s prep page, as its viewer address `…/view?src=%2Fapi%2Fpage%2F<slug>…`. Absent on every other
   * subject.
   */
  readonly address?: string | undefined;
  /**
   * The sentence a NOTICE's note says in place of an address, when this subject's differs from its monitor's
   * `notice.unaddressed` — `steer-at-risk`'s row stopped on a question to the owner, which waits on them where every other
   * steer note's reason does not. Absent on every other subject, which takes the monitor's sentence.
   */
  readonly unaddressed?: string | undefined;
  /**
   * `steer-at-risk`'s open question to the owner, when that is the reason the row is at risk and the Queue carries it as
   * the owner's ask (`../handover/steerRisk.ts`) — what the note's opening line asks. Absent on every other subject.
   */
  readonly steerQuestion?: string | undefined;
  /**
   * `meeting-prep-due`'s meeting: its title and its wall-clock start on its own calendar, which the card's sentence
   * names. Absent on every other subject.
   */
  readonly meeting?: { readonly title: string; readonly startWall: string } | undefined;
  /**
   * `org-health`'s headline incident, in the three parts its sentence fits to the cap — `INC-98 Critical`, the title
   * made one sentence, the phase's words — and how many other incidents are open beside it. Absent on every other
   * subject.
   */
  readonly incident?:
    | {
        readonly line: { readonly ref: string; readonly title: string; readonly tail: string };
        readonly others: number;
      }
    | undefined;
  /**
   * The address the plan register caches for the plan this subject asks the owner to sign into — the owner signs in with the
   * address, never the alias. Absent on every other subject.
   */
  readonly email?: string | undefined;
  /**
   * `claude-plan-unusable`'s fault: what the plan's last probe found wrong, which decides the card's one step — the owner's
   * sign-in, or a word to the supervisor (`./claudePlanUnusable.ts`). Absent on every other subject.
   */
  readonly claudeFault?: ClaudePlanFaultCode | undefined;
  /**
   * `claude-plan-unusable`'s REGISTER fault: the plans register itself did not read, so the card is about the register
   * rather than one plan, and its step is to fix it (`./claudePlanUnusable.ts`). Absent on every other subject.
   */
  readonly claudeRegisterFault?: PlanRegisterReadError["code"] | undefined;
  /**
   * `claude-plan-unusable`'s store directory, which the card names when the register caches no address for the plan —
   * the alias alone would make the owner guess which account it is. Absent on every other subject.
   */
  readonly claudeStoreDir?: string | undefined;
  /**
   * `resync-signed-out`'s freshness: the OLDEST last success among the rows the sign-in page stopped — the stalest
   * read the owner leaves standing by doing nothing — or `never` when one of them has never synced. Absent on every other
   * subject.
   */
  readonly syncedThrough?: { readonly kind: "never" } | { readonly kind: "at"; readonly iso: string } | undefined;
  /**
   * `resync-signed-out`'s reason to walk at all: the person's mention a demand-gated atlas walked for
   * (`../live/resync/demand.ts`), so the card says who wanted the read rather than calling it routine. Absent on
   * every other subject, and on a wall a calendar resync met.
   */
  readonly wantedBy?: ResyncDemandRecord | undefined;
  /**
   * The board row whose seat is repairing this stopped recipe, when the subject is ONE taken stop — what the
   * `recipe-repairing` note names beside the recipe. Absent on a set of several and on every other subject.
   */
  readonly repairedBy?: string | undefined;
  /**
   * `recipe-stopped`'s open set as the sweep seats it: every recipe id RAW, sorted and deduplicated, and the stop
   * EPISODE's key. The id above is for a reader and may be quoted or summarised; `automation repair` needs the raw id,
   * and the card's key outlives a recovery, so `supervisor tick open` reads these (`../supervisor/stoppedRecipeSeat.ts`).
   * Absent on every other subject.
   */
  readonly repair?: StoppedRepairSet | undefined;
  /**
   * Whether this subject's card is a CHECK-IN — the fleet is already acting and the owner only checks it — rather than a
   * step that waits on them (`../hand/step.ts`'s `checkIn`). Per subject, because `fleet-unhealthy` is a check-in
   * while jobs fail and the owner's own step once the bot is off the air. Absent on every other subject.
   */
  readonly checkIn?: true | undefined;
  /**
   * The lines the card keeps behind its note's disclosure row (`../hand/details.ts`) — `fleet-unhealthy`'s every
   * failing run, when and why. Absent on every other subject.
   */
  readonly details?: readonly string[] | undefined;
  /**
   * Every one of those lines, uncut, when the card carries only their head — what `monitor check` prints, and what a
   * `+N more` last line on the note points the owner at. Absent on every other subject.
   */
  readonly detailsInFull?: readonly string[] | undefined;
  /**
   * How the pass delivers this subject's card when that differs from the default — post on arrival, stand while
   * open. `hold` posts nothing this pass and says why, leaving any open card standing; `recut` posts a fresh
   * occurrence even over an open card of the same key, superseding it. Declared by `fleet-unhealthy`, whose
   * card is paced by what CHANGED rather than by whether a card is open (`./fleetHealthDelta.ts`), and as `hold`
   * by `resync-signed-out` for a sign-in the owner already pressed Done on while the row waits on its next attempt
   * (`./resyncSignedOut.ts`).
   */
  readonly delivery?: { readonly kind: "hold"; readonly why: string } | { readonly kind: "recut" } | undefined;
  /**
   * `resync-signed-out`'s provider when its wall is the fleet's to press rather than the owner's card — why that subject is held, which a hold after the owner's Done is not. Absent on every other subject.
   */
  readonly fleetPresses?: SignInProvider | undefined;
  /**
   * `fleet-unhealthy`'s card, as data: what changed since the last note, which its sentence leads with, and what
   * this card shows, which its shell remembers once the card is posted (`./fleetHealthDelta.ts`). Absent on every
   * other subject.
   */
  readonly fleet?: { readonly delta: FleetHealthDelta; readonly shown: FleetHealthShown } | undefined;
  /**
   * `fseventsd-bloated`'s footprint in bytes, exactly as read — the measure its "When it gets worse" answer compares
   * (`./registry.ts`'s `worsens`), where `label` carries only the rounded GB. Absent on every other subject.
   */
  readonly footprintBytes?: number | undefined;
}

/**
 * What changed between the last `fleet-unhealthy` note and this pass. Declared here rather than beside its logic
 * because {@link MonitorSubject} carries it, and this file imports nothing but types.
 */
export interface FleetHealthDelta {
  /** Failing now and not on the last note — every row, when there was no last note. */
  readonly newlyFailing: readonly string[];
  /** On the last note and not failing now. */
  readonly recovered: readonly string[];
  readonly stillFailing: readonly string[];
  /** The listener against the last note: `down` and `back` are news, `still-down` and `up` are not. */
  readonly bot: "down" | "back" | "still-down" | "up";
  /**
   * The job signals (`syncs`, `deaths`) tripped now and not on the last note — every one, when there was no last
   * note. Deaths trip on a whole day's runs, so they can stand while no row is failing now: a row that died and
   * then ran clean is still a death, and the signal tripping is news whatever the rows say.
   */
  readonly tripped: readonly string[];
  /** The job signals on the last note and not tripped now. */
  readonly untripped: readonly string[];
  /**
   * The rows whose card of the owner's moved since the last note: one now waits on a card that note gave no button to, or —
   * only while that note is still up — the card its button opens is no longer open. Either way the note on the owner's screen
   * says the wrong thing about whose move it is.
   */
  readonly handMoved: readonly string[];
}

/**
 * What one posted `fleet-unhealthy` card showed: the rows failing as of its pass, and whether the bot was off the air.
 */
export interface FleetHealthShown {
  /** The instant the card was posted at. */
  readonly shownIso: string;
  /** Every recipe id whose newest counted run in the window failed or died, sorted. */
  readonly broken: readonly string[];
  readonly botDown: boolean;
  /** The job signals tripped as of its pass, in key order. */
  readonly signals: readonly string[];
  /** Each row it said needs the owner, as `<recipe id> <card id>` — the card its button opens — sorted. */
  readonly yours: readonly string[];
}

/** A monitor answered, and what it saw. */
export type MonitorReading = FiringReading | ClearReading | SteeredReading | UnmeasurableReading;

/** The monitor's condition holds over at least one subject. */
export interface FiringReading {
  readonly state: "firing";
  readonly monitorId: MonitorId;
  /** Every subject the condition currently holds over, not only the new ones. */
  readonly subjects: readonly MonitorSubject[];
  /**
   * Part of the source could not be read, so `subjects` may be short — why, when that is so.
   *
   * The pass still posts every subject it DID see. It settles an open card only when a replacement arrived in
   * the same pass, since a subject missing from a partial read has not been observed clearing. One malformed recipe file used to blind the whole monitor instead,
   * leaving a genuinely stopped sibling with no card.
   */
  readonly blindSpot?: string | undefined;
  /**
   * Whether this reading could not enumerate its subjects at all, so NO open card departs on it — not even when one
   * of its subjects posts. A {@link FiringReading.blindSpot} alone still settles a departed card once a replacement
   * went up the same pass; a register that does not read has no plans to replace, so the one card it posts is about
   * the register and every plan's own card stands (`./claudePlanUnusable.ts`).
   */
  readonly preservesDepartures?: true | undefined;
  /** Subjects beside {@link FiringReading.subjects} a seat or another card already carries — reported, never carded. */
  readonly steers?: readonly SteeredSummary[] | undefined;
}

/**
 * The monitor read its source and the condition holds over nothing.
 *
 * @internal -- a member of {@link MonitorReading}, which is what every caller narrows; nothing names this
 * arm on its own, and the union is the contract.
 */
export interface ClearReading {
  readonly state: "clear";
  readonly monitorId: MonitorId;
  /**
   * What a clear projection measured, printed under `clear` by `monitor check` and never carded — so the maths a card
   * would carry can be read when nothing fires (`./hostWeekRunsOut.ts`).
   */
  readonly evidence?: readonly string[] | undefined;
}

/**
 * One stopped set as a repair seat takes it: the raw recipe ids, sorted and deduplicated, and the episode key — every
 * row's recipe id, cadence and last run, so a set that recovered and stopped again is a new episode under the same card
 * key.
 */
export interface StoppedRepairSet {
  readonly recipeIds: readonly string[];
  readonly episodeKey: string;
}

/** A set of subjects one recorded owner steer already answers, summarised rather than listed. */
export interface SteeredSummary {
  /**
   * `repair-taken` for the stops a seat has taken, `supervisor-held` for the stops the supervisor holds, or
   * `corpus-sync-stopped` for the resyncs that card carries.
   */
  readonly steerId: string;
  /** How many subjects it answers. */
  readonly count: number;
  /** What happens instead of asking the owner, in one clause. */
  readonly instead: string;
  /**
   * The stopped set this summary keeps off the card while still owed a seat — `CLOSED_BY_OWNER_SUMMARY_ID` only: the owner's Done holds the
   * card, never the repair. Absent on every other summary.
   */
  readonly repair?: StoppedRepairSet | undefined;
}

/**
 * The condition holds, and only over subjects a recorded owner steer already answers: nothing for the owner to do.
 *
 * @internal -- a member of {@link MonitorReading}, which is what every caller narrows.
 */
export interface SteeredReading {
  readonly state: "steered";
  readonly monitorId: MonitorId;
  readonly steers: readonly SteeredSummary[];
}

/** The monitor could not read its source, or read a shape it does not understand. Never `clear`. */
export interface UnmeasurableReading {
  readonly state: "unmeasurable";
  readonly monitorId: MonitorId;
  /** What stopped it, for a reader deciding whether the lane or the source is broken. */
  readonly because: string;
}
