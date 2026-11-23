/*
 * When the shell reloads a voice page that loaded and never reported. The installed app sat about 22 hours with no orb
 * after its first /voice load rendered the organisation refusal: that page never reports, and the shell reloads only on
 * a new origin, so nothing ever retried it.
 */
import { describe, expect, it } from "vitest";

import {
  initialOverlayReportWatch,
  OVERLAY_REPORT_GRACE_MS,
  OVERLAY_REPORT_RETRY_CAP_MS,
  type OverlayReportWatchEvent,
  type OverlayReportWatchState,
  type OverlayReportWatchTransition,
  reduceOverlayReportWatch,
} from "../../src/overlayReportWatch";

/** Apply events in order from `state`, keeping every transition. */
function run({
  events,
  state = initialOverlayReportWatch(),
}: {
  events: readonly OverlayReportWatchEvent["kind"][];
  state?: OverlayReportWatchState;
}): readonly OverlayReportWatchTransition[] {
  const transitions: OverlayReportWatchTransition[] = [];
  let now = state;
  for (const kind of events) {
    const transition = reduceOverlayReportWatch({ event: { kind }, state: now });
    transitions.push(transition);
    now = transition.state;
  }
  return transitions;
}

describe("reduceOverlayReportWatch", () => {
  it("arms the first grace when a page finishes loading", () => {
    expect(run({ events: ["loaded"] })).toEqual([
      { effect: { afterMs: 20_000, kind: "schedule" }, state: { delayMs: 20_000, kind: "armed" } },
    ]);
    expect(OVERLAY_REPORT_GRACE_MS).toBe(20_000);
  });

  // The page the watch reloaded navigates while idle: its doubled delay must survive that navigation.
  it("reloads on a miss, and the reload's own navigation keeps the doubled delay for the next load", () => {
    expect(run({ events: ["loaded", "missed", "navigated", "loaded"] })).toEqual([
      { effect: { afterMs: 20_000, kind: "schedule" }, state: { delayMs: 20_000, kind: "armed" } },
      { effect: { kind: "reload" }, state: { kind: "reloading", nextDelayMs: 40_000 } },
      { effect: { kind: "none" }, state: { kind: "idle", nextDelayMs: 40_000 } },
      { effect: { afterMs: 40_000, kind: "schedule" }, state: { delayMs: 40_000, kind: "armed" } },
    ]);
  });

  it("doubles every miss up to five minutes and keeps retrying there, with no attempt ceiling", () => {
    const transitions = run({
      events: Array.from({ length: 7 }, () => ["loaded", "missed", "navigated"] as const).flat(),
    });
    const scheduled = transitions.flatMap((transition) =>
      transition.effect.kind === "schedule" ? [transition.effect.afterMs] : [],
    );
    expect(scheduled).toEqual([20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
    expect(transitions.filter((transition) => transition.effect.kind === "reload").length).toBe(7);
    expect(OVERLAY_REPORT_RETRY_CAP_MS).toBe(300_000);
  });

  // A status accepted, a new origin, a failed load, a crash or the window closing all end the episode.
  it("cancels an armed deadline on reset and starts the next episode from the first grace", () => {
    const backedOff: OverlayReportWatchState = { delayMs: 160_000, kind: "armed" };
    expect(run({ events: ["reset", "loaded"], state: backedOff })).toEqual([
      { effect: { kind: "cancel" }, state: { kind: "idle", nextDelayMs: 20_000 } },
      { effect: { afterMs: 20_000, kind: "schedule" }, state: { delayMs: 20_000, kind: "armed" } },
    ]);
  });

  it("forgets the backoff on reset while idle too, so a page that reported once starts again at the first grace", () => {
    expect(run({ events: ["reset"], state: { kind: "idle", nextDelayMs: 300_000 } })).toEqual([
      { effect: { kind: "cancel" }, state: { kind: "idle", nextDelayMs: 20_000 } },
    ]);
  });

  // A navigation the watch did not cause, before its deadline: a new document, never the old one's elapsed time.
  it("cancels and starts again from the first grace on a navigation while armed", () => {
    expect(run({ events: ["navigated"], state: { delayMs: 80_000, kind: "armed" } })).toEqual([
      { effect: { kind: "cancel" }, state: { kind: "idle", nextDelayMs: 20_000 } },
    ]);
  });

  it("never reloads on a stale deadline that fires with nothing armed, or a second time while a reload is in flight", () => {
    expect(run({ events: ["missed"], state: { kind: "idle", nextDelayMs: 40_000 } })).toEqual([
      { effect: { kind: "none" }, state: { kind: "idle", nextDelayMs: 40_000 } },
    ]);
    expect(run({ events: ["missed"], state: { kind: "reloading", nextDelayMs: 40_000 } })).toEqual([
      { effect: { kind: "none" }, state: { kind: "reloading", nextDelayMs: 40_000 } },
    ]);
  });

  // Guards a status that arrives just before the deadline and is accepted after reload() started: the reload must not
  // replace the page that had reported.
  it("stops the reload still in flight when the episode ends before it commits, so the reported page stays", () => {
    expect(run({ events: ["loaded", "missed", "reset", "navigated"] })).toEqual([
      { effect: { afterMs: 20_000, kind: "schedule" }, state: { delayMs: 20_000, kind: "armed" } },
      { effect: { kind: "reload" }, state: { kind: "reloading", nextDelayMs: 40_000 } },
      { effect: { kind: "stop" }, state: { kind: "idle", nextDelayMs: 20_000 } },
      { effect: { kind: "none" }, state: { kind: "idle", nextDelayMs: 20_000 } },
    ]);
  });

  it("re-arms the same deadline on a repeated finish, never a second or a longer one", () => {
    expect(run({ events: ["loaded", "loaded"] })).toEqual([
      { effect: { afterMs: 20_000, kind: "schedule" }, state: { delayMs: 20_000, kind: "armed" } },
      { effect: { afterMs: 20_000, kind: "schedule" }, state: { delayMs: 20_000, kind: "armed" } },
    ]);
  });
});
