/**
 * The plan choice the one ledger writer records on a session's `spawned` row (`sessionHarness/spawnedEvent.ts`):
 * the booted plan's when the launch reported one, else the spec's, and never one the ledger's reader would refuse.
 */
import { describe, expect, it } from "vitest";

import { ok } from "../../../lib/result.js";
import { recordingSessionLauncher } from "../../../sessionHarness/recordingHarness.js";
import { spawnedEventOf } from "../../../sessionHarness/spawnedEvent.js";
import type { SessionPlanChoice } from "../../../sessions/planChoice.js";
import type { SessionEvent } from "../../../sessions/session.js";
import { collectingLedger, NOW, OPENED, SPEC, scriptedLauncher } from "./recordingLedgerFixtures.js";

/** What a Codex seat's route decided before the launch. */
const SPEC_CHOICE: SessionPlanChoice = {
  alias: "plan-six",
  basis: "routed",
  kind: "named",
  alternative: "--plan <alias> names another Codex plan; omit --plan to take the ranked best",
  readings: [{ alias: "plan-six", reading: "ranked 1 of 1 eligible, on weekly", state: "chosen" }],
  reason: "ranked first of 1 eligible destination(s), on weekly",
  vendor: "codex",
};

/** What the launch's own credential gate decided as the plan booted. */
const BOOTED_CHOICE: SessionPlanChoice = {
  alias: "plan-two",
  basis: "routed",
  kind: "named",
  alternative: "--plan <alias>",
  readings: [{ alias: "plan-two", reading: "all-models week 30%", state: "chosen" }],
  reason: "ranked first of 1 eligible plan(s) for a all-models spawn",
  vendor: "claude",
};

const ADDRESS = { endpointHandle: "surface:7", handle: "workspace:7", sessionId: "id-7" } as const;

/** The plan choice on an event the case knows is a `spawned` one. */
const choiceOn = ({ event }: { event: SessionEvent | undefined }): SessionPlanChoice | undefined => {
  expect(event!.kind).toBe("spawned");
  return (event as Extract<SessionEvent, { kind: "spawned" }>).planChoice;
};

describe("spawnedEventOf's plan choice", () => {
  it("records the spec's choice when the launch reported none", () => {
    const event = spawnedEventOf({
      address: ADDRESS,
      implementation: "cmux",
      operation: "open",
      spec: { ...SPEC, planChoice: SPEC_CHOICE },
      tsIso: NOW,
    });
    expect(choiceOn({ event })).toStrictEqual(SPEC_CHOICE);
  });

  it("prefers the booted plan's choice over the spec's", () => {
    const event = spawnedEventOf({
      address: ADDRESS,
      booted: BOOTED_CHOICE,
      implementation: "cmux",
      operation: "open",
      spec: { ...SPEC, planChoice: SPEC_CHOICE },
      tsIso: NOW,
    });
    expect(event).toStrictEqual({
      bootModel: { kind: "pinned", model: "opus" },
      branch: "a-branch",
      cwd: "/work/tree-7",
      harness: "cmux",
      kind: "spawned",
      openedBy: "open",
      planChoice: BOOTED_CHOICE,
      sessionId: "id-7",
      sessionKey: "a-doc",
      slug: "a-doc",
      surfaceRef: "surface:7",
      tsIso: NOW,
      workspaceId: "id-7",
      workspaceRef: "workspace:7",
    });
  });

  it("carries no choice when neither the launch nor the spec had one", () => {
    const event = spawnedEventOf({
      address: ADDRESS,
      implementation: "cmux",
      operation: "open",
      spec: SPEC,
      tsIso: NOW,
    });
    expect(Object.keys(event).includes("planChoice")).toBe(false);
  });

  it("leaves off a choice the reader would refuse, so the row itself stays readable", () => {
    const leaked: SessionPlanChoice = {
      ...BOOTED_CHOICE,
      reason: "booted on /stores/plan-two for seat-1@example.test",
    };
    const event = spawnedEventOf({
      address: ADDRESS,
      booted: leaked,
      implementation: "cmux",
      operation: "open",
      spec: SPEC,
      tsIso: NOW,
    });
    expect(Object.keys(event).includes("planChoice")).toBe(false);
    expect(JSON.stringify(event)).not.toContain("seat-1@example.test");
    expect(event.sessionKey).toBe("a-doc");
  });
});

describe("recordingSessionLauncher records the plan the launch booted", () => {
  it("writes the opened session's choice onto the row, over the spec's", async () => {
    const { launcher } = scriptedLauncher({ outcome: ok({ ...OPENED, planChoice: BOOTED_CHOICE }) });
    const { events, ledger } = collectingLedger({});
    await recordingSessionLauncher({ implementation: "cmux", launcher, ledger }).open({
      spec: { ...SPEC, planChoice: SPEC_CHOICE },
    });
    expect(events.length).toBe(1);
    expect(choiceOn({ event: events[0] })).toStrictEqual(BOOTED_CHOICE);
  });
});
