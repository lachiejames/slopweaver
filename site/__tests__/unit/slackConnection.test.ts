/*
 * Whether Slack is connected, as the thread panel reads it off the door's own preflight: an absent token is an ANSWER
 * even though the preflight exits 3 on it, and anything that is not Slack's report leaves disconnection unproved.
 */

import { describe, expect, it } from "vitest";

import { slackConnectionViewOf } from "../../components/console/useSlackConnection";
import { slackConnectionResultOf, slackTokenPresentOf } from "../../lib/slackConnection";

const AT = "2026-11-02T13:40:00.000Z";

describe("slackConnectionResultOf", () => {
  it("reads a present token off a passing preflight", () => {
    const out = JSON.stringify({ ok: true, source: "slack", tokenPresent: true });
    expect(slackConnectionResultOf({ exitCode: 0, observedAtIso: AT, out, why: "" })).toEqual({
      observedAtIso: AT,
      ok: true,
      tokenPresent: true,
    });
  });

  it("reads an absent token off a preflight that exited 3 as an answer, not a failure", () => {
    const out = JSON.stringify({ ok: false, source: "slack", tokenPresent: false });
    expect(slackConnectionResultOf({ exitCode: 3, observedAtIso: AT, out, why: "exited 3" })).toEqual({
      observedAtIso: AT,
      ok: true,
      tokenPresent: false,
    });
  });

  it("keeps a present token with a failed check connected, so the read keeps its own explanation", () => {
    const out = JSON.stringify({ ok: false, source: "slack", tokenPresent: true });
    expect(slackConnectionResultOf({ exitCode: 3, observedAtIso: AT, out, why: "exited 3" })).toEqual({
      observedAtIso: AT,
      ok: true,
      tokenPresent: true,
    });
  });

  it("carries the spawn's own reason when the preflight did not run to a report", () => {
    expect(slackConnectionResultOf({ exitCode: undefined, observedAtIso: AT, out: "", why: "timed out" })).toEqual({
      notMeasured: "timed out",
      observedAtIso: AT,
      ok: false,
    });
    expect(slackConnectionResultOf({ exitCode: 1, observedAtIso: AT, out: "{}", why: "exited 1" })).toEqual({
      notMeasured: "exited 1",
      observedAtIso: AT,
      ok: false,
    });
  });

  it("refuses stdout that is not JSON", () => {
    expect(slackConnectionResultOf({ exitCode: 0, observedAtIso: AT, out: "Slack: ok", why: "" })).toEqual({
      notMeasured: "slopweaver connect slack --check printed something that is not JSON",
      observedAtIso: AT,
      ok: false,
    });
  });

  it("refuses a report with no tokenPresent", () => {
    const out = JSON.stringify({ ok: true, source: "slack" });
    expect(slackConnectionResultOf({ exitCode: 0, observedAtIso: AT, out, why: "" })).toEqual({
      notMeasured: "slopweaver connect slack --check printed no Slack tokenPresent",
      observedAtIso: AT,
      ok: false,
    });
  });
});

describe("slackTokenPresentOf", () => {
  it("refuses another door's report and a non-object", () => {
    expect(slackTokenPresentOf({ payload: { source: "linear", tokenPresent: false } })).toBe(undefined);
    expect(slackTokenPresentOf({ payload: [false] })).toBe(undefined);
    expect(slackTokenPresentOf({ payload: null })).toBe(undefined);
  });

  it("refuses a tokenPresent that is not a boolean", () => {
    expect(slackTokenPresentOf({ payload: { source: "slack", tokenPresent: "false" } })).toBe(undefined);
  });
});

describe("slackConnectionViewOf", () => {
  const absent = { phase: "ready", tokenPresent: false } as const;

  it("is idle until the panel wants an answer, whatever arrived before", () => {
    expect(slackConnectionViewOf({ answer: { key: "A", state: absent }, key: "A", wanted: false })).toEqual({
      phase: "idle",
    });
  });

  it("is loading while no answer has arrived", () => {
    expect(slackConnectionViewOf({ answer: undefined, key: "A", wanted: true })).toEqual({ phase: "loading" });
  });

  it("never draws another thread's answer while this thread's preflight is in flight", () => {
    expect(slackConnectionViewOf({ answer: { key: "A", state: absent }, key: "B", wanted: true })).toEqual({
      phase: "loading",
    });
  });

  it("draws the answer fetched for this thread", () => {
    expect(slackConnectionViewOf({ answer: { key: "B", state: absent }, key: "B", wanted: true })).toEqual(absent);
  });
});
