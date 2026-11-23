import { describe, expect, it } from "vitest";

import {
  DESKTOP_E2E_FLAG_NAMES,
  e2eExitCode,
  parseDesktopE2eArgs,
} from "../../../../../cli/commands/desktop/e2eRun.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { E2eCallFlagErrors } from "../../../../../desktop/e2eCallErrors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("e2eExitCode — a call seen holds with 4, a fault is 1", () => {
  it("is 0 when nothing failed and nothing stopped the run", () => {
    expect(e2eExitCode({ failed: 0, fatal: undefined, heldOnCall: false })).toBe(EXIT_OK);
  });

  it("is 4 when the only stop was the owner's call", () => {
    expect(e2eExitCode({ failed: 0, fatal: "desktop e2e held: the owner is on a call", heldOnCall: true })).toBe(
      EXIT_DEFERRED,
    );
  });

  it("is 1 when the stop was a fault, an unreadable call state included", () => {
    expect(e2eExitCode({ failed: 0, fatal: "cannot be told", heldOnCall: false })).toBe(EXIT_ERROR);
  });

  it("is 1 when a step failed before the owner's call stopped the run — a hold never masks a failure", () => {
    expect(e2eExitCode({ failed: 1, fatal: "desktop e2e held: the owner is on a call", heldOnCall: true })).toBe(
      EXIT_ERROR,
    );
  });
});

