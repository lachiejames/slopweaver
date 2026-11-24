/**
 * The chair's hand-off cadence verdict as the lines a tick prints: the HAND OFF block a chair reads before it
 * re-arms, then every note on what could not be measured. `./chairCadence.ts` judges; this only renders.
 *
 * Pure: a verdict in, lines out.
 */
import type { ChairCadenceReason, ChairCadenceVerdict } from "./chairCadence.js";
import { canonStaleLine } from "./chairCanon.js";
import { type ChairSuccessorTarget, successorSpawnLine } from "./chairSuccessor.js";

/**
 * One reason, as the hand-off block and the hand-off prompt print it.
 *
 * @returns one line, unindented
 */
export function reasonLine({ reason }: { reason: ChairCadenceReason }): string {
  if (reason.kind === "plan-window-near") {
    return `${reason.alias} is at ${String(reason.pct)}% of its ${reason.window} week — at or past ${String(reason.thresholdPercent)}%, so leave it before the wall`;
  }
  if (reason.kind === "plan-asymmetric") {
    return (
      `${reason.alias} is at ${String(reason.fablePct)}% Fable while ${reason.routeAlias} is at ` +
      `${String(reason.routeFablePct)}% — ${String(reason.fablePct - reason.routeFablePct)} points apart, past the ${String(reason.thresholdPoints)}-point band`
    );
  }
  if (reason.kind === "plan-unmeasured") {
    return (
      `${reason.alias} has no complete reading this tick while measured ${reason.routeAlias} is the next Fable ` +
      `destination — leave the invisible plan rather than discovering its wall from the chair`
    );
  }
  if (reason.kind === "canon-stale") {
    return canonStaleLine({ reason });
  }
  if (reason.kind === "auto-compacted") {
    return (
      `session ${reason.sessionId} has been auto-compacted at least ${String(reason.autoCompactionsAtLeast)} times — ` +
      `the ${String(reason.trialCount)}-auto-compaction trial seats a successor now`
    );
  }
  return `this chair runs Claude Code ${reason.running}; a fresh boot runs ${reason.boots}`;
}

/**
 * What the lines render: a staying verdict, or a hand-off with the host its successor boots on — never a hand-off
 * without one, so no block can print a spawn the register was not asked about.
 */
export type ChairCadenceLinesInput =
  | { readonly verdict: Extract<ChairCadenceVerdict, { kind: "stay" }> }
  | {
      readonly verdict: Extract<ChairCadenceVerdict, { kind: "hand-off" }>;
      readonly target: ChairSuccessorTarget;
    };

/**
 * The lines a tick prints for the cadence verdict.
 *
 * @returns every line, unprefixed: the hand-off block first when there is one, then each note
 */
export function chairCadenceLines(input: ChairCadenceLinesInput): readonly string[] {
  const notes = input.verdict.notes.map((note) => `chair cadence: ${note}`);
  if (!("target" in input)) {
    return notes;
  }
  const { target, verdict } = input;
  let route =
    "routing names no plan that can take a Fable spawn right now — `slopweaver claude route --model fable` says why";
  if (verdict.route.kind === "picks") {
    const picked = verdict.route.alias;
    route = `route currently picks ${picked} for a Fable spawn`;
    // A near reason naming the routed plan only fires at the routing bar (`./chairCadenceBudget.ts`), so the tick's
    // captured pick is one a Fable seat is refused on — say so rather than name it as where the successor lands
    if (verdict.reasons.some((reason) => reason.kind === "plan-window-near" && reason.alias === picked)) {
      route = `this tick's gauge routed a Fable spawn to ${picked}, which is at the routing bar, so that pick is stale — the spawn re-reads every plan live and refuses ${picked} while it stays there`;
    }
  } else if (verdict.route.kind === "unmeasured") {
    route = "which plan routing picks is UNMEASURED this tick — `slopweaver claude route --model fable` names it";
  }
  return [
    "HAND OFF THIS TICK — the chair's own measurements say seat a successor now:",
    ...verdict.reasons.map((reason) => `  - ${reasonLine({ reason })}`),
    ...successorLines({ route, target }),
    ...notes,
  ];
}

/**
 * The block's last two lines: where the successor boots, and what the chair does next.
 *
 * @param route the Fable route, already rendered as evidence
 * @param target the host the successor boots on, or why none can take it
 * @returns two lines, indented under the block
 */
function successorLines({ route, target }: { route: string; target: ChairSuccessorTarget }): readonly string[] {
  if (target.kind === "none") {
    return [
      `  ${route}; no host can take the successor — ${target.why}.`,
      "  Record this tick and keep the sweep armed: a hand-off with nowhere to land moves nothing, and the next tick judges again.",
    ];
  }
  let lands = "the successor boots the current Claude Code on whatever plan routing picks";
  if (target.kind === "codex") {
    lands = "the successor boots on Codex, the registered provider that can take it";
  }
  const spawn = successorSpawnLine({ slug: "<handoff slug>", target });
  return [
    `  ${route}; ${lands}.`,
    `  Record this tick, write the handoff, then \`${spawn}\` and let the successor take the pin and re-arm the sweep — do NOT re-arm from this chair.`,
  ];
}
