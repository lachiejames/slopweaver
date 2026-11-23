/**
 * The gauge source of `slopweaver supervisor tick-draft`: the `claude gauge --json` slice turned into the plan
 * rows, react-now lines and acceptance line the tick records. Split from `./tickDraftSources.ts` when the
 * chair's own budget lines joined it, along the seam `./tickCapacityDraft.ts` already cut: everything here reads
 * the gauge document.
 */
import type { z } from "zod";

import { unsetFieldAsNull } from "#lib/absent.js";

import { type ChairUnread, chairBudgetLines, chairPlansOf } from "../claude/chairBudgetAlert.js";
import type { ClaudeAccountGauge, ClaudePlanGauge } from "../claude/contracts.js";
import { fleetBudgetAlert } from "../claude/fleetAlert.js";
import { acceptanceShortfall, renderAcceptance } from "../claude/loadBalance.js";
import { claudeThresholdsFrom } from "../plans/thresholds.js";
import {
  datedInstant,
  documentWitness,
  observationOf,
  parseDocument,
  type SourceMapper,
  unavailableObservation,
} from "./tickDraftShapes.js";
import { chairPlanGaugeOf, gaugePlansOf, gaugeSlice } from "./tickGaugeShapes.js";
import type { GaugeFacts, GaugePlanFacts } from "./tickGaugeTypes.js";
import type { SourceObservation } from "./tickTypes.js";

/**
 * The chair the gauge document names, as {@link chairBudgetLines} reads it: every plan a live chair session
 * names — each of a split chair's, none of an unread one's, since an unread chair must never be warned about as
 * if it sat on a plan.
 *
 * @param document the parsed gauge slice
 * @returns the plans the chair's sessions spend, empty when the document named no chair
 */
function chairOf({ document }: { document: z.output<typeof gaugeSlice> }): { plans: readonly string[] } {
  if (document.chair === undefined) {
    return { plans: [] };
  }
  return { plans: chairPlansOf({ sessions: document.chair.sessions }) };
}

/**
 * The chair's paused plan, probed beside the sweep: its reading when the document carried one taken inside this
 * tick, and the failure when that probe failed. A reading from before the tick is never routed on, exactly as a
 * stale plan row is not (`gaugePlansOf`), but it becomes a failure rather than silence — the chair is told its wall
 * is unknown. A failure carries no instant of its own and is dated by the document, already checked. The reading
 * keeps the usage policy it carried, an absent one decoded as the register decodes it, so the chair is judged by its
 * own plan's limit.
 *
 * @param document the parsed gauge slice
 * @param startedIso when this tick started
 * @returns the probe to warn the chair from, spread into {@link chairBudgetLines}'s arguments
 */
function chairProbeOf({ document, startedIso }: { document: z.output<typeof gaugeSlice>; startedIso: string }): {
  chairReading?: ClaudePlanGauge;
  chairUnread?: ChairUnread;
} {
  const unread = document.chairUnread === undefined ? {} : { chairUnread: document.chairUnread };
  const reading = document.chairReading;
  if (reading === undefined) {
    return unread;
  }
  if (Date.parse(reading.observedAtIso) < Date.parse(startedIso)) {
    const problem = `its reading at ${reading.observedAtIso} predates this tick`;
    return { chairUnread: { alias: reading.alias, problem } };
  }
  return { ...unread, chairReading: chairPlanGaugeOf({ reading }) };
}

/**
 * Every swept plan the tick holds no usable reading for — its probe failed, or its reading predates the tick — so
 * a chair seated on one is told its wall is unknown rather than given no line once that plan leaves `gauges`.
 *
 * @param plans the document's swept plans
 * @param gauges the readings this tick kept
 * @returns each unread plan with why
 */
function sweptUnreadOf({
  plans,
  gauges,
}: {
  plans: z.output<typeof gaugeSlice>["plans"];
  gauges: readonly ClaudeAccountGauge[];
}): readonly ChairUnread[] {
  const kept = new Set(gauges.map((gauge) => gauge.alias));
  return plans.flatMap((plan): readonly ChairUnread[] => {
    if (kept.has(plan.alias)) {
      return [];
    }
    if (plan.problem !== undefined) {
      return [{ alias: plan.alias, problem: plan.problem }];
    }
    return [{ alias: plan.alias, problem: "no reading of it was taken inside this tick" }];
  });
}

/**
 * The note a tick carries when the ambient credential is not a subscription, so its readings came from each plan's
 * store rather than from the session's own login.
 *
 * @param ambient the gauge document's ambient credential
 * @returns one note, or none for a subscription credential
 */
function ambientNotesOf({ ambient }: { ambient: z.output<typeof gaugeSlice>["ambient"] }): readonly string[] {
  if (ambient.kind === "subscription") {
    return [];
  }
  return [`the ambient credential is ${ambient.kind}, so these are store readings: ${ambient.reason}`];
}

/**
 * Why a gauge capture cannot yield the fleet's budgets, or nothing when it can.
 *
 * The second guard is on the ROWS rather than on the readable gauges: a fleet whose every plan was READ but
 * carried no Fable window has the same empty list with none of the excuse. A Codex review pass found both halves
 * of that, one round apart.
 *
 * @param hasBalance whether the document carries a fleet balance — a narrowed read carries none
 * @param notes why each plan left out of the rows was left out
 * @param path the capture's path, which the reason names
 * @param rows the complete plan rows
 * @returns the reason, or undefined for a capture that yields the budgets
 */
