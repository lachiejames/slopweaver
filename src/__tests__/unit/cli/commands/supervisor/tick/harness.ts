/**
 * The harness every `supervisor tick` case runs over: a real temp directory per case, seams that are plain
 * functions, and the verbs that seat and open a tick so a close case starts from a filled one. The child launcher
 * writes what a `slopweaver` child would have, the render hands back a fixed page, and the publish, the ledger and
 * the chair gate record what they were asked.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "vitest";

import { chairPlanVerdict } from "../../../../../../claude/seatBoot.js";
import type { ScratchDeps } from "../../../../../../cli/commands/supervisor/scratchDeps.js";
import type { SupervisorTickDeps } from "../../../../../../cli/commands/supervisor/tickDeps.js";
import { runSupervisorTick } from "../../../../../../cli/commands/supervisor/tickRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { memoryAutonomyLedgerPort } from "../../../../../autonomyLedgerFixture.js";
import { CLAUDE_FLEET } from "../../../../../chairSuccessorFixture.js";
import { CLEAR_FLEET, CLEAR_STEER, FORM, NOT_READ, NOW, RECONCILE, REFRESHED_TEXT, tickFile } from "../tickFixtures.js";
import { readDepsFor } from "./harnessReads.js";
import type { Fake, FakeOptions, FakeValues } from "./harnessTypes.js";
import { arrayField, jsonObject } from "./parsedJson.js";
import { dir } from "./workdir.js";

export { dir, root, useWorkdir } from "./workdir.js";

/**
 * The chair's reads: its one session booted on `alias`'s setup token, on the Claude Code a fresh boot runs, an
 * hour into canon main has not changed, on a register holding one Claude plan.
 *
 * @param alias the plan the chair booted on
 * @returns the reads
 */
export function chairOn({ alias }: { alias: string }): SupervisorTickDeps["cadenceReads"] {
  return {
    readChairCanon: () =>
      new Map([["a0000049", { bootedIso: "2026-09-27T00:00:00.000Z", changed: [], kind: "measured" } as const]]),
    readChairAutoCompactions: () => new Map([["a0000049", { autoCompactions: 1, kind: "below-trial" } as const]]),
    readChairPlans: () =>
      Promise.resolve(
        chairPlanVerdict({ sessions: [{ pid: 75277, plan: { alias, kind: "token" }, sessionId: "a0000049" }] }),
      ),
    readClaudeCode: () => ({
      boots: { kind: "measured", version: "2.1.283" },
      newestInstalled: { kind: "measured", version: "2.1.283" },
      perSession: new Map([["a0000049", { kind: "measured", version: "2.1.283" } as const]]),
    }),
    readClaudeSide: () => Promise.resolve(ok("unconfigured" as const)),
    readCodexChairCanon: () => {
      throw new Error("a Claude chair never reads a Codex chair's canon");
    },
    readCodexSeat: () => Promise.resolve(ok("codex-one")),
    readPlanRegister: () => Promise.resolve(ok(CLAUDE_FLEET)),
  };
}

/** What one fake run records, before it is handed back as a {@link Fake}. */
interface FakeRecord {
  readonly launched: string[];
  readonly children: (readonly string[])[];
  readonly out: string[];
  readonly diagnostics: string[];
  readonly published: string[];
  readonly renders: (readonly string[])[];
  readonly renderedLists: string[];
}

/** The seams that act: the ledger append, the chair gate, the tick lookup and the publish. */
type ActDeps = Pick<SupervisorTickDeps, "appendTick" | "gate" | "hasTick" | "publish">;

/** The render seam. */
type RenderDeps = Pick<SupervisorTickDeps, "render">;

/**
 * Apply every default of a fake run, in the order the options are read.
 *
 * @returns the options with each default applied
 */
