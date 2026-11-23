/*
 * The revive journal's `parseCmuxReviveJournal`, which the cmux hang judge reads: every event decoded, a cut or
 * foreign line counted rather than dropped, and an empty file read as no events.
 */
import { describe, expect, it } from "vitest";

import { parseCmuxReviveJournal } from "../../../../cmux/reviveJournal.js";
import { instant, reading, started } from "./harness.js";

describe("parseCmuxReviveJournal", () => {
  it("decodes every event and counts a cut or foreign line rather than dropping it silently", () => {
    const text = [
      '{"cut":',
      JSON.stringify(reading({ at: "19:00", state: "refused" })),
      JSON.stringify({ atIso: "x", kind: "reading", schemaVersion: 2 }),
      JSON.stringify(started({ at: "19:10" })),
      "",
    ].join("\n");
    const read = parseCmuxReviveJournal({ text });
    expect(read.events.map((event) => event.kind)).toEqual(["reading", "restart-started"]);
    expect(read.unreadable).toBe(2);
  });

  it("decodes a recurring hang and a declined dialog", () => {
    const text = [
      JSON.stringify({
        afterRestartIso: instant({ clock: "06:38" }),
        atIso: instant({ clock: "06:57" }),
        hungSinceIso: instant({ clock: "06:56" }),
        kind: "recurring",
        schemaVersion: 1,
      }),
      JSON.stringify({
        atIso: instant({ clock: "07:28" }),
        button: "Cancel",
        kind: "dialog-dismissed",
        schemaVersion: 1,
        title: "Run Project Action?",
      }),
    ].join("\n");
    expect(parseCmuxReviveJournal({ text })).toEqual({
      events: [
        {
          afterRestartIso: instant({ clock: "06:38" }),
          atIso: instant({ clock: "06:57" }),
          hungSinceIso: instant({ clock: "06:56" }),
          kind: "recurring",
          schemaVersion: 1,
        },
        {
          atIso: instant({ clock: "07:28" }),
          button: "Cancel",
          kind: "dialog-dismissed",
          schemaVersion: 1,
          title: "Run Project Action?",
        },
      ],
      unreadable: 0,
    });
  });

  it("reads an empty file as no events", () => {
    expect(parseCmuxReviveJournal({ text: "" })).toEqual({ events: [], unreadable: 0 });
  });
});
