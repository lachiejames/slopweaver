/**
 * A Codex chair on a ONE-plan, Codex-only install, where the chair may hand off to a successor on its own plan.
 * Stale canon still hands off, onto the same sole Codex plan, through the live
 * seat decision the spawn itself makes — no "different plan" condition from the Claude budget applies.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";
import {
  runSupervisorTickRecord,
  type SupervisorTickRecordDeps,
} from "../../../../../../cli/commands/supervisor/tickRecordRun.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { CODEX_MODEL } from "../../../../../../codex/profiles.js";
import { CODEX_ONLY } from "../../../../../chairSuccessorFixture.js";
import { capture, DRAFT, RECONCILE } from "./harness.js";

const THREAD = "019a1a98-9b15-7482-8000-000000000001";

describe("a Codex chair's stale canon on a one-plan Codex install", () => {
  it("seats a Codex successor on the sole plan, reading the register and the live seat once each", async () => {
    const run = capture({ files: { "d.json": DRAFT, "r.json": RECONCILE } });
    const reads: string[] = [];
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readCodexChairCanon: ({ bootedIso }) => ({
        bootedIso,
        changed: [
          { committedIso: "2026-09-09T10:00:00Z", sha: "34e48e7b7accbdca0b1c7a73d355db7f7f51a443", subject: "S (#1)" },
        ],
        kind: "measured",
      }),
      readCodexSeat: () => {
        reads.push("codex seat");
        return Promise.resolve(ok("codex-work"));
      },
      readPlanRegister: () => {
        reads.push("register");
        return Promise.resolve(ok(CODEX_ONLY));
      },
    };

    const code = await runSupervisorTickRecord({
      deps,
      evidence: {
        canonFloor: { kind: "measured", pinnedAtIso: "2026-09-08T20:20:00.000Z" },
        kind: "codex",
        threadId: THREAD,
      },
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(reads).toStrictEqual(["register", "codex seat"]);
    expect(run.diagnostics[0]).toBe(
      "supervisor tick-record: HAND OFF THIS TICK — the chair's own measurements say seat a successor now:",
    );
    expect(run.diagnostics).toContain(
      `supervisor tick-record:   Record this tick, write the handoff, then \`slopweaver cmux spawn <handoff slug> --driver codex --model ${CODEX_MODEL}\` and let the successor take the pin and re-arm the sweep — do NOT re-arm from this chair.`,
    );
  });

  it("prints no spawn when the sole plan's live seat refuses, so nothing claims the hand-off happened", async () => {
    const run = capture({ files: { "d.json": DRAFT, "r.json": RECONCILE } });
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readCodexChairCanon: ({ bootedIso }) => ({
        bootedIso,
        changed: [
          { committedIso: "2026-09-09T10:00:00Z", sha: "34e48e7b7accbdca0b1c7a73d355db7f7f51a443", subject: "S (#1)" },
        ],
        kind: "measured",
      }),
      readCodexSeat: () => Promise.resolve(err("codex-work is at its weekly ceiling")),
      readPlanRegister: () => Promise.resolve(ok(CODEX_ONLY)),
    };

    await runSupervisorTickRecord({
      deps,
      evidence: {
        canonFloor: { kind: "measured", pinnedAtIso: "2026-09-08T20:20:00.000Z" },
        kind: "codex",
        threadId: THREAD,
      },
      rest: ["--draft", "d.json", "--reconcile", "r.json"],
    });

    expect(run.diagnostics.slice(2, 4)).toStrictEqual([
      "supervisor tick-record:   which plan routing picks is UNMEASURED this tick — `slopweaver claude route --model fable` names it; no host can take the successor — no Claude plan takes the successor, and `cmux spawn --driver codex` would not open its seat: codex-work is at its weekly ceiling.",
      "supervisor tick-record:   Record this tick and keep the sweep armed: a hand-off with nowhere to land moves nothing, and the next tick judges again.",
    ]);
  });
});