describe("parseDesktopE2eArgs", () => {
  it("declares its flags", () => {
    expect(DESKTOP_E2E_FLAG_NAMES).toEqual([
      "--app",
      "--call",
      "--call-card",
      "--call-hold-minutes",
      "--call-mic-candidate",
      "--checkout",
      "--context",
      "--home",
      "--json",
      "--menu-bar",
      "--only",
      "--out",
      "--settle-cap",
    ]);
  });

  it("expands transcription-fidelity into six calls with a candidate, and refuses it without one", () => {
    const named = unwrap(
      parseDesktopE2eArgs({
        rest: ["--call", "--only", "transcription-fidelity", "--call-mic-candidate", "both-off"],
      }),
    );
    expect(named.calls.map((step) => step.fidelity!.variant)).toEqual([
      "control",
      "both-off",
      "both-off",
      "control",
      "control",
      "both-off",
    ]);
    expect(unwrapErr(parseDesktopE2eArgs({ rest: ["--call", "--only", "transcription-fidelity"] }))).toEqual([
      E2eCallFlagErrors.fidelityWithoutCandidate().message,
    ]);
  });

  it("places no call unless --call asks", () => {
    expect(unwrap(parseDesktopE2eArgs({ rest: [] })).calls).toEqual([]);
  });

  it("adds the call leg with --call, holding for the minutes asked", () => {
    const args = unwrap(parseDesktopE2eArgs({ rest: ["--call", "--call-hold-minutes", "2"] }));
    expect([args.steps.length, args.calls.length]).toEqual([16, 14]);
    expect(args.calls.find((step) => step.id === "call-holds")!.holdMs).toBe(120_000);
  });

  it("runs just the named call scenario, with no walk step", () => {
    const args = unwrap(parseDesktopE2eArgs({ rest: ["--call", "--only", "call-live"] }));
    expect([args.steps, args.calls.map((step) => step.id)]).toEqual([[], ["call-live"]]);
  });

  it("refuses a call scenario without --call", () => {
    expect(unwrapErr(parseDesktopE2eArgs({ rest: ["--only", "call-live"] }))).toEqual([
      "--only names call scenario(s) without --call, which places no call: call-live",
    ]);
  });

  it("refuses a hold without --call, and a hold out of range", () => {
    expect(unwrapErr(parseDesktopE2eArgs({ rest: ["--call-hold-minutes", "5"] }))).toEqual([
      "--call-hold-minutes configures the call leg, so it needs --call",
    ]);
    expect(unwrapErr(parseDesktopE2eArgs({ rest: ["--call", "--call-hold-minutes", "0"] }))).toEqual([
      "--call-hold-minutes takes a whole number from 1 to 30, not 0",
    ]);
  });

  it("adds both card surfaces after long-task-mid-call for each named card, spoken first, carrying the key", () => {
    const args = unwrap(parseDesktopE2eArgs({ rest: ["--call", "--call-card", "ask:acme-a,act:acme-b"] }));
    const ids = args.calls.map((step) => [step.id, step.cardKey]);
    const at = ids.findIndex(([id]) => id === "long-task-mid-call");
    expect([args.calls.length, ids.slice(at + 1, at + 5), args.inventorySurfaces]).toEqual([
      18,
      [
        ["card-read", "ask:acme-a"],
        ["card-read-typed", "ask:acme-a"],
        ["card-read", "act:acme-b"],
        ["card-read-typed", "act:acme-b"],
      ],
      [],
    ]);
  });

  it("runs one surface alone over the named card, a hand note too, naming it by its id's words", () => {
    const only = ({ key, id }: { key: string; id: string }) =>
      unwrap(parseDesktopE2eArgs({ rest: ["--call", "--call-card", key, "--only", id] }));
    const hand = only({ id: "card-read", key: "hand:acme-sample-note" });
    expect([hand.steps, hand.calls.map((step) => [step.id, step.cardKey])]).toEqual([
      [],
      [["card-read", "hand:acme-sample-note"]],
    ]);
    expect([hand.calls[0]!.prompt, only({ id: "card-read-typed", key: "align:voice-acme" }).calls[0]!.prompt]).toEqual([
      expect.stringContaining("Queue card acme sample note and"),
      expect.stringContaining("Alignment card voice acme and"),
    ]);
  });

  it("leaves every open card to the inventory with all, placing no card yet", () => {
    const args = unwrap(parseDesktopE2eArgs({ rest: ["--call", "--call-card", "all", "--only", "card-read-typed"] }));
    expect([args.calls, args.inventorySurfaces]).toEqual([[], ["card-read-typed"]]);
  });

  it("refuses a card without --call, and a card scenario without a card", () => {
    expect(unwrapErr(parseDesktopE2eArgs({ rest: ["--call-card", "ask:fixture-card"] }))).toEqual([
      "--call-card configures the call leg, so it needs --call",
    ]);
    expect(unwrapErr(parseDesktopE2eArgs({ rest: ["--call", "--only", "card-read"] }))).toEqual([
      "--only card-read and card-read-typed need --call-card <kind>:<id>[,<kind>:<id>...] or --call-card all",
    ]);
  });

  it("refuses a card key no card tool takes: no kind, an unknown kind, a recipe, a slash, past 160, none", () => {
    const refusal = ({ key }: { key: string }): readonly string[] =>
      unwrapErr(parseDesktopE2eArgs({ rest: ["--call", `--call-card=${key}`] }));
    const shape =
      "--call-card must be all, or card keys exactly as the console names them, comma-separated, each <kind>:<id> " +
      "(ask, hand, draft, post, review, import, pr, act or align, then up to 160 letters, digits, '.', '_' or " +
      "'-'); refused ";
    const long = `ask:${"a".repeat(161)}`;
    const keys = ["fixture-card", "card:fixture-card", "recipe:fixture-card", "ask:fixture/card", long, ""];
    expect(keys.map((key) => refusal({ key }))).toEqual(keys.map((key) => [shape + JSON.stringify(key)]));
    expect(refusal({ key: "ask:ok,candidate:x,nope" })).toEqual([shape + JSON.stringify("candidate:x, nope")]);
  });

  it("walks the installed app, every step, when nothing is named", () => {
    const args = unwrap(parseDesktopE2eArgs({ rest: [] }));
    expect([args.app, args.checkout, args.out, args.json, args.menuBar, args.steps.length]).toEqual([
      "/Applications/Slopweaver.app",
      undefined,
      undefined,
      false,
      false,
      16,
    ]);
  });

  it("asks for the test instance's own menu bar icon with --menu-bar, walk and calls alike", () => {
    const args = unwrap(parseDesktopE2eArgs({ rest: ["--menu-bar", "--call", "--only", "queue,call-live"] }));
    expect([args.menuBar, args.steps.map((step) => step.id), args.calls.map((step) => step.id)]).toEqual([
      true,
      ["queue"],
      ["call-live"],
    ]);
  });

  it("puts the test instance in the work context asked for, walk and calls alike, and leaves it be when not asked", () => {
    const asked = ({ context }: { context: string }) =>
      unwrap(parseDesktopE2eArgs({ rest: ["--context", context, "--call", "--only", "queue,call-live"] }));
    expect([asked({ context: "slopweaver" }).context, asked({ context: "work" }).context]).toEqual([
      "slopweaver",
      "work",
    ]);
    expect(unwrap(parseDesktopE2eArgs({ rest: [] })).context).toBeUndefined();
  });

  it("refuses a context the console does not have", () => {
    expect(unwrapErr(parseDesktopE2eArgs({ rest: ["--context", "acme"] }))).toEqual([
      '--context must be one of work, slopweaver, not "acme"',
    ]);
  });

  it("settles each walk step under the cap asked for in seconds, thirty when not asked", () => {
    const capOf = ({ rest }: { rest: readonly string[] }) => unwrap(parseDesktopE2eArgs({ rest })).settleCapMs;
    expect([capOf({ rest: ["--settle-cap", "120"] }), capOf({ rest: [] })]).toEqual([120_000, 30_000]);
  });

  it("refuses a settle cap that is not whole seconds from 1 to 600", () => {
    expect(unwrapErr(parseDesktopE2eArgs({ rest: ["--settle-cap", "0"] }))).toEqual([
      '--settle-cap must be whole seconds from 1 to 600, not "0"',
    ]);
  });

  it("takes the published page alone, with no call", () => {
    const args = unwrap(parseDesktopE2eArgs({ rest: ["--only", "pages"] }));
    expect([args.steps, args.calls]).toEqual([[{ id: "pages", kind: "published-page" }], []]);
  });

  it("takes a candidate bundle and a subset of steps", () => {
    const args = unwrap(
      parseDesktopE2eArgs({ rest: ["--app", "/c/Slopweaver.app", "--only", "voice,queue", "--json"] }),
    );
    expect([args.app, args.steps.map((step) => step.id), args.json]).toEqual([
      "/c/Slopweaver.app",
      ["queue", "voice"],
      true,
    ]);
  });

  it("refuses a step id it does not know, naming the steps it does", () => {
    const [problem] = unwrapErr(parseDesktopE2eArgs({ rest: ["--only", "now"] }));
    expect(problem).toContain("--only names no step: now (the steps: queue, queue-card,");
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseDesktopE2eArgs({ rest: ["--headless"] }))).toEqual(["unknown flag: --headless"]);
  });
});
