/**
 * The shell's reading of one `cmux revive --json`, and whether it holds the automatic recovery back.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { parseCmuxRevive, reviveHoldsLaunch } from "../../src/cmuxRevive";

/** The line the verb printed from outside cmux, against the running app. */
const ANSWERING =
  '{"action":"none","appPid":24622,"detail":"ERROR: Access denied - only processes started inside cmux can connect","state":"answering"}';

describe("parseCmuxRevive", () => {
  it("reads the measured answering line", () => {
    expect(unwrap(parseCmuxRevive({ text: ANSWERING }))).toEqual({
      action: "none",
      restartOutcome: undefined,
      state: "answering",
    });
  });

  it("reads a restart's outcome, after a line of other output", () => {
    const text = `warning: something\n{"action":"restart","appPid":5088,"detail":"","state":"refused","restart":{"outcome":"answering","newAppPid":24622,"detail":""}}`;
    expect(unwrap(parseCmuxRevive({ text }))).toEqual({
      action: "restart",
      restartOutcome: "answering",
      state: "refused",
    });
  });

  it("refuses output carrying no document", () => {
    expect(unwrapErr(parseCmuxRevive({ text: "cmux revive: refusing to run inside cmux" }))).toBe(
      "cmux revive printed no JSON document",
    );
  });

  it("refuses a line that only opens like JSON", () => {
    expect(unwrapErr(parseCmuxRevive({ text: "{not json" }))).toBe("cmux revive printed a line that is not JSON");
  });

  it("refuses an unknown state", () => {
    expect(unwrapErr(parseCmuxRevive({ text: '{"state":"sleepy"}' }))).toBe(
      "cmux revive printed a document with no known state",
    );
  });

  it("refuses a document with no known action", () => {
    expect(unwrapErr(parseCmuxRevive({ text: '{"action":"shrug","state":"stalled"}' }))).toBe(
      "cmux revive printed a document with no known action",
    );
  });
});

describe("reviveHoldsLaunch", () => {
  it("holds nothing before the first knock", () => {
    expect(reviveHoldsLaunch({ reading: undefined })).toBe(false);
  });

  it("holds nothing while cmux answers", () => {
    expect(reviveHoldsLaunch({ reading: { action: "none", restartOutcome: undefined, state: "answering" } })).toBe(
      false,
    );
  });

  it("holds the launch on a refused socket", () => {
    expect(reviveHoldsLaunch({ reading: { action: "none", restartOutcome: undefined, state: "refused" } })).toBe(true);
  });

  it("holds the launch on a silent socket", () => {
    expect(reviveHoldsLaunch({ reading: { action: "none", restartOutcome: undefined, state: "silent" } })).toBe(true);
  });

  it("holds the launch while the seats' calls time out behind an answering socket", () => {
    const text = '{"action":"wait","appPid":24622,"detail":"ERROR: Access denied","state":"stalled"}';
    expect(reviveHoldsLaunch({ reading: unwrap(parseCmuxRevive({ text })) })).toBe(true);
  });

  it("holds nothing when no seat has called cmux to judge it by", () => {
    const text = '{"action":"none","appPid":24622,"detail":"ERROR: Access denied","state":"unprobed"}';
    expect(reviveHoldsLaunch({ reading: unwrap(parseCmuxRevive({ text })) })).toBe(false);
  });

  it("holds the launch on an unprobed knock the run still waits out as a hang", () => {
    const text = '{"action":"wait","appPid":18135,"detail":"ERROR: Access denied","state":"unprobed"}';
    expect(reviveHoldsLaunch({ reading: unwrap(parseCmuxRevive({ text })) })).toBe(true);
  });

  it("holds the launch while a restart is held, whatever the knock heard", () => {
    expect(reviveHoldsLaunch({ reading: { action: "held", restartOutcome: undefined, state: "unprobed" } })).toBe(true);
  });

  it("holds the launch when a restart came up still not answering", () => {
    expect(
      reviveHoldsLaunch({ reading: { action: "restart", restartOutcome: "not-answering", state: "refused" } }),
    ).toBe(true);
  });

  it("releases the launch once a restart brought cmux back", () => {
    expect(reviveHoldsLaunch({ reading: { action: "restart", restartOutcome: "answering", state: "refused" } })).toBe(
      false,
    );
  });

  it("holds nothing when cmux is not running at all — opening it is the recovery's own first step", () => {
    expect(reviveHoldsLaunch({ reading: { action: "none", restartOutcome: undefined, state: "absent" } })).toBe(false);
  });
});
