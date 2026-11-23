/**
 * The producers' documents the tick-draft tests feed in — capacity, gauge, seat ceiling and session watch —
 * built from the PRODUCERS' own builders where they have one (`gaugeDocument`, `reportedSessionWatchRows` +
 * `sessionWatchReportDocument`), so a key the producer omits is omitted here too.
 */
import { gaugeDocument } from "../../../claude/gaugeRender.js";
import { chairPlanVerdict } from "../../../claude/seatBoot.js";
import { type ClaudeThresholds, DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import {
  reportedSessionWatchRows,
  type SessionWatchRow,
  STALE_UNMAPPED_AFTER_MS,
  sessionWatchReportDocument,
} from "../../../sessions/watchReport.js";
import { type CapturedDocument, draftTickSources } from "../../../supervisor/tickDraftSources.js";
import { CAPTURED, redirected, STARTED } from "./tickDraftSourcesFixture.js";

/** A chair the fixture never read — a gauge document must carry one either way. */
const NO_CHAIR = chairPlanVerdict({ sessions: [] });

/** The ambient credential every gauge case presents. */
const SUBSCRIPTION = { kind: "subscription" as const, reason: "no Anthropic-issued credential is configured" };

/**
 * A whole capacity report, as `machine capacity --json` flattens one, with any field overridden.
 *
 * @returns the redirected capacity document
 */
export function capacityDocument(over: Record<string, unknown> = {}): CapturedDocument {
  return redirected({
    path: "capacity.json",
    value: {
      alert: false,
      dispatch: { backoffSeconds: 0, covering: 0, open: 0, subject: "" },
      hold: true,
      holdSubjects: ["cpu"],
      load: { load1: 30.93, load15: 24.54, load5: 30.8 },
      segmentsPct: 15,
      swapfileCount: 5,
      topForeign: { classification: "foreign", footprintBytes: 5538578432, footprintGb: 5.2, label: "mds", pid: 371 },
      verdict: "machine capacity: HOLD on cpu (1-min load 30.93, hold at 22)",
      ...over,
    },
  });
}

/**
 * One readable plan's gauge, as `claude gauge --json` carries it.
 *
 * @param week the seven-day window's utilization
 * @param fable the Fable seven-day window's utilization, or no Fable window at all when undefined
 * @returns the plan's gauge
 */
export function planGauge({
  alias,
  week,
  fable,
}: {
  alias: string;
  week: number;
  fable: number | undefined;
}): Parameters<typeof gaugeDocument>[0]["outcomes"][number]["gauge"] & object {
  const window = ({
    utilization,
  }: {
    utilization: number;
  }): { resetAtIso: string; status: "allowed"; utilization: number } => ({
    resetAtIso: "2026-09-17T19:00:00.000Z",
    status: "allowed",
    utilization,
  });
  const base = {
    alias,
    allowance: { kind: "weekly-window" as const },
    fiveHour: window({ utilization: 0.13 }),
    observedAtIso: "2026-09-12T21:20:00.000Z",
    sevenDay: window({ utilization: week }),
    usageLimitPercent: 100 as const,
  };
  if (fable === undefined) {
    return base;
  }
  return { ...base, sevenDayFable: window({ utilization: fable }) };
}

/**
 * The real gauge document over a subscription credential, no chair, no cells, nothing paused and no PLAN lines.
 *
 * @returns the producer's own gauge document
 */
export function quietGaugeDocument(
  over: Omit<
    Parameters<typeof gaugeDocument>[0],
    "ambient" | "cells" | "chair" | "paused" | "planLines" | "thresholds"
  > & {
    thresholds?: ClaudeThresholds;
  },
): ReturnType<typeof gaugeDocument> {
  return gaugeDocument({
    ambient: SUBSCRIPTION,
    cells: [],
    chair: NO_CHAIR,
    paused: [],
    planLines: [],
    thresholds: DEFAULT_THRESHOLDS.claude,
    ...over,
  });
}

/**
 * A `fleet ceiling --json` document's slice the tick reads, plus a field it never keeps.
 *
 * @returns the redirected seat-ceiling document
 */
export function seatCeilingDocument({
  ceiling,
  toIso = CAPTURED,
}: {
  ceiling: unknown;
  toIso?: string;
}): CapturedDocument {
  return redirected({ path: "seat-ceiling.json", value: { ceiling, problems: [], toIso } });
}

/**
 * Draft a capacity document together with a seat-ceiling document.
 *
 * @returns the draft over both documents
 */
export function draftWithCeiling({
  seatCeiling,
}: {
  seatCeiling: CapturedDocument;
}): ReturnType<typeof draftTickSources> {
  return draftTickSources({
    capturedIso: CAPTURED,
    captures: { capacity: capacityDocument(), seatCeiling },
    startedIso: STARTED,
  });
}

/**
 * One watch row, with everything but the fields under test defaulted.
 *
 * @returns the session watch row
 */
export function watchRow({
  signal,
  title,
  attentionKind = undefined,
  mapped = true,
}: {
  signal: SessionWatchRow["signal"];
  title: string | undefined;
  attentionKind?: SessionWatchRow["attentionKind"];
  mapped?: boolean;
}): SessionWatchRow {
  return {
    attentionKind,
    cwd: "/repo/w1",
    host: "claude",
    lastActivityAtIso: "2026-10-09T10:00:00.000Z",
    lastEventName: "agent.hook.Stop",
    manager: false,
    mapped,
    openedAtIso: "2026-10-09T09:00:00.000Z",
    quietMinutes: 12,
    sessionId: "a0000106-0000-4000-8000-000000000117",
    sessionTitle: undefined,
    signal,
    title,
    toolCalls: 301,
    workspaceId: "BF7D007A",
    workspaceRef: "workspace:14",
  };
}

/**
 * A `session watch --json-report` document over the producer's own report builder.
 *
 * @returns the producer's own watch report document
 */
export function watchDocument({
  rows,
  diagnostics = [],
}: {
  rows: readonly SessionWatchRow[];
  diagnostics?: readonly string[];
}): ReturnType<typeof sessionWatchReportDocument> {
  return sessionWatchReportDocument({
    diagnostics,
    observedAtIso: "2026-09-12T21:24:00.000Z",
    report: reportedSessionWatchRows({ inventoryRead: true, rows, staleAfterMs: STALE_UNMAPPED_AFTER_MS }),
  });
}
