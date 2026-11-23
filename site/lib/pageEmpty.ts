/**
 * What a page's designed empty state offers beside its words: the way to Settings → Models, the connect step it waits
 * on, or nothing. Pure, so the one rule that matters — never claim no plan is connected off a read that could not
 * tell — is decided and tested here rather than in each page.
 *
 * Every empty page says what will appear there, what makes it appear, and offers a button to the step it waits on; the
 * needs-Google-Calendar state with a Connect button is the shape the owner likes. The Setup page lives in the Settings
 * modal, so the step a page with nothing to show offers is connecting a plan there. The component drawing it is
 * `../components/console/PageEmpty.tsx`.
 */

import type { Integration } from "./integrations";
import type { LiveState } from "./liveState";

/**
 * Whether a reading proves a page empty NOW, the one gate every designed empty state stands on: its latest read
 * answered. A value kept over a failed read (`stale`) or handed over from the page before while its replacement read
 * is on its way (`refreshing`) proves nothing about the present, so neither may draw the empty state.
 *
 * @param state the reading the page's emptiness is judged from
 * @returns true only for a ready reading whose latest read answered
 */
export function provenNowOf({ state }: { state: LiveState<unknown> }): boolean {
  return state.phase === "ready" && state.stale === undefined && state.refreshing !== true;
}

/**
 * Whether a list built from one source reading, then filtered by overlay readings, is proven empty NOW. An empty source
 * proves it alone, since no overlay can add a row; a source holding rows that every overlay took away proves it only
 * when every overlay is current too, since a fresh overlay could put one back (an act hidden by a spoken-card
 * reading kept over a failed read).
 *
 * @param source the reading the rows are built from
 * @param overlays every reading that can hide, settle or move a row the source built
 * @returns true only when each reading the empty list depends on is proven now
 */
export function emptyProvenOf({
  source,
  overlays,
}: {
  source: LiveState<readonly unknown[]>;
  overlays: readonly LiveState<unknown>[];
}): boolean {
  if (!provenNowOf({ state: source })) {
    return false;
  }
  if (source.phase === "ready" && source.value.length === 0) {
    return true;
  }
  return overlays.every((state) => provenNowOf({ state }));
}

/**
 * Where the readings a list is filtered by stand, as two separate facts: what the section is doing about them, and
 * whether every one has delivered a value.
 *
 * `activity` is `first-read` while any is still being read for the first time: nothing of it is in hand, so the
 * section is loading and marks itself busy. It is `re-reading` while none is but one is a reading handed over from the
 * page before, its replacement read on its way: that reading IS in hand, so the section draws what it holds with a
 * refresh mark, exactly as a tile draws a handed-over reading, and never a busy block standing in for data it already
 * has. It is `settled` otherwise — a failed read kept over, whose own staleness mark says so, and a read that
 * delivered nothing at all, which is not loading either.
 *
 * `inHand` is true only when every one is `ready`, handed over or kept over a failed read included; a read that
 * delivered nothing is not in hand however it ended.
 *
 * MEASURED: drawing a busy block for `re-reading` failed the desktop walk's Alignment step at the 30 s cap on three
 * walks out of three (31.3 s to 31.7 s, the mark `Reading what places and hides each act`), because a fresh window
 * hands every overlay over from the console's saved readings and re-reads all four behind the page's other first reads.
 * Repro: `slopweaver desktop e2e --only alignment` against a console with saved readings, under the machine's usual load.
 *
 * @param overlays every reading that can hide, settle or move a row the list is built from
 * @returns what the section is doing about them, and whether all of them are in hand
 */
export function overlaysReadOf({ overlays }: { overlays: readonly LiveState<unknown>[] }): {
  readonly activity: "first-read" | "re-reading" | "settled";
  readonly inHand: boolean;
} {
  const inHand = overlays.every((state) => state.phase === "ready");
  if (overlays.some((state) => state.phase === "loading")) {
    return { activity: "first-read", inHand };
  }
  if (overlays.some((state) => state.phase === "ready" && state.refreshing === true)) {
    return { activity: "re-reading", inHand };
  }
  return { activity: "settled", inHand };
}

/**
 * How an empty list is drawn. Proven empty now, it is the designed empty state; empty only in readings kept over a
 * failed or refreshing read, it is a plain line saying so, never blank; still being read for the first time,
 * it is nothing, since the section's own read marks already say so.
 *
 * @param empty whether the list as drawn holds nothing
 * @param inHand whether every reading the list is built from has delivered a value, current or kept
 * @param proven whether every reading deciding the emptiness is proven now
 * @returns which of the three the section draws
 */
export function emptyDrawOf({
  empty,
  inHand,
  proven,
}: {
  empty: boolean;
  inHand: boolean;
  proven: boolean;
}): "designed" | "plain" | "none" {
  if (!empty || !inHand) {
    return "none";
  }
  if (proven) {
    return "designed";
  }
  return "plain";
}

/**
 * Whether no plan is connected, judged from a reading of `plans list --json` that is proven now. A reading still
 * loading, refreshing, or kept over a failed read cannot tell, so it answers `undefined` and nothing claims the
 * install is missing a plan off a read that could not see one.
 *
 * @param plans the `plans list --json` reading as `readPlanLimits` projects it
 * @returns `true` with no plan connected, `false` with at least one, `undefined` when the reading cannot answer
 */
export function noPlanConnectedOf({
  plans,
}: {
  plans: LiveState<{ readonly plans: readonly unknown[] }>;
}): boolean | undefined {
  if (!provenNowOf({ state: plans }) || plans.phase !== "ready") {
    return undefined;
  }
  return plans.value.plans.length === 0;
}

/** The action a page asks its empty state to offer. */
export type PageEmptyRequestedAction =
  | { readonly kind: "connect"; readonly integration: Integration; readonly subjects: readonly string[] }
  | { readonly kind: "none" }
  | { readonly kind: "plans" };

/**
 * The action the empty state actually draws. A named integration the page waits on is more specific than a plan, so a
 * connect stays a connect; the way to Settings → Models is offered only while no plan is KNOWN connected, and a plans
 * reading that cannot answer (`undefined`) withholds it, exactly as a connected plan does.
 *
 * @param requested what the page asked for
 * @param noPlanConnected `noPlanConnectedOf`'s answer: true with no plan, undefined when it cannot tell
 * @returns the action to draw
 */
export function pageEmptyActionOf({
  requested,
  noPlanConnected,
}: {
  requested: PageEmptyRequestedAction;
  noPlanConnected: boolean | undefined;
}): PageEmptyRequestedAction {
  if (requested.kind !== "plans") {
    return requested;
  }
  if (noPlanConnected === true) {
    return requested;
  }
  return { kind: "none" };
}
