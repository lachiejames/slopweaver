/**
 * THE CHAIR'S HAND-OFF CADENCE — when the supervisor chair should seat its successor, judged on every tick from
 * what the tick already measured.
 *
 * ## The rule, and what went wrong without this
 *
 * One plan sitting near 95 percent Fable usage while another sits near 10 percent is a problem, and a supervisor
 * that never restarts gets stuck on older versions of Claude Code. A supervisor that hands off regularly and boots
 * on a different plan each time solves both.
 *
 * MEASURED without it: a chair sat on one plan until that plan hit 100% of its seven-day window, and the owner ran
 * `/login` by hand. Its transcript recorded `"version":"2.1.280"` while seats booted that day ran 2.1.281 to
 * 2.1.283. Nothing in the tick asked either question.
 *
 * ## The five reasons, each a measurement and never a clock
 *
 * - **`plan-window-near`** — the chair's plan is at or past the install's alert bar (`alertAtPercent`, default 75) of
 *   its plan-wide or its Fable week. That is the gauge's own REACT NOW line, below `spendCapFor`'s routing cap, so
 *   the chair leaves while a successor can still land elsewhere, never at the wall. It does NOT fire while a
 *   complete gauge routes the next Fable spawn to the chair's own plan: MEASURED: a plan at 76% of its week was
 *   still the router's Fable pick (its Fable week reset first), so successive hand-offs each seated a successor
 *   back on that plan that was told to leave at its own first close (a tick's `gauge.txt` read
 *   `next fable spawn -> plan-five`). Routing bars a Fable seat at the routing bar on the plan-wide week, the last
 *   five hours included, and the chair's successor on its Fable week too (a short Fable seat keeps its lift;
 *   `../claude/fableSeatBars.ts`), so the route moves off it, and this fires, before the wall. A window at or past
 *   that bar fires even while the route still names the chair's plan: the old last-five-hours lift kept a plan at
 *   95% the Fable route, and the close read "not a reason to hand off" (`./chairCadenceBudget.ts`). Nor does it fire,
 *   under that bar, while a complete gauge routes to a different plan already at or past the alert bar on either
 *   weekly window: MEASURED, with every routable plan past 75% of its week, three chairs in a row each
 *   closed one or two passes and handed off to another plan past the bar, each boot about a third of the chair's
 *   context window spent for no headroom. The chair then leaves at the spawn bar, or once a plan under the alert bar
 *   is the route.
 * - **`plan-asymmetric`** — the chair's plan leads the plan the next Fable spawn routes to by more than the
 *   install's drifting band (`driftingSpreadPercent`, default 15) of the Fable week: the gauge's `out-of-band` band
 *   — some asymmetry between plans is fine, so only one past the band counts.
 *
 * Both bars are the plan register's (`../plans/thresholds.ts`), carried on the gauge the tick captured so a row is
 * judged under the bars its gauge was (`./chairCadenceThresholds.ts`); `./chairCadenceBudget.ts` judges them.
 * - **`plan-unmeasured`** — the chair's plan has no complete reading while the next Fable spawn routes to a
 *   different, measured plan. MEASURED: with a plan's probe failing, every tick noted the chair's budget
 *   UNMEASURED and decided nothing while that plan's Fable week went from 20% to 100%. A chair on a plan nobody can see leaves it for one somebody can.
 * - **`claude-code-behind`** — the chair's transcript names an older Claude Code than the `claude` a fresh boot
 *   runs. A successor is launched with a bare `claude` (`../cmux/bootLine.ts`), so seating one IS the upgrade.
 * - **`canon-stale`** — the chair's process has run 36 hours AND `origin/main` has
 *   changed the skill, rule or `AGENTS.md` text it loaded at boot since, so a chair never runs
 *   stale for days. Both halves, so it is never a bare clock: `./chairCanon.ts`
 *   reads and judges it.
 *
 * Context fill is deliberately NOT a sixth reason: the owner's ruling for it is soft only, so `./chairContext.ts` judges it
 * beside this verdict and prints a reminder that changes neither the verdict nor the close prompt.
 *
 * The first four are Claude constructs: a Claude plan read off its boot credential, and Claude Code versions. Only
 * `canon-stale` is provider-neutral, so a Codex chair is judged on it alone, from the instant its record took the
 * chair, with its budget and CLI freshness named UNMEASURED (`./codexChairCadence.ts`).
 *
 * This module decides only WHETHER to hand off; `./chairSuccessor.ts` decides which host the successor boots on,
 * off the plan register. A Claude successor needs no special ranking: `cmux spawn <handoff slug> --driver claude
 * --model fable` routes through `routeSpawnToPlan` like every Fable spawn — the supervisor role pins no store
 * (`../claude/seatPinning.ts`) — and its spawn carries the chair flag, so it ranks on the plan furthest below its own Fable level line, the
 * chair's Fable week lined up as a Fable seat is gated, each window measured to its own reset. The route this reads is the tick's own captured `nextChair`: `claude
 * gauge` asks `routeSpawnToPlan` with that same flag, and never the ordinary `nextFable`, which a chair would not take.
 * Beside it the gauge captures `chairLevelWith`, every plan within one point of headroom of that route
 * (`../claude/loadBalance.ts`'s `chairLevelWith`): a chair seated on one is not handed to the route over a near-tie
 * the next reading can flip, which is what told one chair to leave after one pass.
 * A tick row captured before the gauge named a chair route reads PARTIAL here, its route UNMEASURED.
 * `src/__tests__/unit/claude/routingSpreadSimulation.test.ts` runs a week of this loop over five staggered plans.
 *
 * ## The chair's plan is the credential it BOOTED on
 *
 * Each session's plan is `../claude/seatBoot.ts`'s read — the setup token on descriptor 3, else the store its
 * environment declares — the same read `claude gauge`'s `*` makes. Never telemetry's `organization.id`: MEASURED:
 * a chair holding plan-one's token on descriptor 3 stamped plan-three's organisation on every request,
 * as did every seat on the machine for six days while five plans drew down, because Claude Code stamps it from
 * `~/.claude.json`'s shared `oauthAccount` — the last hand `/login` — exactly as it does `userEmail`. Read that
 * way the cadence told two successive chairs to hand off on their first tick. Reproduce:
 * `slopweaver datadog logs 'service:claude-code @event.name:api_request -@organization.id:<plan-three org>' --from 3d`
 * counts zero while `slopweaver claude gauge` shows every plan's week moving.
 *
 * ## Advisory, loud, and never a wall
 *
 * A hard block at 600k was removed because blocking risks undesirable outcomes, so a hand-off
 * verdict never refuses the tick. `supervisor tick close` — the path every sweep takes — prints the block and then
 * the hand-off IN PLACE of the sweep prompt the chair would re-arm (`./chairHandOffPrompt.ts`); the lower
 * `tick-record` prints the block alone. Anything that could not be measured — a boot credential `ps` or `lsof`
 * could not read, a gauge the tick could not read — prints UNMEASURED and decides nothing, and one measured reason
 * is enough on its own.
 *
 * Pure: readings in, verdict out. `./chairCadenceLines.ts` renders it.
 */
