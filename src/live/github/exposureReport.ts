/**
 * The printed form of a `github exposure inventory`, and whether it is complete.
 *
 * It renders the inventory's own counts and nothing else: the inventory carries no identity, body or excerpt, so
 * there is nothing private here to leak. Complete means no surface is `partial` or `read-failed`; a surface that is
 * off, or that the API cannot reach, is reported and does not make the report incomplete.
 */

import type { GithubExposureInventory, GithubExposureState } from "./exposureModel.js";

/**
 * Whether every surface was counted exactly, was off, or is out of the API's reach.
 *
 * @returns true when no surface is partial or failed
 */
export function githubExposureComplete({ inventory }: { inventory: GithubExposureInventory }): boolean {
  return inventory.surfaces.every(({ state }) => state.kind !== "partial" && state.kind !== "read-failed");
}

/** The count column for one state. */
function countCell({ state }: { state: GithubExposureState }): string {
  if (state.kind === "counted") {
    return String(state.count);
  }
  if (state.kind === "partial") {
    return `>=${String(state.observedAtLeast)}`;
  }
  return "-";
}

/** The indented lines under one surface: its gaps, then its limits. */
function noteLines({ state }: { state: GithubExposureState }): readonly string[] {
  if (state.kind === "counted") {
    return state.limits.map((limit) => `      limit: ${limit}`);
  }
  if (state.kind === "partial" || state.kind === "read-failed") {
    return state.why.map((why) => `      gap: ${why}`);
  }
  return [];
}

/**
 * The inventory as the lines a reader scans: one header, one line per surface, its gaps and limits under it.
 *
 * @returns the lines, in print order
 */
export function githubExposureLines({ inventory }: { inventory: GithubExposureInventory }): readonly string[] {
  const unsettled = inventory.surfaces.filter(({ state }) => state.kind === "partial" || state.kind === "read-failed");
  const head = githubExposureComplete({ inventory })
    ? `${inventory.repository}: every surface counted (${String(inventory.surfaces.length)} surfaces, ${String(inventory.calls)} reads at ${inventory.readAtIso})`
    : `${inventory.repository}: INCOMPLETE — ${String(unsettled.length)} of ${String(inventory.surfaces.length)} surfaces not fully counted (${String(inventory.calls)} reads at ${inventory.readAtIso})`;
  return [
    head,
    ...inventory.surfaces.flatMap(({ surface, state }) => [
      `  ${surface.padEnd(30)} ${state.kind.padEnd(19)} ${countCell({ state }).padStart(7)}  ${state.detail}`,
      ...noteLines({ state }),
    ]),
  ];
}
