/**
 * Whether a failing fleet-health row waits on the owner's hand — joined off the open hand register, never authored — and
 * where that step happens, read off the card's typed fields, so the note puts a button in front of the owner.
 */
import { describe, expect, it } from "vitest";

import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";
import { type FailingRowKeys, fleetNoteUp, placeOf, yourSteps } from "../../../monitor/fleetHealthHand.js";

/**
 * An open card, built through the register's own validation.
 *
 * @param over the fields this case sets
 * @returns the step
 */
function card(over: Partial<HandStepDraft> & { id: string }): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        postedBy: "workspace:1",
        postedIso: "2026-09-30T10:00:00.000Z",
        unblocks: "the resync",
        what: "Sign in to the platform",
        witness: "slopweaver monitor check --fire",
        ...over,
      },
    }),
  );
}

/**
 * One failing row's join keys, none set unless the case sets them.
 *
 * @param over the keys this case sets
 * @returns the keys
 */
function keys(over: Partial<FailingRowKeys> & { recipeId: string }): FailingRowKeys {
  return { holdFinding: undefined, repairRow: undefined, signInHost: undefined, ...over };
}

const PLANS = [
  { alias: "codex-three", email: "ada-owner-codex-3@slopweaver.ai" },
  { alias: "claude-one", email: undefined },
];

describe("fleetNoteUp", () => {
  it("reads the note up only when a fleet-health card is open AND its note is on screen, never put away with Later", () => {
    const showing: (stepId: string) => boolean = (stepId) => stepId !== "mon-health-deaths.2";
    expect([
      fleetNoteUp({ openSteps: [card({ id: "mon-health-syncs.3" })], showing }),
      fleetNoteUp({ openSteps: [card({ id: "mon-health-deaths.2" })], showing }),
      fleetNoteUp({ openSteps: [card({ id: "mon-signin-go-xero-com" }), card({ id: "health-check" })], showing }),
    ]).toEqual([true, false, false]);
  });
});

describe("yourSteps", () => {
  it("joins a sign-in to the NEWEST open occurrence of its host's card, counting the rest", () => {
    const steps = yourSteps({
      openSteps: [
        card({ id: "mon-signin-go-xero-com.2", opened: "https://go.xero.com", postedIso: "2026-09-30T11:00:00.000Z" }),
        card({ id: "mon-signin-go-xero-com", opened: "https://go.xero.com" }),
        card({ id: "mon-signin-app-hex-tech", opened: "https://app.hex.tech" }),
      ],
      plans: PLANS,
      rows: [keys({ recipeId: "resync-atlas-xero", signInHost: "go.xero.com" })],
    });
    expect(steps.get("resync-atlas-xero")).toEqual({
      act: "sign in to go.xero.com",
      card: "mon-signin-go-xero-com.2",
      more: 1,
      place: { kind: "work-chrome" },
    });
  });

  it("leaves a sign-in with no open card the fleet's, falling to a card on its repair row when one is open", () => {
    const steps = yourSteps({
      openSteps: [card({ id: "repair-trelica-card", row: "repair-trelica", what: "Approve the Trelica scope" })],
      plans: PLANS,
      rows: [
        keys({ recipeId: "resync-atlas-xero", signInHost: "go.xero.com" }),
        keys({ recipeId: "resync-atlas-trelica", repairRow: "repair-trelica", signInHost: "acme.trelica.app" }),
      ],
    });
    expect([...steps.entries()]).toEqual([
      [
        "resync-atlas-trelica",
        { act: "Approve the Trelica scope", card: "repair-trelica-card", more: 0, place: { kind: "card" } },
      ],
    ]);
  });

  it("joins a card on the repairing seat's row ahead of one on the hold's finding", () => {
    const steps = yourSteps({
      openSteps: [
        card({
          id: "finding-card",
          row: "recipe-failing-vanta",
          url: "http://localhost:3000/queue?open=hand%3Afinding-card",
        }),
        card({
          id: "adc-signin-repair-vanta",
          literal: "gcloud auth application-default login",
          row: "repair-vanta",
          what: "Sign in to Google Cloud from a plain terminal of yours",
          where: "a plain terminal, not a Claude session",
        }),
      ],
      plans: PLANS,
      rows: [keys({ holdFinding: "recipe-failing-vanta", recipeId: "resync-atlas-vanta", repairRow: "repair-vanta" })],
    });
    expect(steps.get("resync-atlas-vanta")).toEqual({
      act: "Sign in to Google Cloud from a plain terminal of yours",
      card: "adc-signin-repair-vanta",
      more: 0,
      place: { kind: "terminal" },
    });
  });

  it("falls to the hold's finding when the repair row carries no card, and leaves a row with no card the fleet's", () => {
    const steps = yourSteps({
      openSteps: [
        card({
          id: "finding-card",
          row: "recipe-failing-vanta",
          url: "http://localhost:3000/queue?open=hand%3Afinding-card",
        }),
      ],
      plans: PLANS,
      rows: [
        keys({ holdFinding: "recipe-failing-vanta", recipeId: "resync-atlas-vanta", repairRow: "repair-vanta" }),
        keys({ recipeId: "resync-corpus-slack", repairRow: "repair-slack" }),
      ],
    });
    expect([...steps.keys()]).toEqual(["resync-atlas-vanta"]);
    expect(steps.get("resync-atlas-vanta")!.card).toBe("finding-card");
    expect(steps.get("resync-atlas-vanta")!.place).toEqual({ kind: "card" });
  });
});

describe("placeOf", () => {
  it("reads a registered plan's address on the card as outside the work Chrome, ahead of every other field", () => {
    const step = card({
      id: "codex-plan-three",
      literal: "codex login",
      what: "Sign in as ada-owner-codex-3@slopweaver.ai on Codex",
      where: "your terminal",
    });
    expect(placeOf({ plans: PLANS, step })).toEqual({ email: "ada-owner-codex-3@slopweaver.ai", kind: "account" });
  });

  it("reads the fleet-opened window and a sign-in card as the work Chrome, a command as a terminal, else the card", () => {
    expect(
      [
        card({ id: "opened-one", opened: "https://app.hex.tech", where: "the window that opened" }),
        card({ id: "mon-signin-go-xero-com", url: "http://localhost:3000/queue?open=hand%3Amon-signin-go-xero-com" }),
        card({ id: "pasted-one", literal: "gcloud auth login", where: "any terminal" }),
        card({ id: "plain-one", url: "http://localhost:3000/queue?open=hand%3Aplain-one" }),
      ].map((step) => placeOf({ plans: PLANS, step }).kind),
    ).toEqual(["work-chrome", "work-chrome", "terminal", "card"]);
  });
});