import { type ClaudeCodeVersionReading, compareClaudeCodeVersions } from "../claude/claudeCodeVersion.js";
import type { GaugeChair, SeatBootPlan } from "../claude/seatBoot.js";
import { planReasons } from "./chairCadenceBudget.js";
import { chairCadenceRouteOf } from "./chairCadenceRoute.js";
import type { ChairCadenceThresholds } from "./chairCadenceThresholds.js";
import { type CanonStaleReason, type ChairCanonReading, judgeChairCanon } from "./chairCanon.js";
import type { ChairRead } from "./chairGate.js";

/** One Claude session in the pinned chair: the Claude Code it runs, and the plan it spends. */
export interface ChairCadenceSession {
  readonly sessionId: string;
  readonly pid: number;
  readonly claudeCode: ClaudeCodeVersionReading;
  /** The plan its boot credential names — the file on descriptor 3, else its declared store. */
  readonly plan: SeatBootPlan;
  /** When its process booted, and what `origin/main` has changed in its loaded canon since. */
  readonly canon: ChairCanonReading;
}

/** The tick's captured plan gauge, as much of it as the cadence reads. */
export type ChairCadenceGauge =
  | {
      readonly kind: "read";
      /** Each complete row, with the owner's usage limit when the reading carried one. */
      readonly plans: readonly {
        readonly plan: string;
        readonly weekPct: number;
        readonly fablePct: number;
        readonly usageLimitPercent?: number | undefined;
      }[];
      /** Each fresh plan with no complete row, by its all-models week alone. Absent on an older tick row. */
      readonly weekOnly?: readonly {
        readonly plan: string;
        readonly weekPct: number;
        readonly usageLimitPercent?: number | undefined;
      }[];
      /** The plan the chair's successor routes to, ranked as a chair spawn, or `null` when none can take one. */
      readonly nextChair: string | null;
      /**
       * The other plans level with `nextChair` within one point of chair headroom, a chair seated on any of which is
       * judged as if the route were its own. ABSENT on a row captured before the gauge carried it, which keeps the
       * route's own reading: no plan level with it.
       */
      readonly chairLevelWith?: readonly string[];
      /**
       * What a PARTIAL gauge read could not see, when the capture named a gap. A row it DOES carry is still a
       * complete reading — `gaugePlansOf` (`./tickGaugeShapes.ts`) rows only a fresh plan with a Fable week — so
       * the gap unmeasures the plans it left out and the route, never a row that is present.
       */
      readonly gap?: string;
      /** The alert and drifting bars this gauge was judged under, off the tick row itself. */
      readonly thresholds: ChairCadenceThresholds;
    }
  | { readonly kind: "unmeasured"; readonly why: string };