function fakeValues({
  stopped = "",
  stoppedHatch = true,
  spawnFails = false,
  evidence = NOT_READ,
  cadenceReads = chairOn({ alias: "plan-three" }),
  gauge = "",
  closeDone = "",
  refreshFails = false,
  refreshTimesOut = false,
  render,
  duringPublish = () => undefined,
  duringRefresh = () => undefined,
  publishFails = false,
  gateRefuses = false,
  ledger = [],
  voiceNeverMarked = false,
  voiceWords = [],
  steers = [],
  fleet = CLEAR_FLEET,
  fleetHatch = false,
  steer = CLEAR_STEER,
  steerHatch = false,
  reconcile = RECONCILE,
  recipeHatch = true,
}: FakeOptions): FakeValues {
  return {
    stopped,
    stoppedHatch,
    spawnFails,
    evidence,
    cadenceReads,
    gauge,
    closeDone,
    refreshFails,
    refreshTimesOut,
    render,
    duringPublish,
    duringRefresh,
    publishFails,
    gateRefuses,
    ledger,
    voiceNeverMarked,
    voiceWords,
    steers,
    fleet,
    fleetHatch,
    steer,
    steerHatch,
    reconcile,
    recipeHatch,
  };
}

/**
 * The child launcher: it records the argv, and writes what the `slopweaver` child would have printed.
 *
 * @returns the launcher seam
 */
function runChildFor({ values, record }: { values: FakeValues; record: FakeRecord }): ScratchDeps["runChild"] {
  const { closeDone, duringRefresh, gauge, reconcile, refreshFails, refreshTimesOut, spawnFails, stopped } = values;
  return ({ argv, stdoutPath, stderrPath, timeoutMs }) => {
    record.launched.push(argv[0]!);
    record.children.push(argv);
    if (argv.slice(0, 2).join(" ") === "cmux spawn" && spawnFails) {
      return Promise.resolve({ durationMs: 5, exitCode: 1, kind: "exited" });
    }
    if (argv[0] === "session-start") {
      duringRefresh();
      if (refreshFails) {
        return Promise.resolve({ durationMs: 5, exitCode: 1, kind: "exited" });
      }
      if (refreshTimesOut) {
        return Promise.resolve({ durationMs: timeoutMs, kind: "timed-out", signal: "SIGKILL", timeoutMs });
      }
    }
    let printed = "";
    if (argv[0] === "session-start") {
      // A real session-start always prints its document; an empty or unreadable one is refused.
      printed = REFRESHED_TEXT;
    } else if (argv.slice(0, 2).join(" ") === "handover reconcile") {
      printed = reconcile;
    } else if (argv.join(" ") === "claude gauge --json") {
      printed = gauge;
    } else if (argv.join(" ") === "session close-done --json") {
      printed = closeDone;
    } else if (argv.slice(0, 4).join(" ") === "monitor check --only recipe-stopped") {
      printed = stopped;
    }
    writeFileSync(stdoutPath, printed);
    writeFileSync(stderrPath, "");
    return Promise.resolve({ durationMs: 5, exitCode: 0, kind: "exited" });
  };
}

/**
 * The scratch seams over the temp directory.
 *
 * @returns the scratch deps
 */
function scratchDepsFor({ values, record }: { values: FakeValues; record: FakeRecord }): ScratchDeps {
  return {
    autonomy: memoryAutonomyLedgerPort(),
    defaultBin: () => "/checkout/bin/slopweaver",
    defaultRepo: () => ok("o/r"),
    now: () => NOW,
    // Running from source: no manifest, so no reading ever waits for a rebuild (`scratchRun.test.ts` stages one).
    readBuild: () => ({ kind: "unbuilt" }),
    recordReading: ({ producer }) => ok(`${producer}-row`),
    runChild: runChildFor({ record, values }),
    waitForBuild: () => Promise.reject(new Error("an unbuilt tree is never waited for")),
    writeDiagnostic: (line) => {
      record.diagnostics.push(line);
    },
    writeOut: (line) => {
      record.out.push(line);
    },
  };
}

/**
 * The seams that act: the ledger, the chair gate and the publish.
 *
 * @returns the act deps
 */
