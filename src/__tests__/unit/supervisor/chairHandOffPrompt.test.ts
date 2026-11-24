/**
 * The prompt a close prints LAST: the hand-off in place of the sweep prompt only when the cadence says go and a
 * host can take the successor.
 */
import { describe, expect, it } from "vitest";

import { CODEX_MODEL } from "../../../codex/profiles.js";
import type { ChairCadenceVerdict } from "../../../supervisor/chairCadence.js";
import { closePromptOf, successorSlugOf } from "../../../supervisor/chairHandOffPrompt.js";

const SWEEP = "run one sweep tick per the standing contract";

/** The chair: plan-one at 97% of its Fable week, routing picking plan-three. */
const AT_THE_WALL: Extract<ChairCadenceVerdict, { kind: "hand-off" }> = {
  kind: "hand-off",
  notes: [],
  reasons: [{ alias: "plan-one", kind: "plan-window-near", pct: 97, thresholdPercent: 75, window: "seven-day Fable" }],
  route: { alias: "plan-three", kind: "picks" },
};

describe("successorSlugOf", () => {
  it("names the next handoff after the seat's", () => {
    expect(successorSlugOf({ handoff: "handoff-9294" })).toBe("fresh-supervisor-handoff-9295");
  });

  it("names a placeholder for a handoff carrying no number", () => {
    expect(successorSlugOf({ handoff: "handoff-x" })).toBe("fresh-supervisor-handoff-<next>");
  });
});

describe("closePromptOf", () => {
  it("replaces the sweep prompt with the hand-off, naming the reason and the successor's Claude spawn", () => {
    const last = closePromptOf({
      cadence: { kind: "hand-off", target: { kind: "claude" }, verdict: AT_THE_WALL },
      handoff: "handoff-9294",
      sweepPrompt: SWEEP,
    });

    expect(last.handOff).toBe(true);
    expect(last.prompt!.split("\n").slice(0, 2)).toStrictEqual([
      "HAND OFF NOW — do NOT re-arm the sweep from this chair. Its own measurements say seat a successor now:",
      "  - plan-one is at 97% of its seven-day Fable week — at or past 75%, so leave it before the wall",
    ]);
    expect(last.prompt).toContain(
      "`slopweaver cmux spawn fresh-supervisor-handoff-9295 --driver claude --model fable`",
    );
    expect(last.prompt).not.toContain(SWEEP);
  });

  it("seats a Codex successor with an explicit Codex driver and never a Fable pin", () => {
    const last = closePromptOf({
      cadence: { kind: "hand-off", target: { kind: "codex" }, verdict: AT_THE_WALL },
      handoff: "handoff-9294",
      sweepPrompt: SWEEP,
    });

    expect(last.handOff).toBe(true);
    expect(last.prompt!.split("\n")[3]).toBe(
      `2. \`slopweaver cmux spawn fresh-supervisor-handoff-9295 --driver codex --model ${CODEX_MODEL}\` — routing ranks every registered Codex plan and never seats one at its usage limit; its \`codex seat on <alias>\` line names which.`,
    );
    expect(last.prompt).not.toContain("fable");
  });

  // On a one-plan install the chair hands off to a successor on that same plan.
  it("hands off onto the chair's own, only plan when a fresh boot is the reason", () => {
    const last = closePromptOf({
      cadence: {
        kind: "hand-off",
        target: { kind: "claude" },
        verdict: {
          kind: "hand-off",
          notes: [],
          reasons: [{ boots: "2.1.283", kind: "claude-code-behind", running: "2.1.280" }],
          route: { alias: "plan-one", kind: "picks" },
        },
      },
      handoff: "handoff-9294",
      sweepPrompt: SWEEP,
    });

    expect(last.handOff).toBe(true);
    expect(last.prompt).toContain(
      "`slopweaver cmux spawn fresh-supervisor-handoff-9295 --driver claude --model fable`",
    );
    expect(last.prompt).not.toContain(SWEEP);
  });

  it("replaces the sweep prompt with the hand-off on the chair's fifth auto-compaction", () => {
    const last = closePromptOf({
      cadence: {
        kind: "hand-off",
        target: { kind: "claude" },
        verdict: {
          kind: "hand-off",
          notes: [],
          reasons: [{ autoCompactionsAtLeast: 5, kind: "auto-compacted", sessionId: "a0000032", trialCount: 5 }],
          route: { alias: "plan-one", kind: "picks" },
        },
      },
      handoff: "handoff-9294",
      sweepPrompt: SWEEP,
    });

    expect(last.handOff).toBe(true);
    expect(last.prompt!.split("\n").slice(0, 2)).toStrictEqual([
      "HAND OFF NOW — do NOT re-arm the sweep from this chair. Its own measurements say seat a successor now:",
      "  - session a0000032 has been auto-compacted at least 5 times — the 5-auto-compaction trial seats a successor now",
    ]);
    expect(last.prompt).not.toContain(SWEEP);
  });

  it("keeps the sweep prompt under the reason when no host can take the successor", () => {
    const last = closePromptOf({
      cadence: {
        kind: "hand-off",
        target: { kind: "none", why: "every registered plan is paused" },
        verdict: AT_THE_WALL,
      },
      handoff: "handoff-9294",
      sweepPrompt: SWEEP,
    });

    expect(last).toStrictEqual({
      handOff: false,
      prompt: `HAND-OFF TARGET UNAVAILABLE — every registered plan is paused\n${SWEEP}`,
    });
  });

  it("keeps the sweep prompt byte for byte for a chair told to stay, or one nobody judged", () => {
    expect(closePromptOf({ cadence: { kind: "stay" }, handoff: "handoff-9294", sweepPrompt: SWEEP })).toStrictEqual({
      handOff: false,
      prompt: SWEEP,
    });
  });

  it("prints the warning alone when an event-woken chair, re-arming no sweep, has no host for its successor", () => {
    const last = closePromptOf({
      cadence: {
        kind: "hand-off",
        target: { kind: "none", why: "every registered plan is paused" },
        verdict: AT_THE_WALL,
      },
      handoff: "handoff-9294",
      sweepPrompt: undefined,
    });

    expect(last).toStrictEqual({
      handOff: false,
      prompt: "HAND-OFF TARGET UNAVAILABLE — every registered plan is paused",
    });
  });

  it("prints nothing for an event-woken chair told to stay", () => {
    expect(closePromptOf({ cadence: { kind: "stay" }, handoff: "handoff-9294", sweepPrompt: undefined })).toStrictEqual(
      { handOff: false, prompt: undefined },
    );
  });
});