/**
 * One measured reason the chair should seat its successor now.
 *
 * @internal
 */
export type ChairCadenceReason =
  | {
      readonly kind: "plan-window-near";
      readonly alias: string;
      readonly window: "seven-day" | "seven-day Fable";
      readonly pct: number;
      /** The alert bar it was judged against. */
      readonly thresholdPercent: number;
    }
  | {
      readonly kind: "plan-asymmetric";
      readonly alias: string;
      readonly fablePct: number;
      readonly routeAlias: string;
      readonly routeFablePct: number;
      /** The drifting band it was judged against, in points. */
      readonly thresholdPoints: number;
    }
  | { readonly kind: "plan-unmeasured"; readonly alias: string; readonly routeAlias: string }
  | { readonly kind: "claude-code-behind"; readonly running: string; readonly boots: string }
  | CanonStaleReason;

/**
 * Which plan routing picks for a Fable spawn, as far as this tick's gauge can say.
 *
 * @internal
 */
export type ChairCadenceRoute =
  { readonly kind: "picks"; readonly alias: string } | { readonly kind: "none" } | { readonly kind: "unmeasured" };

/** Stay, or hand off for the reasons named; both carry whatever could not be measured. */
export type ChairCadenceVerdict =
  | { readonly kind: "stay"; readonly notes: readonly string[] }
  | {
      readonly kind: "hand-off";
      readonly reasons: readonly ChairCadenceReason[];
      readonly route: ChairCadenceRoute;
      readonly notes: readonly string[];
    };

/**
 * The Claude Code reason for one session, or the note saying why it could not be judged.
 *
 * @param session the chair session
 * @param boots the version a fresh boot runs
 * @returns the reason or the note, either possibly absent
 */
