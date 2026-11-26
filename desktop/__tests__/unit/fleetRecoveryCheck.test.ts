/**
 * The Recovery check as the app reads it: the CLI's one stdout line read strictly, one pass at a time whichever surface
 * pressed, and every state's words, none of which reads a missing result as a pass.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { FleetRecoveryErrors } from "../../src/errors";
import {
  type FleetRecoveryResult,
  fleetRecoveryPresentation,
  parseFleetRecovery,
  RECOVERY_IDLE,
  stepFleetRecovery,
} from "../../src/fleetRecoveryCheck";

/** The document `fleet recover` prints, every field the CLI writes included, the app reading only some. */
const PRINTED = {
  attempts: [
    {
      alias: "claude-1",
      attemptId: "a-1",
      outcome: "deadline",
      reason: "no answer in 3 minutes",
      sessionId: "s-1",
      vendor: "claude",
    },
    { alias: "codex-1", attemptId: "a-2", outcome: "passed", reason: "it answered", sessionId: "s-2", vendor: "codex" },
  ],
  finishedAtIso: "2026-11-26T01:10:00.000Z",
  runId: "run-1",
  schemaVersion: 1,
  startedAtIso: "2026-11-26T01:05:00.000Z",
  status: "partial",
  vendors: [
    { alias: "claude-1", excluded: [], reason: "no answer in 3 minutes", status: "failed", vendor: "claude" },
    {
      alias: "codex-1",
      excluded: [{ alias: "codex-2", reason: "signed out" }],
      reason: "it answered",
      status: "passed",
      vendor: "codex",
    },
  ],
};

/** The printed document with some fields replaced, as the one line the verb writes. */
const lineWith = (over: Record<string, unknown>): string => `${JSON.stringify({ ...PRINTED, ...over })}\n`;

describe("parseFleetRecovery", () => {
  it("reads the one line the verb prints, whatever extra fields it carries", () => {
    const result = unwrap(parseFleetRecovery({ text: lineWith({}) }));
    expect(result.status).toBe("partial");
    expect(result.vendors.map((entry) => `${entry.vendor}:${entry.status}`)).toEqual(["claude:failed", "codex:passed"]);
    expect(result.attempts.map((attempt) => attempt.sessionId)).toEqual(["s-1", "s-2"]);
  });

  it("refuses anything but exactly one line", () => {
    expect(unwrapErr(parseFleetRecovery({ text: "" })).message).toBe(
      "fleet recover printed a result malformed at the output (0 lines, not one), so no success was recorded",
    );
    expect(unwrapErr(parseFleetRecovery({ text: lineWith({}) + lineWith({}) })).code).toBe("RECOVERY_UNREADABLE");
  });

  it("names the field that is malformed", () => {
    const cases: readonly { readonly text: string; readonly field: string }[] = [
      { field: "the output (not JSON)", text: "not json\n" },
      { field: "schemaVersion", text: lineWith({ schemaVersion: 2 }) },
      { field: "status", text: lineWith({ status: "fine" }) },
      { field: "vendors", text: lineWith({ vendors: [PRINTED.vendors[0]] }) },
      { field: "attempts", text: lineWith({ attempts: [{ ...PRINTED.attempts[0], sessionId: 7 }] }) },
      { field: "signIn", text: lineWith({ signIn: { alias: "codex-2", vendor: "codex" } }) },
      { field: "infrastructure", text: lineWith({ infrastructure: 3 }) },
    ];
    expect(cases.map(({ text }) => unwrapErr(parseFleetRecovery({ text })))).toEqual(
      cases.map(({ field }) => FleetRecoveryErrors.unreadable({ field })),
    );
  });
});

describe("stepFleetRecovery", () => {
  const result = unwrap(parseFleetRecovery({ text: lineWith({}) }));

  it("starts a pass on a press, and none on a second press while it runs", () => {
    const first = stepFleetRecovery({ event: { kind: "pressed" }, state: RECOVERY_IDLE });
    expect(first).toEqual({ run: true, state: { kind: "running" } });
    expect(stepFleetRecovery({ event: { kind: "pressed" }, state: first.state })).toEqual({
      run: false,
      state: { kind: "running" },
    });
  });

  it("records what a pass ended with, and lets the next press start another", () => {
    const finished = stepFleetRecovery({ event: { kind: "finished", result }, state: { kind: "running" } });
    expect(finished).toEqual({ run: false, state: { kind: "result", result } });
    expect(stepFleetRecovery({ event: { kind: "pressed" }, state: finished.state }).run).toBe(true);
  });
});

describe("fleetRecoveryPresentation", () => {
  it("offers the press except while a check runs", () => {
    expect(fleetRecoveryPresentation({ state: RECOVERY_IDLE })).toEqual({
      canRun: true,
      headline: "Recovery check: not run since the app opened.",
      lines: [],
    });
    expect(fleetRecoveryPresentation({ state: { kind: "running" } }).canRun).toBe(false);
  });

  it("never says a vendor whose verdict failed started a session, even when its card opened", () => {
    const result = unwrap(parseFleetRecovery({ text: lineWith({}) }));
    expect(fleetRecoveryPresentation({ state: { kind: "result", result } }).lines).toEqual([
      "Claude did not pass: no answer in 3 minutes",
      "Codex started a session on plan codex-1.",
    ]);
  });

  it("says what stopped a check that could not run, and never reads it as a pass", () => {
    const broken: FleetRecoveryResult = {
      attempts: [],
      infrastructure: "the app is not serving its session socket",
      status: "infrastructure-failed",
      vendors: [
        { reason: "not tried", status: "failed", vendor: "claude" },
        { reason: "not tried", status: "failed", vendor: "codex" },
      ],
    };
    expect(fleetRecoveryPresentation({ state: { kind: "result", result: broken } })).toEqual({
      canRun: true,
      headline: "Recovery check: the check itself could not run.",
      lines: [
        "Claude did not pass: not tried",
        "Codex did not pass: not tried",
        "What stopped it: the app is not serving its session socket",
      ],
    });
    const unread = { error: FleetRecoveryErrors.didNotRun({ detail: "spawn ENOENT" }), kind: "no-result" } as const;
    expect(fleetRecoveryPresentation({ state: unread }).lines).toEqual([
      "fleet recover gave no result, so no success was recorded: spawn ENOENT",
    ]);
  });
});
