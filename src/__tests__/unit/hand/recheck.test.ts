import { describe, expect, it } from "vitest";

import {
  parseRecheckFlag,
  type RecheckObservation,
  recheckDid,
  recheckPlan,
  recheckReport,
  stepRecheck,
} from "../../../hand/recheck.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const CLERK = "https://dashboard.clerk.com";

/** A posted step, with whatever the case overrides. */
function step({ over = {} }: { over?: Partial<HandStepDraft> } = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "clerk-signin-6oct",
        postedBy: "workspace:12",
        postedIso: "2026-10-06T13:00:00.000Z",
        unblocks: "the Clerk atlas resync",
        what: "Sign in to Clerk in the work Chrome profile",
        witness: "slopweaver hand done clerk-signin-6oct",
        ...over,
      },
    }),
  );
}

describe("parseRecheckFlag — hand post --recheck <kind>:<value>", () => {
  it("reads a browser session at an origin an atlas reads", () => {
    expect(unwrap(parseRecheckFlag({ value: `browser-session:${CLERK}` }))).toEqual({
      kind: "browser-session",
      origin: CLERK,
    });
  });

  it("reads a channel the owner has to join", () => {
    expect(unwrap(parseRecheckFlag({ value: "slack-member:C0123456789" }))).toEqual({
      channel: "C0123456789",
      kind: "slack-member",
    });
  });

  it.each([
    ["browser-session:https://dashboard.clerk.com/apps", "which is not a bare https origin"],
    ["browser-session:http://dashboard.clerk.com", "which is not a bare https origin"],
    ["browser-session:https://example.com", "whose sign-in no atlas reads"],
    ["slack-member:general", "which is not a channel id"],
    ["docker:running", 'names the kind "docker"'],
    ["browser-session", "names no value after a kind"],
  ])("refuses %s, naming why", (value, why) => {
    expect(unwrapErr(parseRecheckFlag({ value })).message).toContain(why);
  });
});

describe("buildHandStep — the recheck field round-trips and is refused malformed", () => {
  it("keeps a well-formed recheck on the step", () => {
    expect(step({ over: { recheck: { channel: "C0123456789", kind: "slack-member" } } }).recheck).toEqual({
      channel: "C0123456789",
      kind: "slack-member",
    });
  });

  it("leaves the field off a step that names none", () => {
    expect(Object.hasOwn(step(), "recheck")).toBe(false);
  });

  it("refuses a recheck carrying a path, so a read row is never a page address", () => {
    const built = buildHandStep({
      draft: {
        id: "clerk-signin",
        postedBy: "workspace:12",
        postedIso: "2026-10-06T13:00:00.000Z",
        recheck: { kind: "browser-session", origin: `${CLERK}/apps` },
        unblocks: "the Clerk atlas resync",
        what: "Sign in to Clerk",
        witness: "slopweaver hand done clerk-signin",
      },
    });
    expect(unwrapErr(built).message).toContain("recheck");
  });
});

