/**
 * The `host-week-runs-out` declaration — a floating note backed by a Queue card when the Claude plans together, or the
 * Codex plans together, are projected to run out before a reset (`./hostWeekRunsOut.ts`). Its key shares `fleet-runs-dry`'s grammar, so the same readers hold it while the at-risk plans are
 * unchanged and lapse it at the hour the projected spell ends. Its own module because the wording is the whole of it,
 * and `./registry.ts` lists it in its place in `MONITORS`.
 */
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP } from "../hand/step.js";

import { drySpellKeyLapsesAt, drySpellKeyRevision, MIN_DRY_HOURS } from "./fleetRunsDry.js";
import type { MonitorDefinition } from "./registry.js";

/** `host-week-runs-out`: one folded card naming every model host whose plans are projected to run out. */
export const HOST_WEEK_RUNS_OUT: MonitorDefinition = {
  blurb: `A model host's routable plans, together, are projected to run out for ${String(MIN_DRY_HOURS)} hours or more before a reset — never one plan alone.`,
  context: "work",
  floats: true,
  holdRevision: ({ key }) => drySpellKeyRevision({ key }),
  holdsWhileFiring: true,
  id: "host-week-runs-out",
  lapsesAt: ({ key }) => drySpellKeyLapsesAt({ key }),
  prefix: "planweek",
  resolves:
    "the projection at the full trailing rate shows no dry hour before a reset, or the hour the projected spell ends passes",
  source:
    "the latest filed machine capacity reading and the trailing week of them (Codex), and the Claude drawdown journal's historical trend",
  unblocks: ({ subject }) => fitLine({ cap: UNBLOCKS_CAP, text: `the rest of the plan week: ${subject.label}` }),
  what: () => "Decide which work waits — Claude or Codex plans are projected to run out before a reset",
};
