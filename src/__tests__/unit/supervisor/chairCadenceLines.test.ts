/**
 * The HAND OFF block's successor line on a host other than the chair's own: Codex when the register can seat it there
 * (`src/supervisor/chairSuccessor.ts`), or why no host can take it. The Claude block is `./chairCadence.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import { CODEX_MODEL } from "../../../codex/profiles.js";
import { chairCadenceLines } from "../../../supervisor/chairCadenceLines.js";
import {
  CODEX_CHAIR_AUTO_COMPACTIONS_UNMEASURED,
  CODEX_CHAIR_BUDGET_UNMEASURED,
  CODEX_CHAIR_CLI_UNMEASURED,
  judgeCodexChairCadence,
} from "../../../supervisor/codexChairCadence.js";
import { behindOne as behind, handOffOf } from "./chairCadenceFixture.js";

describe("chairCadenceLines, off the chair's own host", () => {
  it("says routing picks nothing for Fable, and seats the successor on Codex", () => {
    const lines = chairCadenceLines({ target: { kind: "codex" }, verdict: behind({ route: { kind: "none" } }) });

    expect(lines.slice(2)).toStrictEqual([
      "  routing names no plan that can take a Fable spawn right now — `slopweaver claude route --model fable` says why; the successor boots on Codex, the registered provider that can take it.",
      `  Record this tick, write the handoff, then \`slopweaver cmux spawn <handoff slug> --driver codex --model ${CODEX_MODEL}\` and let the successor take the pin and re-arm the sweep — do NOT re-arm from this chair.`,
    ]);
  });

  it("renders a Codex chair's stale canon through the common line, with its UNMEASURED notes and a Codex spawn", () => {
    const verdict = judgeCodexChairCadence({
      canon: {
        bootedIso: "2026-09-08T20:20:00.000Z",
        changed: [
          { committedIso: "2026-09-09T10:00:00Z", sha: "34e48e7b7accbdca0b1c7a73d355db7f7f51a443", subject: "S" },
        ],
        kind: "measured",
      },
      nowIso: "2026-09-10T12:20:00.000Z",
      route: { kind: "unmeasured" },
      threadId: "t1",
    });

    expect(chairCadenceLines({ target: { kind: "codex" }, verdict: handOffOf({ verdict }) })).toStrictEqual([
      "HAND OFF THIS TICK — the chair's own measurements say seat a successor now:",
      '  - this chair booted 2026-09-08T20:20:00.000Z, 40h ago — at or past 36h — and origin/main has since changed its loaded canon (skills/supervisor, .claude/rules, AGENTS.md) in 1 commit(s), newest 34e48e7b7 "S"',
      "  which plan routing picks is UNMEASURED this tick — `slopweaver claude route --model fable` names it; the successor boots on Codex, the registered provider that can take it.",
      `  Record this tick, write the handoff, then \`slopweaver cmux spawn <handoff slug> --driver codex --model ${CODEX_MODEL}\` and let the successor take the pin and re-arm the sweep — do NOT re-arm from this chair.`,
      `chair cadence: Codex thread t1: ${CODEX_CHAIR_BUDGET_UNMEASURED}`,
      `chair cadence: Codex thread t1: ${CODEX_CHAIR_CLI_UNMEASURED}`,
      `chair cadence: Codex thread t1: ${CODEX_CHAIR_AUTO_COMPACTIONS_UNMEASURED}`,
    ]);
  });

  it("names why no host can take the successor, and prints no spawn", () => {
    const lines = chairCadenceLines({
      target: { kind: "none", why: "every registered plan is paused" },
      verdict: behind({ route: { kind: "unmeasured" } }),
    });

    expect(lines.slice(2)).toStrictEqual([
      "  which plan routing picks is UNMEASURED this tick — `slopweaver claude route --model fable` names it; no host can take the successor — every registered plan is paused.",
      "  Record this tick and keep the sweep armed: a hand-off with nowhere to land moves nothing, and the next tick judges again.",
    ]);
  });
});