function versionReason({ session, boots }: { session: ChairCadenceSession; boots: ClaudeCodeVersionReading }): {
  reason?: ChairCadenceReason;
  note?: string;
} {
  if (session.claudeCode.kind === "unmeasured") {
    return { note: `session ${session.sessionId}: its Claude Code version is UNMEASURED — ${session.claudeCode.why}` };
  }
  if (boots.kind === "unmeasured") {
    return {};
  }
  const order = compareClaudeCodeVersions({ left: session.claudeCode.version, right: boots.version });
  if (order !== "before") {
    return {};
  }
  return { reason: { boots: boots.version, kind: "claude-code-behind", running: session.claudeCode.version } };
}

/**
 * Join the chair read, each session's boot credential and its transcript's version into one row per chair session.
 *
 * The chair read is the list of sessions, joined to the boot read by process and session id, never by position:
 * the credential belongs to the PROCESS, so two live processes resuming one session id each keep their own. A session
 * the boot read or the transcripts said nothing about reads UNMEASURED on that half rather than dropping out, so a
 * failed read can never make a chair vanish.
 *
 * @param chair the chair gate's read
 * @param plans each chair session's plan, read off the credential it booted on
 * @param versions each session's Claude Code version, by session id
 * @param canon each session's boot and the canon commits main has landed since, by session id
 * @returns one cadence row per chair session; none when the chair could not be read
 */
export function chairCadenceSessions({
  chair,
  plans,
  versions,
  canon,
}: {
  chair: ChairRead;
  plans: GaugeChair;
  versions: ReadonlyMap<string, ClaudeCodeVersionReading>;
  canon: ReadonlyMap<string, ChairCanonReading>;
}): readonly ChairCadenceSession[] {
  if (chair.kind === "unresolved") {
    return [];
  }
  return chair.sessions.map(({ sessionId, pid }): ChairCadenceSession => {
    let plan: SeatBootPlan = { kind: "unresolved", why: "the boot-credential read named no plan for this session" };
    if (plans.unread !== undefined) {
      plan = { kind: "unresolved", why: plans.unread };
    } else {
      const own = plans.sessions.find((entry) => entry.pid === pid && entry.sessionId === sessionId);
      if (own !== undefined) {
        plan = own.plan;
      }
    }
    let claudeCode: ClaudeCodeVersionReading = { kind: "unmeasured", why: "its transcript was not read" };
    const version = versions.get(sessionId);
    if (version !== undefined) {
      claudeCode = version;
    }
    let loaded: ChairCanonReading = { kind: "unmeasured", why: "its boot was not read" };
    const own = canon.get(sessionId);
    if (own !== undefined) {
      loaded = own;
    }
    return { canon: loaded, claudeCode, pid, plan, sessionId };
  });
}

/**
 * Whether two reasons say the same thing — two tabs on one plan are one reason, not two.
 *
 * @param a one reason
 * @param b another reason
 * @returns true when they are the same fact
 */
function sameReason({ a, b }: { a: ChairCadenceReason; b: ChairCadenceReason }): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What the chair's own sessions cannot tell it: the gauge, the boot version, a newer install and an empty read.
 *
 * @param gauge the tick's captured plan gauge
 * @param boots the Claude Code a fresh boot runs
 * @param newestInstalled the newest Claude Code installed
 * @param sessionCount how many chair sessions were read
 * @returns every note, in the order a reader should meet them
 */
function fleetNotes({
  gauge,
  boots,
  newestInstalled,
  sessionCount,
}: {
  gauge: ChairCadenceGauge;
  boots: ClaudeCodeVersionReading;
  newestInstalled: ClaudeCodeVersionReading;
  sessionCount: number;
}): readonly string[] {
  const notes: string[] = [];
  if (gauge.kind === "unmeasured") {
    notes.push(`the plan gauge is UNMEASURED this tick — ${gauge.why}`);
  }
  if (gauge.kind === "read" && gauge.gap !== undefined) {
    notes.push(`the plan gauge is PARTIAL this tick, so a plan it missed is UNMEASURED — ${gauge.gap}`);
  }
  if (boots.kind === "unmeasured") {
    notes.push(`the Claude Code a fresh boot runs is UNMEASURED — ${boots.why}`);
  }
  if (newestInstalled.kind === "unmeasured") {
    notes.push(`the newest Claude Code installed is UNMEASURED — ${newestInstalled.why}`);
  }
  if (
    boots.kind === "measured" &&
    newestInstalled.kind === "measured" &&
    compareClaudeCodeVersions({ left: boots.version, right: newestInstalled.version }) === "before"
  ) {
    notes.push(
      `Claude Code ${newestInstalled.version} is installed but a fresh \`claude\` boots ${boots.version}, so a successor would not run it either`,
    );
  }
  if (sessionCount === 0) {
    notes.push("no Claude session was read in the chair workspace, so its plan and Claude Code are UNMEASURED");
  }
  return notes;
}

