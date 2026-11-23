/*
 * The cmux hang judge's `cmuxFleetState`: what the sessions page shows — unmeasured, answering, restarting, or
 * unresponsive, held or not, carrying a recurrence after a restart came back.
 */
import { describe, expect, it } from "vitest";

import { cmuxFleetState } from "../../../../cmux/hang.js";
import type { CmuxReviveEvent } from "../../../../cmux/reviveJournal.js";
import { instant, reading, started } from "./harness.js";

describe("cmuxFleetState", () => {
  const hung = [
    reading({ at: "18:58", state: "refused" }),
    reading({ at: "19:02", state: "refused" }),
    reading({ at: "19:06", state: "refused" }),
    reading({ at: "19:09", state: "refused" }),
  ];

  it("is unmeasured with nothing journalled", () => {
    expect(cmuxFleetState({ events: [], nowIso: instant({ clock: "19:00" }) })).toEqual({ kind: "unmeasured" });
  });

  it("is answering when the newest reading answered", () => {
    expect(
      cmuxFleetState({ events: [reading({ at: "19:00", state: "answering" })], nowIso: instant({ clock: "19:01" }) }),
    ).toEqual({ kind: "answering" });
  });

  it("is restarting while a restart is in flight", () => {
    expect(
      cmuxFleetState({ events: [...hung, started({ at: "19:10" })], nowIso: instant({ clock: "19:12" }) }),
    ).toEqual({
      kind: "restarting",
      sinceIso: instant({ clock: "19:10" }),
    });
  });

  it("trusts a finished restart that came up answering over the old app's readings", () => {
    const finished: CmuxReviveEvent = {
      atIso: instant({ clock: "19:11" }),
      detail: "",
      kind: "restart-finished",
      newAppPid: 24622,
      outcome: "answering",
      schemaVersion: 1,
    };
    expect(
      cmuxFleetState({ events: [...hung, started({ at: "19:10" }), finished], nowIso: instant({ clock: "19:12" }) }),
    ).toEqual({
      kind: "answering",
    });
  });

  it("calls a finished restart that did not answer unresponsive from its finish, not held", () => {
    const finished: CmuxReviveEvent = {
      atIso: instant({ clock: "19:15" }),
      detail: "",
      kind: "restart-finished",
      newAppPid: 24622,
      outcome: "not-answering",
      schemaVersion: 1,
    };
    expect(
      cmuxFleetState({ events: [...hung, started({ at: "19:10" }), finished], nowIso: instant({ clock: "19:16" }) }),
    ).toEqual({
      held: false,
      kind: "unresponsive",
      sinceIso: instant({ clock: "19:15" }),
    });
  });

  it("is unresponsive and not held while the bound runs", () => {
    expect(cmuxFleetState({ events: hung.slice(0, 2), nowIso: instant({ clock: "19:03" }) })).toEqual({
      held: false,
      kind: "unresponsive",
      sinceIso: instant({ clock: "18:58" }),
    });
  });

  it("carries the recurrence of a hang that began within the hour after a restart came back", () => {
    const finished: CmuxReviveEvent = {
      atIso: instant({ clock: "18:46" }),
      detail: "",
      kind: "restart-finished",
      newAppPid: 5088,
      outcome: "answering",
      schemaVersion: 1,
    };
    const events = [started({ at: "18:45" }), finished, ...hung.slice(0, 2)];
    expect(cmuxFleetState({ events, nowIso: instant({ clock: "19:03" }) })).toEqual({
      held: false,
      kind: "unresponsive",
      recurring: { afterRestartIso: instant({ clock: "18:46" }), intervalMs: 12 * 60_000 },
      sinceIso: instant({ clock: "18:58" }),
    });
  });

  it("is held when the hang passed the bound inside a restart's cooldown", () => {
    const events = [started({ at: "18:45" }), ...hung];
    expect(cmuxFleetState({ events, nowIso: instant({ clock: "19:10" }) })).toEqual({
      held: true,
      kind: "unresponsive",
      sinceIso: instant({ clock: "18:58" }),
    });
  });
});
