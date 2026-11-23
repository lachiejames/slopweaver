/**
 * Whose move a failing fleet-health row is, and the words its line says it in, so the note puts
 * a button in front of the owner.
 */
import { describe, expect, it } from "vitest";

import { fateClause, placePhrase, rowFatesOf } from "../../../monitor/fleetHealthFate.js";

describe("rowFatesOf", () => {
  it("picks the most specific fate: the owner's card, a fleet press, a Done sign-in, a repair, a hold, else the next slot", () => {
    const fates = rowFatesOf({
      failing: ["mine", "pressed", "signed", "repair", "hold", "slot"],
      fleetPresses: new Map([["pressed", { host: "app.datadoghq.com", provider: "datadog" as const }]]),
      held: new Set(["hold", "signed", "pressed"]),
      repairing: new Map([
        ["repair", "recipe-repair-clerk-294-1"],
        ["mine", "recipe-repair-mine"],
      ]),
      signedIn: new Map([["signed", "go.xero.com"]]),
      yours: new Map([
        [
          "mine",
          {
            act: "sign in to app.hex.tech",
            card: "mon-signin-app-hex-tech",
            more: 0,
            place: { kind: "work-chrome" as const },
          },
        ],
      ]),
    });
    expect([...fates.values()].map((fate) => fate.kind)).toEqual([
      "needs-you",
      "fleet-presses",
      "signed-in",
      "repairing",
      "held",
      "retrying",
    ]);
    expect(fates.get("signed")).toEqual({ held: true, host: "go.xero.com", kind: "signed-in" });
    expect(fates.get("pressed")).toEqual({
      held: true,
      host: "app.datadoghq.com",
      kind: "fleet-presses",
      provider: "datadog",
    });
  });
});

describe("fateClause", () => {
  it("gives the owner's move the act, the place and the button's marker, and the fleet's move its why", () => {
    expect([
      fateClause({
        fate: {
          kind: "needs-you",
          step: {
            act: "sign in as ada-owner-codex-3@slopweaver.ai",
            card: "codex-plan-three",
            more: 2,
            place: { email: "ada-owner-codex-3@slopweaver.ai", kind: "account" },
          },
        },
        why: "exit 1",
      }),
      fateClause({ fate: { kind: "repairing", seat: "recipe-repair-clerk-294-1" }, why: "exit 1" }),
      fateClause({
        fate: { held: false, host: "app.datadoghq.com", kind: "fleet-presses", provider: "datadog" },
        why: "exit 4",
      }),
      fateClause({
        fate: { held: true, host: "github.com", kind: "fleet-presses", provider: "github" },
        why: "exit 4",
      }),
    ]).toEqual([
      "Needs you — sign in as ada-owner-codex-3@slopweaver.ai, outside your work Chrome, as ada-owner-codex-3@slopweaver.ai (+2 more open) [hand:codex-plan-three]",
      "Nothing for you — seat recipe-repair-clerk-294-1 is repairing it; exit 1",
      "Nothing for you — the fleet presses its app.datadoghq.com sign-in itself: its next " +
        "seat runs `slopweaver browser sign-in --provider datadog`",
      "Nothing for you — the fleet presses its github.com sign-in itself; it stays " +
        "paused on its failure finding until that is settled",
    ]);
  });
});

describe("placePhrase", () => {
  it("says plainly when the owner's step is outside the work Chrome profile", () => {
    expect(
      [
        { email: "ada-owner-codex-3@slopweaver.ai", kind: "account" as const },
        { kind: "work-chrome" as const },
        { kind: "terminal" as const },
        { kind: "card" as const },
      ].map((place) => placePhrase({ place })),
    ).toEqual([
      "outside your work Chrome, as ada-owner-codex-3@slopweaver.ai",
      "in your work Chrome",
      "in a terminal on this Mac, outside Chrome",
      "where its card says",
    ]);
  });
});