describe("stepRecheck — derived only for the owner's sign-in at an origin an atlas reads", () => {
  it("derives the Clerk session from a sign-in step's url, as clerk-signin-6oct was posted", () => {
    expect(
      stepRecheck({
        step: step({ over: { url: `${CLERK}/apps`, what: "Sign in to Clerk, so the atlas resync can finish" } }),
      }),
    ).toEqual({
      kind: "browser-session",
      origin: CLERK,
    });
  });

  it("derives it from a bare sign-in sentence too", () => {
    expect(stepRecheck({ step: step({ over: { url: `${CLERK}/apps` } }) })).toEqual({
      kind: "browser-session",
      origin: CLERK,
    });
  });

  it("derives from the window a sign-in monitor card opened, ahead of its url", () => {
    expect(
      stepRecheck({
        step: step({
          over: {
            id: "mon-signin-go-xero-com",
            opened: "https://go.xero.com",
            url: "http://localhost:3000/queue",
            // The resync-signed-out monitor's own sentence for an opened window.
            what: "Sign in to go.xero.com in the work Chrome window just opened, so its resync can read again",
          },
        }),
      }),
    ).toEqual({ kind: "browser-session", origin: "https://go.xero.com" });
  });

  it("reads a Trelica tenant host as Trelica's", () => {
    expect(
      stepRecheck({ step: step({ over: { opened: "https://acme.trelica.app", what: "Sign in to Trelica" } }) }),
    ).toEqual({ kind: "browser-session", origin: "https://acme.trelica.app" });
  });

  it.each<[string, Partial<HandStepDraft>]>([
    ["a sentence that is not a sign-in", { url: `${CLERK}/apps`, what: "Approve the Clerk change" }],
    ["a sign-in at an origin no atlas reads", { url: "https://console.cloud.google.com/", what: "Sign in to GCP" }],
    ["a sign-in naming no page at all", { what: "Sign in to Clerk" }],
    ["a check-in", { checkIn: true, url: `${CLERK}/apps` }],
    [
      "a sign-in joined to a second act",
      { url: `${CLERK}/apps`, what: "Sign in to Clerk and approve the SSO change, so staff can log in" },
    ],
    [
      "a sign-in joined to a second act by a comma",
      { url: `${CLERK}/apps`, what: "Sign in to Clerk, approve the SSO change, so staff can log in" },
    ],
    ["a sign-in carrying a literal of more to do", { literal: "slopweaver secrets set clerk-key", url: CLERK }],
  ])("derives nothing for %s", (_label, over) => {
    expect(stepRecheck({ step: step({ over }) })).toBe(undefined);
  });

  it("takes the step's own recheck over any derivation", () => {
    expect(
      stepRecheck({
        step: step({ over: { recheck: { channel: "C0123456789", kind: "slack-member" }, url: `${CLERK}/apps` } }),
      }),
    ).toEqual({ channel: "C0123456789", kind: "slack-member" });
  });
});

describe("recheckPlan and recheckReport — one read per precondition, spread over every step it answers", () => {
  const steps = [
    step({ over: { id: "clerk-a", url: `${CLERK}/apps` } }),
    step({ over: { id: "clerk-b", opened: CLERK } }),
    step({ over: { id: "join", recheck: { channel: "C0123456789", kind: "slack-member" }, what: "Join #ops" } }),
    step({ over: { id: "gcloud", what: "Sign in to Google Cloud" } }),
  ];

  it("groups two Clerk sign-ins under ONE visit and lists the step nothing reads", () => {
    const plan = recheckPlan({ steps });
    expect(plan.probes.map((probe) => [probe.key, probe.ids])).toEqual([
      [`browser-session:${CLERK}`, ["clerk-a", "clerk-b"]],
      ["slack-member:C0123456789", ["join"]],
    ]);
    expect(plan.unchecked).toEqual(["gcloud"]);
  });

  it("retires every step a met read answers, keeps the unmet, and calls an unread probe unread", () => {
    const plan = recheckPlan({ steps });
    const observations = new Map<string, RecheckObservation>([
      [`browser-session:${CLERK}`, { kind: "met", observed: "clerk opened it signed in" }],
    ]);
    expect(recheckReport({ observations, probes: plan.probes, unchecked: plan.unchecked })).toEqual({
      met: [
        { because: "clerk opened it signed in", id: "clerk-a" },
        { because: "clerk opened it signed in", id: "clerk-b" },
      ],
      unchecked: ["gcloud"],
      unmet: [],
      unread: [{ because: "slack-member:C0123456789 was not read this pass", id: "join" }],
    });
  });

  it("keeps an unmet step and passes an unread read's reason through", () => {
    const plan = recheckPlan({ steps: steps.slice(0, 3) });
    const observations = new Map<string, RecheckObservation>([
      [`browser-session:${CLERK}`, { kind: "unmet", observed: "settled on its own sign-in page" }],
      ["slack-member:C0123456789", { kind: "unread", why: "no Slack user token is stored" }],
    ]);
    const report = recheckReport({ observations, probes: plan.probes, unchecked: plan.unchecked });
    expect(report.unmet.map((line) => line.id)).toEqual(["clerk-a", "clerk-b"]);
    expect(report.unread).toEqual([{ because: "no Slack user token is stored", id: "join" }]);
    expect(report.met).toEqual([]);
  });

  it("plans nothing over no steps", () => {
    expect(recheckPlan({ steps: [] })).toEqual({ probes: [], unchecked: [] });
  });
});

describe("recheckDid", () => {
  it("says no hand touched it, so the settling never reads as the owner's Done", () => {
    expect(recheckDid({ nowIso: "2026-10-07T01:00:00.000Z", observed: "clerk opened it" })).toBe(
      "retired by recheck — already met: clerk opened it at 2026-10-07T01:00:00.000Z, no hand touched it",
    );
  });
});