/**
 * Every reason and note one chair session gives: its plan against the gauge, its Claude Code and its loaded canon.
 *
 * @param session the chair session
 * @param gauge the tick's captured plan gauge
 * @param boots the Claude Code a fresh boot runs
 * @param nowIso the tick's own instant, which the session's age is measured to
 * @returns the session's reasons, not yet deduplicated against other sessions', and its notes
 */
function sessionFindings({
  session,
  gauge,
  boots,
  nowIso,
}: {
  session: ChairCadenceSession;
  gauge: ChairCadenceGauge;
  boots: ClaudeCodeVersionReading;
  nowIso: string;
}): { reasons: readonly ChairCadenceReason[]; notes: readonly string[] } {
  const reasons: ChairCadenceReason[] = [];
  const notes: string[] = [];
  if (session.plan.kind === "unresolved") {
    notes.push(`session ${session.sessionId}: its plan is UNMEASURED — ${session.plan.why}`);
  } else if (session.plan.kind === "off-plan") {
    notes.push(`session ${session.sessionId}: it is OFF every configured plan — ${session.plan.why}`);
  } else if (gauge.kind === "read") {
    const judged = planReasons({ alias: session.plan.alias, gauge });
    reasons.push(...judged.reasons);
    notes.push(...judged.notes);
  }
  for (const judged of [
    versionReason({ boots, session }),
    judgeChairCanon({ canon: session.canon, nowIso, sessionId: session.sessionId }),
  ]) {
    if (judged.reason !== undefined) {
      reasons.push(judged.reason);
    }
    if (judged.note !== undefined) {
      notes.push(judged.note);
    }
  }
  return { notes, reasons };
}

/**
 * Judge whether the chair should seat its successor this tick.
 *
 * @param sessions every Claude session live in the pinned chair workspace
 * @param gauge the tick's captured plan gauge
 * @param boots the Claude Code a fresh `claude` boot runs — `claude --version` on PATH
 * @param newestInstalled the newest Claude Code installed, which a fresh boot may not yet select
 * @param nowIso the tick's own instant, which each session's age is measured to
 * @returns stay, or hand off with every measured reason; both carry what could not be measured
 */
export function judgeChairCadence({
  sessions,
  gauge,
  boots,
  newestInstalled,
  nowIso,
}: {
  sessions: readonly ChairCadenceSession[];
  gauge: ChairCadenceGauge;
  boots: ClaudeCodeVersionReading;
  newestInstalled: ClaudeCodeVersionReading;
  nowIso: string;
}): ChairCadenceVerdict {
  const reasons: ChairCadenceReason[] = [];
  const notes: string[] = [];
  const add = (reason: ChairCadenceReason): void => {
    if (!reasons.some((existing) => sameReason({ a: existing, b: reason }))) {
      reasons.push(reason);
    }
  };
  notes.push(...fleetNotes({ boots, gauge, newestInstalled, sessionCount: sessions.length }));
  for (const session of sessions) {
    const own = sessionFindings({ boots, gauge, nowIso, session });
    own.reasons.forEach(add);
    notes.push(...own.notes);
  }
  if (reasons.length === 0) {
    return { kind: "stay", notes };
  }
  return { kind: "hand-off", notes, reasons, route: chairCadenceRouteOf({ gauge }) };
}
