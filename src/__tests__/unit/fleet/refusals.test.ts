/**
 * The one table that turns a recovery refusal into the owner's words and at most one button — keyed by code, never by text.
 */
import { describe, expect, it } from "vitest";

import { headlineReason } from "../../../fleet/headlineReason.js";
import { FLEET_REFUSAL_CODES, type FleetAccountNames, mapFleetRefusal } from "../../../fleet/refusals.js";
import { ReseatErrors } from "../../../sessions/reseatErrors.js";

const ACCOUNTS: FleetAccountNames = { emailFor: ({ alias }) => (alias === "plan-one" ? "one@example.com" : undefined) };

describe("mapFleetRefusal", () => {
  it("maps the Fable gate the owner had to find an escape hatch for to a button carrying that hatch", () => {
    const error = ReseatErrors.modelRefused({ model: "fable" });
    const reason = mapFleetRefusal({ accounts: ACCOUNTS, refusal: { code: error.code, message: error.message } });
    expect(reason.headline).toBe("This seat runs on Fable, and resuming it needs your override.");
    expect(reason.raw).toBe("--model fable on a worker seat needs ALLOW_FABLE_OVERRIDE=1, exactly as cmux spawn does");
    expect(reason.handStep!.action).toEqual({ hatch: "ALLOW_FABLE_OVERRIDE", kind: "policy-override" });
  });

  it("names the account by email on a sign-in, never by a hard-coded one", () => {
    const reason = mapFleetRefusal({
      accounts: ACCOUNTS,
      refusal: { alias: "plan-one", code: "SEAT_STILL_WALLED", message: "still walled" },
    });
    expect(reason.handStep!.label).toBe("Sign in as one@example.com");
    expect(reason.handStep!.id).toBe("claude-signin:plan-one");
  });

  it("says no email is mapped rather than inventing one", () => {
    const reason = mapFleetRefusal({
      accounts: ACCOUNTS,
      refusal: { alias: "plan-two", code: "SEAT_STILL_WALLED", message: "still walled" },
    });
    expect(reason.handStep!.label).toBe("Sign in to plan-two");
    expect(reason.headline).toBe("Sign in to the account for plan-two (no email is mapped to it yet).");
  });

  it("offers the spent-plan override only for a spent plan", () => {
    const spent = mapFleetRefusal({
      accounts: ACCOUNTS,
      refusal: { code: "STORE_REFUSED", message: "spent", storeRefusal: "spent-plan" },
    });
    const unreadable = mapFleetRefusal({
      accounts: ACCOUNTS,
      refusal: { code: "STORE_REFUSED", message: "no gauge", storeRefusal: "unreadable-plan" },
    });
    expect(spent.handStep!.action).toEqual({ hatch: "SLOPWEAVER_ALLOW_SPENT_PLAN", kind: "policy-override" });
    expect(unreadable.handStep).toBeUndefined();
  });

  it("says a crash loop is the supervisor's to investigate, with no button for the owner", () => {
    const reason = mapFleetRefusal({
      accounts: ACCOUNTS,
      refusal: { code: "CRASH_LOOP", message: "relaunched 3 times", workspaceRef: "workspace:7" },
    });
    expect(reason.headline).toBe(
      "A seat keeps falling over after being brought back — the supervisor is investigating it instead.",
    );
    expect(reason.raw).toBe("relaunched 3 times");
    expect(reason.handStep).toBeUndefined();
  });

  it("says a seat still at its usage limit waits on its plan, with no sign-in button even with a plan named", () => {
    const reason = mapFleetRefusal({
      accounts: ACCOUNTS,
      refusal: { alias: "plan-one", code: "SEAT_STILL_LIMITED", message: "limited", workspaceRef: "workspace:7" },
    });
    expect(reason.headline).toBe("A seat came back on a plan at its usage limit.");
    expect(reason.handStep).toBeUndefined();
  });

  it("says a Codex chair was left alone because recovery resumes only Claude sessions, with no button for the owner", () => {
    const reason = mapFleetRefusal({
      accounts: ACCOUNTS,
      refusal: { code: "CHAIR_ON_CODEX", message: "the supervisor pin names Codex thread t1" },
    });
    expect(reason.headline).toBe("The supervisor runs on Codex, which recovery does not resume.");
    expect(reason.raw).toBe("the supervisor pin names Codex thread t1");
    expect(reason.handStep).toBeUndefined();
  });

  it("names an app-hosted chair as the app's, never as a Codex thread", () => {
    const reason = mapFleetRefusal({
      accounts: ACCOUNTS,
      refusal: { code: "CHAIR_IN_APP", message: "the supervisor pin names app session a1" },
    });
    expect(reason.headline).toBe("The supervisor runs in the desktop app, which recovery does not resume.");
    expect(reason.raw).toBe("the supervisor pin names app session a1");
    expect(reason.handStep).toBeUndefined();
  });

  // A workspace with a second tab open is a shape the owner clears by closing it, never "could not read cmux".
  it("names a split workspace as tabs to close, never as a failed cmux read, with no button for the owner", () => {
    const error = ReseatErrors.splitSurfaces({ surfaces: 2, workspaceRef: "workspace:7" });
    const reason = mapFleetRefusal({
      accounts: ACCOUNTS,
      refusal: { code: error.code, message: error.message, workspaceRef: "workspace:7" },
    });
    expect([reason.headline, reason.detail, reason.raw, reason.handStep]).toEqual([
      "A seat's workspace has more than one tab open.",
      "This seat's workspace has more than one tab open (workspace:7), and a typed line would reach only one of them, so nothing was typed. Close the extra tabs until one is left, then run recovery again from a different workspace.",
      error.message,
      undefined,
    ]);
  });

  it("gives every known code a headline and a detail that are not the producer's text, with or without a plan", () => {
    expect(FLEET_REFUSAL_CODES.length).toBeGreaterThan(0);
    const leaked = FLEET_REFUSAL_CODES.flatMap((code) =>
      [undefined, "plan-one"].map((alias) => {
        const named = alias === undefined ? {} : { alias };
        const reason = mapFleetRefusal({ accounts: ACCOUNTS, refusal: { code, message: "PRODUCER TEXT", ...named } });
        return { code, alias, leaked: reason.headline === "PRODUCER TEXT" || reason.detail === "PRODUCER TEXT" };
      }),
    ).filter((row) => row.leaked);
    expect(leaked).toEqual([]);
  });

  it("explains a signed-out plan with no token in the owner's words, keeping the producer's text under the fold", () => {
    const reason = mapFleetRefusal({
      accounts: ACCOUNTS,
      refusal: { alias: "plan-one", code: "STORE_REFUSED", message: "PRODUCER TEXT", storeRefusal: "configuration" },
    });
    expect(reason.headline).toBe("Sign in to one@example.com (plan-one).");
    expect(reason.detail).toBe(
      "That account is signed out and has no setup token, so a seat brought back on it would lock out again. Nothing was stopped; signing in once lets recovery carry on.",
    );
    expect(reason.raw).toBe("PRODUCER TEXT");
    expect(reason.handStep!.label).toBe("Sign in as one@example.com");
  });
});

describe("headlineReason", () => {
  it("lets a sign-in outrank a policy override, whatever order they were recorded in", () => {
    const override = mapFleetRefusal({ accounts: ACCOUNTS, refusal: { code: "MODEL_REFUSED", message: "m" } });
    const signin = mapFleetRefusal({
      accounts: ACCOUNTS,
      refusal: { alias: "plan-one", code: "SEAT_STILL_WALLED", message: "s" },
    });
    expect(headlineReason({ reasons: [override, signin] })!.code).toBe("SEAT_STILL_WALLED");
  });

  it("is undefined when nothing was refused", () => {
    expect(headlineReason({ reasons: [] })).toBeUndefined();
  });
});
