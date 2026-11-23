/**
 * `supervisor sweep-prompt`'s flag tail: which combinations name one shift state, and which name two.
 *
 * The pure render's own rules are `../supervisor/sweepPrompt.test.ts`. What is tested here is the parser,
 * because two of the three refusals it now carries were once silent resolutions — `--shift`
 * beside `--shift-file` took the file and dropped the inline text with no diagnostic at all.
 */
import { describe, expect, it } from "vitest";

import { parseSweepPromptOptions, runSweepPrompt } from "../../../cli/commands/supervisor/run.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { LEAN_LANES } from "../plans/laneFixtures.js";

/** A chair read standing on one Claude plan, so no timer sweep is armed. */
const LEAN_EVIDENCE = {
  chair: { kind: "resolved", sessions: [], workspaceCwd: "/wt/chair", workspaceId: "WS" },
  kind: "read",
  lanes: LEAN_LANES,
} as const;

describe("runSweepPrompt — the lean shape", () => {
  it("prints no prompt and exits expected-empty once one Claude plan stands", async () => {
    const code = await runSweepPrompt({
      argv: ["node", "slopweaver", "supervisor", "sweep-prompt", "--shift", "ws 971 landing #231"],
      evidence: LEAN_EVIDENCE,
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("still refuses a shift source it cannot read, so the lean shape drops no line the verb prints", async () => {
    const code = await runSweepPrompt({
      argv: ["node", "slopweaver", "supervisor", "sweep-prompt", "--shift-file", "/no/such/shift.txt"],
      evidence: LEAN_EVIDENCE,
    });

    expect(code).toBe(EXIT_ERROR);
  });
});

describe("parseSweepPromptOptions", () => {
  it("reads an inline shift state", () => {
    expect(unwrap(parseSweepPromptOptions({ rest: ["--shift", "ws 971 landing #231"] }))).toEqual({
      budget: false,
      json: false,
      shift: "ws 971 landing #231",
      shiftFile: undefined,
    });
  });

  it("reads a shift file, stdin included", () => {
    expect(unwrap(parseSweepPromptOptions({ rest: ["--shift-file", "-", "--json"] }))).toEqual({
      budget: false,
      json: true,
      shift: undefined,
      shiftFile: "-",
    });
  });

  it("reads a budget query on its own", () => {
    expect(unwrap(parseSweepPromptOptions({ rest: ["--budget", "--json"] }))).toEqual({
      budget: true,
      json: true,
      shift: undefined,
      shiftFile: undefined,
    });
  });

  it("treats no flag at all as a quiet tick rather than a bad invocation", () => {
    expect(unwrap(parseSweepPromptOptions({ rest: [] })).shift).toBe(undefined);
  });

  it("refuses two shift states at once instead of silently preferring the file", () => {
    expect(unwrapErr(parseSweepPromptOptions({ rest: ["--shift", "inline", "--shift-file", "/tmp/s.txt"] }))).toEqual([
      "--shift and --shift-file name two different shift states — give exactly one",
    ]);
  });

  it("refuses a budget query beside a shift state it has not been asked to render", () => {
    expect(unwrapErr(parseSweepPromptOptions({ rest: ["--budget", "--shift", "inline"] }))).toEqual([
      "--budget prints the budget for a shift state you have not written yet, so it takes neither --shift nor --shift-file",
    ]);
  });

  it("names both faults of one invocation at once", () => {
    expect(
      unwrapErr(parseSweepPromptOptions({ rest: ["--budget", "--shift", "inline", "--shift-file", "/tmp/s.txt"] }))
        .length,
    ).toBe(2);
  });
});