function actDepsFor({ values, record }: { values: FakeValues; record: FakeRecord }): ActDeps {
  const { duringPublish, evidence, gateRefuses, ledger, publishFails } = values;
  return {
    appendTick: ({ row }) => {
      ledger.push(row);
      return ok("/home/ledger/supervisor-ticks.jsonl");
    },
    gate: ({ commit }) => (gateRefuses ? Promise.resolve(EXIT_ERROR) : commit({ evidence })),
    hasTick: ({ tickId }) => Promise.resolve(ledger.some((row) => row.tickId === tickId)),
    publish: async ({ fragment }) => {
      duringPublish();
      if (publishFails) {
        return err(["the pages directory is read-only"]);
      }
      record.published.push(fragment);
      return ok({ url: "http://localhost/fleet-briefing" });
    },
  };
}

/**
 * The render seam: the fixed page, or the case's own render.
 *
 * @returns the render deps
 */
function renderDepsFor({ values, record }: { values: FakeValues; record: FakeRecord }): RenderDeps {
  const { render } = values;
  return {
    render: ({ argv, formText }) => {
      record.renders.push(argv);
      if (argv.includes("--your-list")) {
        // Read DURING the render: the close may hand it a private copy it removes once the render returns.
        record.renderedLists.push(readFileSync(argv[argv.indexOf("--your-list") + 1]!, "utf8"));
      }
      if (render !== undefined) {
        return render({ argv, formText });
      }
      const outPath = argv[argv.indexOf("--out") + 1]!;
      return Promise.resolve({
        diagnostics: [],
        exitCode: EXIT_OK,
        pages: new Map([[outPath, "<p>the page</p>"]]),
        refusalCode: undefined,
      });
    },
  };
}

/**
 * Seams over the temp directory.
 *
 * @param options what a case changes about the run — a default for every field it leaves out
 * @returns the seams and what they recorded
 */
export function fake(options: FakeOptions = {}): Fake {
  const values = fakeValues(options);
  const record: FakeRecord = {
    children: [],
    diagnostics: [],
    launched: [],
    out: [],
    published: [],
    renderedLists: [],
    renders: [],
  };
  return {
    appended: values.ledger,
    deps: {
      ...readDepsFor({ values }),
      ...actDepsFor({ record, values }),
      ...renderDepsFor({ record, values }),
      scratch: scratchDepsFor({ record, values }),
    },
    children: record.children,
    diagnostics: record.diagnostics,
    launched: record.launched,
    out: record.out,
    published: record.published,
    renderedLists: record.renderedLists,
    renders: record.renders,
  };
}

/**
 * Seat the directory, open tick 1, and fill its file — the state every close case starts from.
 *
 * @param tick the filled tick file
 * @param gauge what the open's `claude gauge --json` capture prints — nothing unless a case reads a gauge
 * @param reconcile what the open's `handover reconcile` capture prints — the one owner turn unless a case reads a board
 * @param stopped what the open's recipe-stopped capture prints — nothing unless a case reads a stopped set
 */
export async function seatAndOpen({
  tick = tickFile(),
  gauge = "",
  reconcile = RECONCILE,
  stopped = "",
}: { tick?: string; gauge?: string; reconcile?: string; stopped?: string } = {}): Promise<void> {
  const seated = await runSupervisorTick({
    deps: fake().deps,
    rest: [
      "seat",
      "--dir",
      dir,
      "--workspace",
      "workspace:93",
      "--model",
      "fable",
      "--pinned-at",
      "2026-09-23T14:36:00Z",
      "--loop-session-key",
      "live-loop-a",
    ],
  });
  expect(seated).toBe(EXIT_OK);
  const opened = await runSupervisorTick({
    deps: fake({ gauge, reconcile, stopped }).deps,
    rest: ["open", "--dir", dir],
  });
  expect(opened).toBe(EXIT_OK);
  writeFileSync(join(dir, "form.json"), `${JSON.stringify(FORM, null, 2)}\n`);
  writeFileSync(join(dir, "tick-1", "run.json"), JSON.stringify({ nowIso: NOW }));
  writeFileSync(join(dir, "tick-1", "tick.json"), tick);
}

/**
 * How many recent blocks the seat's form holds.
 *
 * @returns the count
 */
export function recentBlocks(): number {
  const form = jsonObject({ text: readFileSync(join(dir, "form.json"), "utf8") });
  return arrayField({ key: "recent", record: form }).length;
}