function unavailableReason({
  hasBalance,
  notes,
  path,
  rows,
}: {
  hasBalance: boolean;
  notes: readonly string[];
  path: string;
  rows: readonly GaugePlanFacts[];
}): string | undefined {
  if (!hasBalance) {
    return `${path} is a narrowed gauge read with no fleet balance, so where the next spawn goes is unknown`;
  }
  if (rows.length === 0) {
    return `no plan in ${path} yielded a complete reading, so the fleet's budgets are unknown: ${notes.join("; ")}`;
  }
  return undefined;
}

/**
 * Where the next spawn of each class routes, and the plans level with the chair's route, off the gauge's balance.
 *
 * @param balance the gauge's fleet balance, present past the unavailable guard
 * @returns the route facts, `chairLevelWith` only when the gauge carried it
 */
function routeFactsOf({
  balance,
}: {
  balance: NonNullable<z.infer<typeof gaugeSlice>["balance"]>;
}): Pick<GaugeFacts, "chairLevelWith" | "nextAllModels" | "nextChair" | "nextFable"> {
  return {
    ...(balance.chairLevelWith === undefined ? {} : { chairLevelWith: balance.chairLevelWith }),
    nextAllModels: unsetFieldAsNull({ key: "nextAllModels", record: balance }),
    nextChair: unsetFieldAsNull({ key: "nextChair", record: balance }),
    nextFable: unsetFieldAsNull({ key: "nextFable", record: balance }),
  };
}

/**
 * The gauge: complete plan rows, the producer's own react-now lines and acceptance line, or why not.
 *
 * @returns the gauge observation, or the refusal of a document that is not `claude gauge --json`'s
 */
export const gaugeObservation: SourceMapper<GaugeFacts> = ({ capture, frame }) =>
  parseDocument({ capture, kind: "gauge", schema: gaugeSlice }).map((document): SourceObservation<GaugeFacts> => {
    const instant = datedInstant({ capture, documentIso: document.observedAtIso, frame, kind: "gauge" });
    if (instant.stale !== undefined) {
      return instant.stale;
    }
    const witness = documentWitness({ dated: true, kind: "gauge", path: capture.path });
    const { rows, weekOnly, gauges, notes } = gaugePlansOf({ frame, plans: document.plans });
    // The bars the gauge itself judged under, never the register's as of now: the lines below restate its verdicts.
    const thresholds = claudeThresholdsFrom({ fields: document.thresholds });
    // Computed before every guard: a narrowed read or a fleet with no complete ROW can still hold the chair's
    // reading, and the chair's own wall is the one warning that must survive a degraded tick.
    const chairLines = chairBudgetLines({
      chair: chairOf({ document }),
      gauges,
      sweptUnread: sweptUnreadOf({ gauges, plans: document.plans }),
      thresholds,
      ...chairProbeOf({ document, startedIso: frame.startedIso }),
    });
    const why = unavailableReason({ hasBalance: document.balance !== undefined, notes, path: capture.path, rows });
    // A fleet-wide read with no complete ROW but a fresh all-models week stays PARTIAL, naming the gap: that week
    // alone can put the chair at the routing bar, and an unavailable gauge reaches the cadence as no reading at
    // all.
    const weekOnlyCarries = why !== undefined && document.balance !== undefined && weekOnly.length > 0;
    // An unavailable observation renders its diagnostic alone, so the plan lines ride inside it: the blind tick —
    // every plan unread — is exactly the one whose plans the chair must still see listed.
    if ((why !== undefined && !weekOnlyCarries) || document.balance === undefined) {
      return unavailableObservation({
        diagnostic: [...document.planLines, ...chairLines, why].join("; "),
        observedAtIso: instant.observedAtIso,
        witness,
      });
    }
    const ambient = ambientNotesOf({ ambient: document.ambient });
    // The chair's own nearing wall leads: the gauge prints it verbatim under its chair line.
    const configured = document.plans.length;
    const reactNowLines = [...chairLines, ...fleetBudgetAlert({ configured, gauges, thresholds }).reactNow];
    const acceptance = renderAcceptance({
      shortfall: acceptanceShortfall({ configured, gauges, thresholds }),
    });
    return observationOf({
      facts: {
        ...routeFactsOf({ balance: document.balance }),
        planLines: document.planLines,
        plans: rows,
        reactNowLines,
        thresholds: document.thresholds,
        // Only when a plan has no complete row, so a tick with every plan complete journals the shape it always did.
        ...(weekOnly.length === 0 ? {} : { weekOnlyPlans: weekOnly }),
      },
      // Past the guard a set `why` is a week-only tick's, and it already carries every note, so it names its gap once.
      notes: [...(why === undefined ? notes : [why]), ...ambient],
      observedAtIso: instant.observedAtIso,
      // The briefing renders a verbatim line INSTEAD of the facts, so the react-now lines — the gauge's own
      // printed lines, the chair's first — ride in it; with the acceptance line alone they never reach the owner.
      verbatimLine: [...reactNowLines, acceptance].join("; "),
      witness,
    });
  });
