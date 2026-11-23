/*
 * The plan usage block's readings, for its pure tests: the host-line and plan-row tests draw the same plans, burn and
 * seats, so they build them the same way.
 */
import type { Seat } from "../../components/live/readNow";
import type { GlancePlan, GlancePlans, GlanceWindow } from "../../lib/fleetGlancePlans";
import {
  type FleetBurn,
  type FleetUsage,
  fleetUsageOf,
  type HostFigure,
  type HostUsage,
  type UsageRead,
} from "../../lib/planMeters";
import type { PlanRow } from "../../lib/planMetersRails";

/** The reading's own instant, every reset measured from it. */
export const NOW = "2026-10-06T02:00:00.000Z";

/**
 * A window out of a hundred.
 *
 * @param key the window's name, as the capacity reading carries it
 * @returns the window
 */
export const window = ({
  key,
  used,
  resetAtIso,
}: {
  key: string;
  used: number;
  resetAtIso?: string;
}): GlanceWindow => ({
  available: 100,
  resetAtIso,
  used,
  window: key,
});

/** A Claude plan with a five-hour session, a week and a Fable week. */
export const CLAUDE: GlancePlan = {
  account: "admin@example.invalid",
  freeResets: null,
  id: "claude:plan-one",
  pause: undefined,
  provider: "claude",
  reason: undefined,
  status: "open",
  windows: [
    window({ key: "five-hour", resetAtIso: "2026-10-06T05:00:00.000Z", used: 30 }),
    window({ key: "seven-day", resetAtIso: "2026-10-08T19:00:00.000Z", used: 56 }),
    window({ key: "fable-seven-day", resetAtIso: "2026-10-09T02:00:00.000Z", used: 80 }),
  ],
};

/** A second Claude plan, its week fuller. */
export const CLAUDE_TWO: GlancePlan = {
  ...CLAUDE,
  account: "ops@example.invalid",
  id: "claude:plan-two",
  windows: [window({ key: "five-hour", used: 10 }), window({ key: "seven-day", used: 81 })],
};

/** plan-two paused on the reading's day before, its week read off the reading in force then. */
export const PAUSED: GlancePlan = {
  ...CLAUDE_TWO,
  account: "CACHED ops@example.invalid",
  pause: {
    sinceIso: "2026-10-05T07:13:00.000Z",
    weekAtPause: {
      available: 100,
      kind: "read",
      readAtIso: "2026-10-05T07:05:00.000Z",
      resetAtIso: "2026-10-07T22:00:00.000Z",
      used: 80,
    },
  },
  reason: "paused: never hit a limit",
  status: "paused",
  windows: [],
};

/** A held Codex plan with one free reset. */
export const CODEX: GlancePlan = {
  account: "codex@example.invalid",
  freeResets: 1,
  id: "codex:codex-two",
  pause: undefined,
  provider: "codex",
  reason: "five-hour window at 90%",
  status: "held",
  windows: [
    window({ key: "five-hour", resetAtIso: "2026-10-06T02:12:00.000Z", used: 90 }),
    window({ key: "weekly", resetAtIso: "2026-10-07T03:30:00.000Z", used: 40 }),
  ],
};

/** A measured burn for both hosts. */
export const BURN: FleetBurn = {
  activeWithinMinutes: 10,
  claude: {
    activeSessions: 5,
    kind: "measured",
    outputTokens: 8_950_000,
    projectedWeekTokens: 20_510_000_000,
    sessions: 210,
    totalTokens: 2_930_000_000,
  },
  codex: {
    activeSessions: 4,
    kind: "measured",
    outputTokens: 2_070_000,
    projectedWeekTokens: 2_177_000_000,
    sessions: 369,
    totalTokens: 311_000_000,
  },
  windowHours: 24,
};

/**
 * A seat with the given signal and host.
 *
 * @returns the seat, mapped and one minute quiet
 */
export const seat = ({ signal, host }: { signal: string; host: string | undefined }): Seat => ({
  attentionKind: undefined,
  cwd: "/w",
  host,
  lastActivityAtIso: undefined,
  lastEventName: "agent.hook.Stop",
  manager: undefined,
  mapped: true,
  openedAtIso: undefined,
  quietMinutes: 1,
  sessionId: undefined,
  sessionTitle: undefined,
  signal,
  title: "t",
  toolCalls: 1,
  workspaceId: "id",
  workspaceRef: "workspace:1",
});

/**
 * A read capacity document's plans.
 *
 * @param lowest the plan id the reading names as the one with least headroom
 * @returns the plans, read
 */
export const read = ({ plans, lowest }: { plans: readonly GlancePlan[]; lowest?: string }): GlancePlans => ({
  kind: "read",
  lowest,
  plans,
});

/**
 * A channel in hand.
 *
 * @returns the channel, ready with this value
 */
export const inHand = <T>({ value }: { value: T }): UsageRead<T> => ({ phase: "ready", value });

/**
 * Words for a figure.
 *
 * @returns the figure, as words
 */
export const said = ({ text }: { text: string }): HostFigure => ({ kind: "words", words: text });

/**
 * The block over these plans, no seats and the measured burn.
 *
 * @param lowest the plan id the reading names as the one with least headroom
 * @returns the block
 */
export const usage = ({ plans, lowest }: { plans: readonly GlancePlan[]; lowest?: string }): FleetUsage =>
  fleetUsageOf({
    burn: inHand({ value: BURN }),
    nowIso: NOW,
    plans: inHand({ value: read({ lowest, plans }) }),
    raiseHeld: undefined,
    seats: [],
  });

/**
 * A host's plan rows, which must have read.
 *
 * @returns the rows
 */
export const rowsOf = ({ host }: { host: HostUsage }): readonly PlanRow[] => {
  if (host.plans.kind !== "read") {
    throw new Error("the plans did not read");
  }
  return host.plans.rows;
};
